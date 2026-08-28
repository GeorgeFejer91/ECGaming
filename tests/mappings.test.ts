import { describe, expect, it } from "vitest";
import {
  AttackReleaseSmoother,
  commandValue,
  DEFAULT_MAPPINGS,
  sanitizeMappings,
} from "../src/signals/mappings";

describe("signal mappings", () => {
  it("maps excitement to signed altitude and manual controls to unit values", () => {
    expect(
      commandValue("altitude", { excitement_score: 0.75 }, DEFAULT_MAPPINGS),
    ).toBe(0.5);
    expect(commandValue("throttle", {}, DEFAULT_MAPPINGS)).toBe(0.5);
  });
  it("reverses and sanitizes imported settings", () => {
    const value = sanitizeMappings({
      altitude: {
        metric: "heart_rate",
        minimum: 60,
        maximum: 120,
        reverse: true,
        attackMs: -1,
        releaseMs: 99999,
        manual: 0,
      },
    });
    expect(commandValue("altitude", { heart_rate: 60 }, value)).toBe(1);
    expect(value.altitude.attackMs).toBeGreaterThanOrEqual(0);
    expect(value.altitude.releaseMs).toBe(5000);
  });
  it("uses independent attack and release time constants", () => {
    const smoother = new AttackReleaseSmoother(0);
    const rising = smoother.update(1, 100, 100, 1000);
    const falling = smoother.update(0, 100, 100, 1000);
    expect(rising).toBeGreaterThan(0.6);
    expect(falling).toBeGreaterThan(0.5);
  });
});
