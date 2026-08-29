import { describe, expect, it } from "vitest";
import {
  getBreathsPerMinute,
  interpolateBreathTiming,
  normalizeBreathTiming,
  sampleBreathCycle,
  type BreathTiming,
} from "../breath-sonification/breath-model";

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
