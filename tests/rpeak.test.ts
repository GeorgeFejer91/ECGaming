import { describe, expect, it } from "vitest";
import {
  CausalRPeakDetector,
  frameSampleTimestamps,
} from "../src/signals/rpeak";

describe("causal R-peak detector", () => {
  it("reconstructs each sample timestamp from the PMD last-sample timestamp", () => {
    expect(frameSampleTimestamps("2000000000", 3, 2)).toEqual([
      1000, 1500, 2000,
    ]);
  });
  it("detects regular positive and inverted peaks with a refractory period", () => {
    for (const polarity of [1, -1] as const) {
      const detector = new CausalRPeakDetector(130);
      detector.setReferenceRr(1000);
      let count = 0;
      for (let index = 0; index < 130 * 8; index += 1) {
        const phase = index % 130;
        const sample =
          polarity *
          (phase === 50
            ? 1200
            : phase === 51
              ? -260
              : Math.sin(index * 0.21) * 10);
        const beat = detector.pushSample(sample, (index / 130) * 1000);
        if (beat && detector.ready) count += 1;
      }
      expect(count).toBeGreaterThanOrEqual(5);
      expect(count).toBeLessThanOrEqual(7);
    }
  });
});
