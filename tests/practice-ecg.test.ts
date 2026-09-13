import { expect, it, vi } from "vitest";
import { PracticeEcg } from "../src/signals/practice-ecg";
import { PracticeHeartbeat } from "../src/phone-tilt/practice-heartbeat";
import { RelayAuthority } from "../src/flight-session/contract";
import { FlightFlags } from "../src/protocol/flight-frame";

it("generates 130 Hz ECG with R peaks on the practice beat clock and no resume backlog", () => {
  const ecg = new PracticeEcg(); ecg.reset(0);
  const samples: number[] = [], beats: number[] = [];
  for (let now = 0; now <= 3000; now += 20) {
    const frame = ecg.sample(now, 60); samples.push(...frame.microvolts); beats.push(...frame.beats);
    for (const at of frame.beats) {
      const index = Math.round((at - Number(frame.sensorTimestampNs) / 1e6) * 130 / 1000) + frame.microvolts.length - 1;
      expect(frame.microvolts[index]).toBeGreaterThan(900);
    }
  }
  expect(samples.length).toBeGreaterThanOrEqual(390);
  expect(samples.every(Number.isFinite)).toBe(true);
  expect(Math.min(...samples)).toBeLessThan(-100);
  expect(beats.length).toBeGreaterThanOrEqual(3);
  expect(beats[1]! - beats[0]!).toBeCloseTo(1000, -1);
  const resume = ecg.sample(60_000, 60);
  expect(resume.microvolts).toHaveLength(1); expect(resume.beats).toEqual([60_000]);
});

it("relays one tactile pulse per fresh Ground Control beat and stops for off, hidden, stale or another source", () => {
  const output = vi.fn(), heartbeat = new PracticeHeartbeat(output);
  const relay = new RelayAuthority().state("phone", 0);
  relay.frame = { sequence: 1, beatCounter: 1, beatAgeMs: 40, altitude: .2, throttle: .5, traffic: .5, quality: 1,
    flags: FlightFlags.simulation | FlightFlags.controlReady };
  expect(heartbeat.update(relay, true, true)).toBe(true);
  heartbeat.update(relay, true, true);
  expect(output.mock.calls).toEqual([[100]]);
  relay.frame.beatCounter = 4; relay.frame.beatAgeMs = 400;
  heartbeat.update(relay, true, true); expect(output).toHaveBeenCalledTimes(1);
  relay.frame.beatCounter++; relay.frame.beatAgeMs = 10;
  heartbeat.update(relay, true, false); expect(output).toHaveBeenLastCalledWith(0);
  heartbeat.update(relay, false, true); expect(output).toHaveBeenCalledTimes(2);
  heartbeat.update(relay, true, true); expect(output).toHaveBeenLastCalledWith(100);
  heartbeat.pause(); heartbeat.update(relay, true, true);
  expect(output.mock.calls.filter(([ms]) => ms > 0)).toHaveLength(2);
  relay.frame.flags = FlightFlags.physicalPolar | FlightFlags.controlReady; relay.frame.beatCounter++;
  expect(heartbeat.update(relay, true, true)).toBe(true);
  expect(output.mock.calls.filter(([ms]) => ms > 0)).toHaveLength(3);
  relay.frame.flags = FlightFlags.beatDetectorReady | FlightFlags.controlReady; relay.frame.beatCounter++;
  expect(heartbeat.update(relay, true, true)).toBe(true);
  expect(output.mock.calls.filter(([ms]) => ms > 0)).toHaveLength(4);
  relay.frame.flags = 0; expect(heartbeat.update(relay, true, true)).toBe(false);
  relay.frame.flags = FlightFlags.simulation | FlightFlags.controlReady; relay.source = "phone";
  expect(heartbeat.update(relay, true, true)).toBe(false);
});
