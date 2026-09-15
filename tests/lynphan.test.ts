import { describe, expect, it } from "vitest";
import { LynphanBreathDetector } from "../src/phone-breather/lynphan";

/**
 * Synthetic chest-bellows: a low-amplitude breathing bump with an explicit
 * inter-breath rest phase on the z axis over a gravity baseline. The lynphan
 * core counts a breath when the short-vs-long difference stays below the
 * adaptive threshold for roughly a full peak-detection window, so the signal
 * spends a genuine rest stretch at the baseline between breaths — mirroring a
 * resting belly-mounted phone.
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

function runBellows(
  detector: LynphanBreathDetector,
  periodMs: number,
  amplitude: number,
  durationMs: number,
  sampleMs = 20,
) {
  const snapshots = [];
  for (let t = 0; t <= durationMs; t += sampleMs) {
    snapshots.push(detector.pushSample({ x: 0, y: 0, z: bellowsZ(t, periodMs, amplitude) }, t));
  }
  return snapshots;
}

describe("LynphanBreathDetector", () => {
  it("measures breaths per minute for a 12 BPM bellows", () => {
    const detector = new LynphanBreathDetector();
    const snapshots = runBellows(detector, 5000, 0.12, 78_000);

    expect(snapshots.some(s => s.ready)).toBe(true);
    expect(snapshots.some(s => s.peakDetected)).toBe(true);
    expect(snapshots.some(s => s.breathCounted && s.ready)).toBe(true);

    const final = snapshots.at(-1)!;
    expect(final.bpm).toBeGreaterThanOrEqual(8);
    expect(final.bpm).toBeLessThanOrEqual(16);

    // The adaptive threshold must stay inside (0, 1).
    for (const s of snapshots) {
      expect(s.threshold).toBeGreaterThan(0);
      expect(s.threshold).toBeLessThan(1);
    }
  });

  it("swells its volume envelope and classifies inhale/exhale per breath", () => {
    const detector = new LynphanBreathDetector();
    const snapshots = runBellows(detector, 5000, 0.12, 78_000);

    let seenInhale = false;
    let seenExhale = false;
    let maxVolume = -Infinity;
    let minVolume = Infinity;
    for (const s of snapshots) {
      if (!s.ready) continue;
      if (s.phase === 1) seenInhale = true;
      if (s.phase === -1) seenExhale = true;
      maxVolume = Math.max(maxVolume, s.volume01);
      minVolume = Math.min(minVolume, s.volume01);
    }

    expect(seenInhale).toBe(true);
    expect(seenExhale).toBe(true);
    expect(maxVolume).toBeGreaterThan(0.55);
    expect(minVolume).toBeLessThan(0.35);
  });

  it("stays flat on constant input: no peaks, no breaths, no rate", () => {
    const detector = new LynphanBreathDetector();
    const snapshots = [];
    for (let t = 0; t <= 10_000; t += 20) {
      snapshots.push(detector.pushSample({ x: 9.8, y: 0, z: 9.8 }, t));
    }

    expect(snapshots.every(s => !s.peakDetected)).toBe(true);
    expect(snapshots.every(s => !s.breathCounted)).toBe(true);
    expect(snapshots.every(s => s.bpm === 0)).toBe(true);
    expect(snapshots.at(-1)!.volume01).toBeLessThan(0.02);
  });

  it("recovers after a sensor gap and resumes counting breaths", () => {
    const detector = new LynphanBreathDetector();
    const pre = runBellows(detector, 5000, 0.12, 30_000);
    expect(pre.some(s => s.ready)).toBe(true);

    // Emulate a 2.5 s drop-out followed by steady sampling again.
    let t = 32_500;
    let sawLost = false;
    const post = [];
    for (; t <= 75_000; t += 20) {
      const s = detector.pushSample({ x: 0, y: 0, z: bellowsZ(t, 5000, 0.12) }, t);
      post.push(s);
      if (s.lost) sawLost = true;
    }

    expect(sawLost).toBe(true);
    expect(post.some(s => s.peakDetected)).toBe(true);
    expect(post.at(-1)!.ready).toBe(true);
    expect(post.at(-1)!.bpm).toBeGreaterThan(0);
    expect(post.at(-1)!.bpm).toBeLessThanOrEqual(16);
  });
});