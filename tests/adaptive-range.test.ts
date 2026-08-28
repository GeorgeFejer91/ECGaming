import { describe, expect, it } from "vitest";
import { AdaptiveRangeTracker } from "../src/signals/adaptive-range";
import {
  commandValue,
  DEFAULT_MAPPINGS,
  resetBindingMetric,
  sanitizeMappings,
} from "../src/signals/mappings";

describe("session-scoped adaptive normalization", () => {
  it("fails closed through sample, warmup, and span gates", () => {
    const tracker = new AdaptiveRangeTracker();
    tracker.startSession("wearer-a");
    const binding = resetBindingMetric(DEFAULT_MAPPINGS.altitude, "heart_rate");
    binding.normalization = {
      mode: "adaptive",
      minimumSamples: 3,
      warmupMs: 1_000,
      minimumSpan: 8,
    };
    const mappings = sanitizeMappings({
      ...DEFAULT_MAPPINGS,
      altitude: binding,
    });

    tracker.observe("heart_rate", 70, binding.normalization, 0);
    tracker.observe("heart_rate", 75, binding.normalization, 500);
    expect(commandValue("altitude", { heart_rate: 75 }, mappings, tracker)).toBeUndefined();
    tracker.observe("heart_rate", 82, binding.normalization, 1_000);
    expect(tracker.snapshot("heart_rate", binding.normalization).ready).toBe(true);
    expect(commandValue("altitude", { heart_rate: 76 }, mappings, tracker)).toBeCloseTo(0);
  });

  it("resets learned physiology when the source session changes", () => {
    const tracker = new AdaptiveRangeTracker();
    const config = {
      mode: "adaptive" as const,
      minimumSamples: 2,
      warmupMs: 0,
      minimumSpan: 1,
    };
    tracker.startSession("wearer-a");
    tracker.observe("heart_rate", 60, config, 0);
    tracker.observe("heart_rate", 90, config, 1);
    expect(tracker.snapshot("heart_rate", config).ready).toBe(true);
    tracker.startSession("wearer-b");
    expect(tracker.snapshot("heart_rate", config)).toMatchObject({
      sourceSessionId: "wearer-b",
      sampleCount: 0,
      ready: false,
    });
  });

  it("resets metric-specific fixed bounds while preserving control behavior", () => {
    const heartRate = resetBindingMetric(
      DEFAULT_MAPPINGS.altitude,
      "heart_rate",
    );
    expect(heartRate).toMatchObject({
      metric: "heart_rate",
      minimum: 45,
      maximum: 160,
      normalization: { minimumSpan: 8 },
    });
    const legacy = sanitizeMappings({ altitude: { metric: "heart_rate" } });
    expect(legacy.altitude).toMatchObject({
      minimum: 45,
      maximum: 160,
      normalization: { mode: "fixed" },
    });
  });
});
