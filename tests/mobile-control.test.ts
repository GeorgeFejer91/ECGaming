import { describe, expect, it } from "vitest";
import {
  buildMobileMappings,
  mobileReadiness,
  sanitizeMobileSettings,
} from "../src/signals/mobile-control";

describe("smartphone direct controls", () => {
  it("builds safe mappings for heart rate and reversed RR altitude", () => {
    const heartRate = buildMobileMappings(
      sanitizeMobileSettings({
        altitudeMode: "heart_rate",
        beatSource: "polar-rr",
        throttle: 0.7,
        traffic: 0.25,
      }),
    );
    expect(heartRate.altitude).toMatchObject({
      metric: "heart_rate",
      minimum: 50,
      maximum: 160,
      reverse: false,
    });
    expect(heartRate.beatSource).toBe("polar-rr");
    expect(heartRate.throttle.manual).toBe(0.7);

    const rr = buildMobileMappings(
      sanitizeMobileSettings({ altitudeMode: "rr_interval" }),
    );
    expect(rr.altitude).toMatchObject({
      metric: "rr_interval",
      minimum: 400,
      maximum: 1_300,
      reverse: true,
    });
  });

  it("fails closed until physical HR, RR, ECG, detector, and mapped metric are ready", () => {
    const mappings = buildMobileMappings(
      sanitizeMobileSettings({ altitudeMode: "excitement_score" }),
    );
    const warming = mobileReadiness({
      simulated: false,
      connected: true,
      ecgReady: true,
      detectorReady: true,
      metrics: { heart_rate: 76, rr_interval: 789 },
      mappings,
    });
    expect(warming.ready).toBe(false);
    expect(warming.checks.mappedMetric).toBe(false);

    const ready = mobileReadiness({
      simulated: false,
      connected: true,
      ecgReady: true,
      detectorReady: true,
      metrics: {
        heart_rate: 76,
        rr_interval: 789,
        excitement_score: 0.42,
      },
      mappings,
    });
    expect(ready.ready).toBe(true);
  });

  it("marks simulator readiness independently of a physical Polar link", () => {
    const mappings = buildMobileMappings(sanitizeMobileSettings(null));
    const result = mobileReadiness({
      simulated: true,
      connected: false,
      ecgReady: false,
      detectorReady: false,
      metrics: { excitement_score: 0.35 },
      mappings,
    });
    expect(result.ready).toBe(true);
  });

  it("requires a calibrated ACC breathing signal when breath drives altitude", () => {
    const mappings = buildMobileMappings(
      sanitizeMobileSettings({ altitudeMode: "breathing_volume" }),
    );
    const base = {
      simulated: false,
      connected: true,
      ecgReady: true,
      detectorReady: true,
      metrics: {
        heart_rate: 72,
        rr_interval: 833,
        breathing_volume: 0.58,
      },
      mappings,
    };
    expect(mobileReadiness({ ...base, breathingReady: false }).ready).toBe(
      false,
    );
    expect(mobileReadiness({ ...base, breathingReady: true }).ready).toBe(true);
  });
});
