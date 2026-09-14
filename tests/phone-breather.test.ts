import { describe, it, expect } from "vitest";
import { PhoneBreathProcessor } from "../src/phone-breather/breathe-processor";

const HZ = 50;
const breathPeriodMs = 5000;

function bellowsSample(atMs: number): { x: number; y: number; z: number } {
  // Phone flat on the belly; breathing drives a slow sine on the depth axis.
  const phase = (2 * Math.PI * atMs) / breathPeriodMs;
  return { x: 0.1, y: 0.08, z: 9.8 + 0.4 * Math.sin(phase) };
}

describe("phone breath processor", () => {
  it("calibrates to the dominant belly axis and maps a 0-1 breathing volume", () => {
    const processor = new PhoneBreathProcessor({ calibrationWindowMs: 10_000 });
    let snapshot = processor.snapshot(0);
    for (let atMs = 0; atMs < 16_000; atMs += 1000 / HZ)
      snapshot = processor.pushSample(bellowsSample(atMs), atMs);

    expect(snapshot.calibrated).toBe(true);
    expect(snapshot.ready).toBe(true);
    expect(snapshot.confidence01).toBeGreaterThan(0.5);
    // The axis range captures the simulated belly excursion in 3D.
    expect(snapshot.values.breathing_axis_range).toBeGreaterThan(0.05);
  });

  it("tracks the sine wave so volume peaks on inhale and empties on exhale", () => {
    const processor = new PhoneBreathProcessor({ calibrationWindowMs: 10_000 });
    // Feed a full calibration window, then verify tracking across several breaths.
    const samples: Array<{ atMs: number; volume01: number }> = [];
    for (let atMs = 0; atMs < 30_000; atMs += 1000 / HZ)
      processor.pushSample(bellowsSample(atMs), atMs);

    for (let atMs = 30_000; atMs < 40_000; atMs += 1000 / HZ)
      samples.push({ atMs, volume01: processor.pushSample(bellowsSample(atMs), atMs).volume01 });
    const volumes = samples.map(s => s.volume01);
    const peak = Math.max(...volumes);
    const floor = Math.min(...volumes);
    expect(peak).toBeGreaterThan(0.85);
    expect(floor).toBeLessThan(0.25);
  });

  it("classifies inhale and exhale phases from the volume derivative", () => {
    const processor = new PhoneBreathProcessor({ calibrationWindowMs: 10_000 });
    for (let atMs = 0; atMs < 12_000; atMs += 1000 / HZ)
      processor.pushSample(bellowsSample(atMs), atMs);

    // Over a full breath cycle after calibration the classifier must land on
    // both an inhale and an exhale confirmed transition.
    const phases = new Set<number>();
    for (let atMs = 12_000; atMs < 19_000; atMs += 1000 / HZ)
      phases.add(processor.pushSample(bellowsSample(atMs), atMs).phase);
    expect(phases.has(1)).toBe(true);
    expect(phases.has(-1)).toBe(true);
  });

  it("rejects constant motion and resets cleanly after a stale gap", () => {
    const processor = new PhoneBreathProcessor({ calibrationWindowMs: 6_000 });
    let atMs = 0;
    for (; atMs < 7_000; atMs += 1000 / HZ)
      processor.pushSample({ x: 0, y: 0, z: 9.8 }, atMs);
    // A perfectly still device has no dominant breathing axis range.
    expect(processor.snapshot(atMs).calibrated).toBe(false);

    // A stale gap flushes the classifier to a safe hold state.
    let snapshot = processor.snapshot(atMs);
    setTimeout(() => {}, 0);
    processor.pushSample({ x: 9.8, y: 0, z: 0 }, atMs + 2_000);
    snapshot = processor.pushSample({ x: 9.8, y: 0, z: 0 }, atMs + 4_000);
    expect(snapshot.phase).toBe(0);
  });
});