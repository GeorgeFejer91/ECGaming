import { describe, expect, it } from "vitest";
import { RelayAuthority, validFrame, validOffer, validRelay } from "../src/flight-session/contract";
import { PolarControlProcessor } from "../src/flight-session/polar-source";
import { FlightFlags } from "../src/protocol/flight-frame";
import type { FlightFrame } from "../src/protocol/types";

const frame = (sequence = 1): FlightFrame => ({ sequence, beatCounter: 3, altitude: .7, throttle: .4, traffic: .5, beatAgeMs: 20, quality: .8, flags: 3 });
const offer = (a: RelayAuthority, sequence = 1) => ({ configRevision: a.configRevision, sourceEpoch: a.sourceEpoch, status: "live" as const, frame: frame(sequence) });
function sourceFixture(metric: "excitement_score" | "breathing_volume" = "excitement_score") {
  const authority = new RelayAuthority(); authority.select("phone");
  authority.mappings.altitude.metric = metric;
  authority.mappings.altitude.attackMs = authority.mappings.altitude.releaseMs = 0;
  const processor = new PolarControlProcessor(); processor.configure(authority.state("phone", 0));
  processor.handle({ kind: "connection", connected: true }, 0);
  processor.handle({ kind: "heart-rate", rrIntervalsMs: [800] }, 0);
  return { authority, processor };
}
function ecg(processor: PolarControlProcessor, now: number) {
  processor.handle({ kind: "ecg", microvolts: [0, 3, 8, 20, 10, 4, 0], sensorTimestampNs: BigInt(now) * 1_000_000n, streamHealth: { observedSampleRateHz: 130 } }, now);
}

describe("private flight session routing", () => {
  it("accepts only the selected source and current configuration epoch", () => {
    const a = new RelayAuthority(); a.select("phone");
    const old = offer(a);
    expect(a.accept("cockpit", old, 0)).toBe(false);
    expect(a.accept("phone", old, 0)).toBe(true);
    expect(a.read(100)?.altitude).toBe(.7);
    a.select("cockpit"); expect(a.read(100)).toBeNull();
    expect(a.accept("phone", old, 100)).toBe(false);
    expect(a.accept("cockpit", old, 100)).toBe(false);
    expect(a.accept("cockpit", offer(a), 100)).toBe(true);
    const mapping = structuredClone(a.mappings); mapping.altitude.reverse = true;
    const before = offer(a, 2); a.configure(mapping);
    expect(a.read(100)).toBeNull(); expect(a.accept("cockpit", before, 100)).toBe(false);
    expect(a.accept("cockpit", offer(a, 3), 100)).toBe(true);
  });
  it("does not renew the receiver lease for replayed frames, and ages heartbeat pulses", () => {
    const a = new RelayAuthority(); const packet = offer(a);
    a.accept("ground", packet, 0);
    expect(a.read(100)?.beatAgeMs).toBe(120);
    expect(a.accept("ground", packet, 400)).toBe(false);
    expect(a.read(500)).toBeNull();
    expect(a.accept("ground", offer(a, 2), 550)).toBe(true);
    expect(a.read(550)).not.toBeNull();
  });
  it("forwards recalibration through a new configuration revision and holds old controls", () => {
    const a = new RelayAuthority(); a.select("phone");
    const old = offer(a); a.accept("phone", old, 0);
    a.recalibrate();
    expect(a.configRevision).toBe(old.configRevision + 1);
    expect(a.read(10)).toBeNull();
    expect(a.accept("phone", old, 10)).toBe(false);
    expect(a.state("phone", 10).configRevision).toBe(a.configRevision);
  });
  it("rejects raw ECG, arbitrary metrics, malformed and unbounded controls", () => {
    const a = new RelayAuthority();
    expect(validFrame({ ...frame(), microvolts: [1, 2] })).toBe(false);
    expect(validOffer({ ...offer(a), heart_rate: 80 })).toBe(false);
    expect(validOffer({ ...offer(a), frame: { ...frame(), altitude: NaN } })).toBe(false);
    expect(validFrame({ ...frame(), throttle: 100 })).toBe(false);
    expect(validRelay(a.state("phone", 0))).toBe(true);
    const reordered = JSON.parse(JSON.stringify(a.state("phone", 0), (_key, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v));
    expect(validRelay(reordered)).toBe(true);
    expect(validRelay({ ...a.state("phone", 0), metrics: {} })).toBe(false);
  });
});

describe("source-local Polar processing", () => {
  it("maps local physiology to normalized controls without leaking raw or derived signals", () => {
    const { processor } = sourceFixture(); ecg(processor, 10);
    processor.handle({ kind: "metrics", snapshot: { values: { excitement_score: .85, heart_rate: 75, rr_interval: 800 } } }, 10);
    const output = processor.offer(20)!;
    expect(output.status).toBe("live"); expect(output.frame!.altitude).toBeCloseTo(.7);
    expect(output.frame!.flags & FlightFlags.controlReady).toBeTruthy();
    expect(validOffer(output)).toBe(true);
    expect(JSON.stringify(output)).not.toMatch(/microvolts|heart_rate|rr_interval|excitement_score/);
    expect(processor.offer(510)!.frame!.flags & FlightFlags.controlReady).toBe(0);
  });
  it("holds flight for disconnected, inactive, missing and mock ECG", () => {
    const { processor, authority } = sourceFixture();
    processor.handle({ kind: "metrics", snapshot: { values: { excitement_score: .9 } } }, 0);
    expect(processor.offer(10)!.frame!.flags & FlightFlags.controlReady).toBe(0);
    ecg(processor, 20); expect(processor.offer(30)!.status).toBe("live");
    processor.configure(authority.state("cockpit", 30)); expect(processor.offer(30)!.frame).toBeNull();
    processor.configure(authority.state("phone", 30));
    processor.handle({ kind: "ecg", mock: true }, 40); expect(processor.offer(40)!.frame).toBeNull();
    expect(processor.status).toBe("error");
  });
  it("requires live calibrated chest motion when breathing is mapped", () => {
    const { processor } = sourceFixture("breathing_volume"); ecg(processor, 0);
    processor.handle({ kind: "metrics", snapshot: { values: { breathing_volume: .8 } } }, 0);
    expect(processor.offer(10)!.status).toBe("warming");
    processor.handle({ kind: "accelerometer", breathing: { ready: true } }, 20);
    expect(processor.offer(30)!.status).toBe("live");
    ecg(processor, 500); expect(processor.offer(520)!.status).toBe("warming");
  });
  it("does adaptive calibration on observations and resets it for a new mapping", () => {
    const { authority, processor } = sourceFixture();
    const mappings = structuredClone(authority.mappings);
    mappings.altitude.normalization = { mode: "adaptive", minimumSamples: 3, warmupMs: 0, minimumSpan: .1 };
    authority.configure(mappings); processor.configure(authority.state("phone", 0));
    ecg(processor, 0);
    processor.handle({ kind: "metrics", snapshot: { values: { excitement_score: .2 } } }, 0);
    for (let t = 1; t < 20; t++) expect(processor.offer(t)!.status).toBe("warming");
    processor.handle({ kind: "metrics", snapshot: { values: { excitement_score: .4 } } }, 20);
    processor.handle({ kind: "metrics", snapshot: { values: { excitement_score: .8 } } }, 30);
    expect(processor.offer(40)!.status).toBe("live");
    expect(processor.offer(40)!.frame!.altitude).toBeGreaterThan(0);
    mappings.altitude.reverse = true; authority.configure(mappings); processor.configure(authority.state("phone", 50));
    expect(processor.offer(50)!.status).toBe("warming");
  });
});
