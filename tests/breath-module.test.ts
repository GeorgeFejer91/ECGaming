import { describe, it, expect } from "vitest";
import { BreathAnalyzer, type AccelerometerUnit } from "../src/breath/analyzer";
import { BreathSourceManager } from "../src/breath/source";

const HZ = 50;
const SAMPLE_MS = 1000 / HZ;
const breathPeriodMs = 5000;

/**
 * Synthetic chest-bellows: a low-amplitude breathing bump with an explicit
 * inter-breath rest phase on the z axis over a gravity baseline.  The bump
 * magnitude (~0.1 g) sits in the healthy detection band of the lynphan core
 * (0.06–0.12 g) so the short-vs-long running averages cross the adaptive
 * threshold once per breath.
 */
function bellowsZ(timeMs: number, periodMs: number, amplitude: number): number {
  const inhaleMs = periodMs * 0.24;
  const exhaleEndMs = periodMs * 0.6;
  const phase = timeMs % periodMs;
  if (phase < inhaleMs) {
    return 9.8 + amplitude * (phase / inhaleMs);
  }
  if (phase < exhaleEndMs) {
    return 9.8 + amplitude * (1 - (phase - inhaleMs) / (exhaleEndMs - inhaleMs));
  }
  return 9.8;
}

function bellowsMs2(atMs: number) {
  return { x: 0, y: 0, z: bellowsZ(atMs, breathPeriodMs, 1.0) };
}

function bellowsG(atMs: number) {
  const s = bellowsMs2(atMs);
  return { x: s.x / 9.80665, y: s.y / 9.80665, z: s.z / 9.80665 };
}

function pump(
  analyzer: BreathAnalyzer,
  at: (t: number) => { x: number; y: number; z: number },
  durationMs: number,
  unit?: AccelerometerUnit,
) {
  let frame = analyzer.ingest({ ...at(0), timeMs: 0, ...(unit ? { unit } : {}) });
  for (let t = SAMPLE_MS; t <= durationMs; t += SAMPLE_MS)
    frame = analyzer.ingest({ ...at(t), timeMs: t, ...(unit ? { unit } : {}) });
  return frame;
}

describe("BreathAnalyzer", () => {
  it("calibrates, goes ready and maps belly volume 0-1", () => {
    const analyzer = new BreathAnalyzer();
    const frame = pump(analyzer, bellowsMs2, 78_000);

    expect(frame.calibrated).toBe(true);
    expect(frame.ready).toBe(true);
    expect(frame.confidence01).toBeGreaterThan(0.5);
    expect(frame.values.breathing_signal_ready).toBe(1);
    expect(frame.values.breathing_axis_range).toBeGreaterThan(0.005);
  });

  it("normalises both m/s² and g so one detector serves phone and polar ACC", () => {
    const viaMs2 = pump(new BreathAnalyzer(), bellowsMs2, 30_000);
    const viaG = pump(new BreathAnalyzer(), bellowsG, 30_000, "g");

    expect(viaMs2.calibrated).toBe(true);
    expect(viaG.calibrated).toBe(true);
    expect(viaMs2.ready).toBe(true);
    expect(viaG.ready).toBe(true);
    expect(viaMs2.volume01).toBeCloseTo(viaG.volume01, 3);
  });

  it("collects presentation points once calibrated", () => {
    const analyzer = new BreathAnalyzer();
    pump(analyzer, bellowsMs2, 78_000);

    const frame = analyzer.snapshot();
    expect(frame.calibrated).toBe(true);
    expect(frame.presentationPoints.length).toBeGreaterThan(0);
    expect(frame.presentationPoints[0].volume01).toBeGreaterThanOrEqual(0);
  });

  it("counts breaths with a rolling BPM and exposes diagnostics", () => {
    const analyzer = new BreathAnalyzer();
    const frame = pump(analyzer, bellowsMs2, 78_000);

    expect(frame.bpm).toBeGreaterThanOrEqual(8);
    expect(frame.bpm).toBeLessThanOrEqual(16);
    expect(Number.isFinite(frame.diagnostics.motionScore01)).toBe(true);
    expect(Number.isFinite(frame.diagnostics.pcaDominance01)).toBe(true);
    expect(frame.diagnostics.confidence01).toBeGreaterThan(0.5);
  });

  it("reset() clears the processor and presentation points", () => {
    const analyzer = new BreathAnalyzer();
    pump(analyzer, bellowsMs2, 78_000);
    expect(analyzer.snapshot().calibrated).toBe(true);

    analyzer.reset();
    const fresh = analyzer.ingest({ ...bellowsMs2(0), timeMs: 0 });
    expect(fresh.calibrated).toBe(false);
    expect(fresh.presentationPoints.length).toBe(0);
  });
});

describe("BreathSourceManager", () => {
  function make() {
    const analyzer = new BreathAnalyzer();
    const manager = new BreathSourceManager(analyzer);
    return { manager, analyzer };
  }

  it("defaults to polar as the active source when attached", () => {
    const { manager } = make();
    manager.attach({ kind: "polar", label: "Polar H10" });
    expect(manager.activeSource).toBe("polar");
  });

  it("falls back to phone when phone is tagged breathResponsible and polar absent", () => {
    const { manager } = make();
    manager.attach({ kind: "phone", label: "This phone", breathResponsible: true });
    expect(manager.activeSource).toBe("phone");
  });

  it("does not activate an untagged phone source", () => {
    const { manager } = make();
    manager.attach({ kind: "phone", label: "Other phone" });
    expect(manager.activeSource).toBeNull();
  });

  it("prefers polar when both sources are attached", () => {
    const { manager } = make();
    manager.attach({ kind: "phone", label: "This phone", breathResponsible: true });
    manager.attach({ kind: "polar", label: "Polar H10" });
    expect(manager.activeSource).toBe("polar");
  });

  it("switches to phone when polar detaches", () => {
    const { manager } = make();
    manager.attach({ kind: "polar", label: "Polar H10" });
    manager.attach({ kind: "phone", label: "This phone", breathResponsible: true });
    expect(manager.activeSource).toBe("polar");
    manager.detach("polar");
    expect(manager.activeSource).toBe("phone");
  });

  it("routes samples only when active", () => {
    const { manager } = make();
    manager.attach({ kind: "polar", label: "Polar H10" });
    const result = manager.ingest(
      { x: 0, y: 0, z: 9.8, timeMs: 0, unit: "ms2" },
      "polar",
    );
    expect(result).not.toBeNull();
    expect(result!.timestampMs).toBe(0);

    // phone samples are ignored while polar is active
    const ignored = manager.ingest(
      { x: 0, y: 0, z: 9.8, timeMs: 0, unit: "ms2" },
      "phone",
    );
    expect(ignored).toBeNull();
  });

  it("setPreferred switches active source and resets analyzer", () => {
    const { manager, analyzer } = make();
    manager.attach({ kind: "polar", label: "Polar H10" });
    manager.attach({ kind: "phone", label: "This phone", breathResponsible: true });
    expect(manager.activeSource).toBe("polar");

    manager.setPreferred("phone");
    expect(manager.activeSource).toBe("phone");
    // Analyzer should have been reset so a new calibration begins
    expect(analyzer.snapshot().calibrated).toBe(false);
  });

  it("notifies on active change", () => {
    const { manager } = make();
    const changes: (string | null)[] = [];
    manager.onActiveChange((a) => changes.push(a));
    manager.attach({ kind: "polar", label: "Polar H10" });
    manager.detach("polar");
    expect(changes).toEqual(["polar", null]);
  });
});