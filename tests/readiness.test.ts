import { describe, expect, it } from "vitest";
import { flightLaunchReadiness } from "../src/signals/readiness";

const readyInput = {
  source: "remote-beacon" as const,
  phase: "live",
  nowMs: 5_000,
  lastSignalAtMs: 4_900,
  physicalPolar: true,
  simulation: false,
  remoteConfigReady: true,
  metricReady: true,
  normalizationReady: true,
  beatReady: true,
  aircraftReady: true,
};

describe("flight launch readiness", () => {
  it("accepts only a fresh live physical source with every dependency ready", () => {
    expect(flightLaunchReadiness(readyInput)).toEqual({
      ready: true,
      signalAgeMs: 100,
      reasons: [],
    });
  });

  it("fails closed for stale phase, simulation, and missing provenance", () => {
    const result = flightLaunchReadiness({
      ...readyInput,
      phase: "stale",
      physicalPolar: false,
      simulation: true,
    });
    expect(result.ready).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "source-not-live",
        "physical-polar-missing",
        "simulation-rejected",
      ]),
    );
  });

  it("rejects missing, future, and expired signal timestamps", () => {
    expect(
      flightLaunchReadiness({ ...readyInput, lastSignalAtMs: undefined }).reasons,
    ).toContain("signal-missing");
    expect(
      flightLaunchReadiness({ ...readyInput, lastSignalAtMs: 5_001 }).reasons,
    ).toContain("signal-stale");
    expect(
      flightLaunchReadiness({ ...readyInput, lastSignalAtMs: 2_999 }).reasons,
    ).toContain("signal-stale");
  });
});
