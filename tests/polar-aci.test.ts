import { describe, expect, it } from "vitest";
import { PolarMetricProcessor } from "../src/vendor/affect-tracker/polar-stream.js";

function push(processor: PolarMetricProcessor, rr: number[]) {
  processor.pushHeartRate({ rrIntervalsMs: rr });
}

function aci(processor: PolarMetricProcessor): number | undefined {
  return (processor.snapshot().values as Record<string, number>).aci;
}

describe("Acceleration Capacity Index", () => {
  it("requires at least three RR intervals", () => {
    const processor = new PolarMetricProcessor();
    push(processor, [800, 790]);
    expect(aci(processor)).toBeUndefined();
    push(processor, [780]);
    expect(aci(processor)).toBe(0);
  });

  it("is zero for monotonic runs", () => {
    const processor = new PolarMetricProcessor();
    push(processor, [800, 810, 820, 830, 840]);
    expect(aci(processor)).toBe(0);
  });

  it("is one when every beat reverses direction", () => {
    const processor = new PolarMetricProcessor();
    push(processor, [800, 780, 800, 780, 800, 780]);
    expect(aci(processor)).toBe(1);
  });

  it("matches the manual sign-change proportion", () => {
    const processor = new PolarMetricProcessor();
    push(processor, [800, 780, 760, 780, 800, 810, 790]);
    // Diffs: -20 -20 +20 +20 +10 -20 → two sign changes over five pairs.
    expect(aci(processor)).toBeCloseTo(0.4, 5);
  });

  it("tracks a live window as more beats arrive", () => {
    const processor = new PolarMetricProcessor();
    push(processor, [800, 780, 800, 780, 800]);
    expect(aci(processor)).toBe(1);
    push(processor, [810, 820, 830, 840]);
    // Diffs: -20 +20 -20 +20 +10 +10 +10 +10 → three changes over seven pairs.
    expect(aci(processor)).toBeCloseTo(3 / 7, 5);
  });
});