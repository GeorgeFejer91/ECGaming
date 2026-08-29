import { describe, expect, it } from "vitest";
import {
  getBreathsPerMinute,
  interpolateBreathTiming,
  normalizeBreathTiming,
  sampleBreathCycle,
  type BreathTiming,
} from "../breath-sonification/breath-model";
import { lungSilhouettePath } from "../breath-sonification/lung-visual";
import { PolarBreathLock } from "../breath-sonification/polar-breath-lock";
import {
  mapBreathSonicSpace,
  sonicMotionForPhase,
  sonicQualities,
} from "../breath-sonification/breath-sonic-space";

const timing: BreathTiming = {
  inhaleSeconds: 2,
  inhaleHoldSeconds: 0.5,
  exhaleSeconds: 3,
  exhaleHoldSeconds: 0.5,
};

describe("breath sonification timing model", () => {
  it("reports the pace from the complete four-part cycle", () => {
    expect(getBreathsPerMinute(timing)).toBe(10);
  });

  it("samples inhale, holds, and exhale without discontinuous volume", () => {
    expect(sampleBreathCycle(0, timing)).toMatchObject({
      phase: "inhale",
      volume01: 0,
      flow01: 0,
    });
    expect(sampleBreathCycle(2, timing)).toMatchObject({
      phase: "inhale-hold",
      volume01: 1,
    });
    expect(sampleBreathCycle(2.5, timing)).toMatchObject({
      phase: "exhale",
      volume01: 1,
    });
    expect(sampleBreathCycle(5.5, timing)).toMatchObject({
      phase: "exhale-hold",
      volume01: 0,
    });
    expect(sampleBreathCycle(6, timing)).toMatchObject({
      phase: "inhale",
      volume01: 0,
    });
  });

  it("clamps unsafe or impossible durations", () => {
    expect(
      normalizeBreathTiming({
        inhaleSeconds: -1,
        inhaleHoldSeconds: -4,
        exhaleSeconds: Number.POSITIVE_INFINITY,
        exhaleHoldSeconds: 99,
      }),
    ).toEqual({
      inhaleSeconds: 0.3,
      inhaleHoldSeconds: 0,
      exhaleSeconds: 2.6,
      exhaleHoldSeconds: 8,
    });
  });

  it("interpolates every phase duration for gradual pace changes", () => {
    const slow = {
      inhaleSeconds: 4,
      inhaleHoldSeconds: 1,
      exhaleSeconds: 6,
      exhaleHoldSeconds: 1,
    };
    expect(interpolateBreathTiming(timing, slow, 0.5)).toEqual({
      inhaleSeconds: 3,
      inhaleHoldSeconds: 0.75,
      exhaleSeconds: 4.5,
      exhaleHoldSeconds: 0.75,
    });
  });
});

describe("Breath Mirror physiology lock", () => {
  it("morphs one compound anatomical silhouette as lung volume rises", () => {
    const empty = lungSilhouettePath(0);
    const full = lungSilhouettePath(1);

    expect(empty).not.toBe(full);
    expect(empty.match(/\bM\b/g)).toHaveLength(2);
    expect(full.match(/\bZ\b/g)).toHaveLength(2);
    expect(full).toContain("64.00");
    expect(empty).toContain("91.00");
  });

  it("accepts only a ready Polar phase and fails closed when ACC is stale", () => {
    const lock = new PolarBreathLock(650);
    const frame = lock.accept(
      {
        calibrated: true,
        ready: true,
        phase: 1,
        volume01: 0.76,
        derivativePerSecond: 0.09,
        values: {
          breathing_calibration: 1,
          breathing_signal_ready: 1,
          breathing_signal_confidence: 0.84,
        },
        diagnostics: { confidence01: 0.84 },
      },
      1_000,
    );

    expect(frame).toMatchObject({
      ready: true,
      stale: false,
      phase: "inhale",
      phaseValue: 1,
      volume01: 0.76,
      confidence01: 0.84,
    });
    expect(lock.read(1_650)?.ready).toBe(true);
    expect(lock.read(1_651)).toMatchObject({
      ready: false,
      stale: true,
      phase: "hold",
      phaseValue: 0,
      confidence01: 0,
      flow01: 0,
    });
  });

  it("reports calibration without treating not-ready motion as a live phase", () => {
    const lock = new PolarBreathLock();
    const frame = lock.accept(
      {
        calibrated: false,
        ready: false,
        phase: -1,
        volume01: 0.42,
        values: { breathing_calibration: 0.58 },
      },
      250,
    );

    expect(frame).toMatchObject({
      calibration01: 0.58,
      ready: false,
      phase: "hold",
      phaseValue: 0,
      confidence01: 0,
    });
  });
});

describe("Breath Mirror sonic aperture", () => {
  it("opens several spatial and timbral dimensions without mapping volume to gain", () => {
    const closed = mapBreathSonicSpace(0, 0.72);
    const open = mapBreathSonicSpace(1, 0.72);

    expect(open.openness01).toBe(1);
    expect(closed.openness01).toBe(0);
    expect(open.cutoffMultiplier).toBeGreaterThan(closed.cutoffMultiplier);
    expect(open.mouthResonanceHz).toBeGreaterThan(closed.mouthResonanceHz);
    expect(open.spectralSpread).toBeGreaterThan(closed.spectralSpread);
    expect(open.stereoWidth).toBeGreaterThan(closed.stereoWidth);
    expect(open.diffusionMix).toBeGreaterThan(closed.diffusionMix);
    expect(open.roughnessMultiplier).toBeLessThan(closed.roughnessMultiplier);
    expect(open).not.toHaveProperty("gain");
  });

  it("describes inhale as opening and exhale as closing", () => {
    expect(sonicMotionForPhase("inhale", 0.4)).toBe("opening");
    expect(sonicMotionForPhase("exhale", 0.6)).toBe("closing");
    expect(sonicMotionForPhase("inhale-hold", 0.9)).toBe("open");
    expect(sonicMotionForPhase("exhale-hold", 0.1)).toBe("closed");
    expect(sonicQualities(0.9)).toBe("broad · resonant · diffuse");
    expect(sonicQualities(0.1)).toBe("narrow · dry · focused");
  });
});
