import { describe, expect, it } from "vitest";
import {
  aircraftAttitude,
  applyRingResult,
  headTiltSteering,
  ringIntervalSeconds,
  ringPassed,
  worldSpeed,
} from "../src/game/rules";

describe("heartbeat flight rules", () => {
  it("maps commands to the planned world ranges", () => {
    expect(worldSpeed(0)).toBe(8);
    expect(worldSpeed(1)).toBe(14);
    expect(ringIntervalSeconds(0)).toBe(10);
    expect(ringIntervalSeconds(1)).toBe(3);
  });
  it("rewards passes while misses remain neutral", () => {
    expect(ringPassed(0, 0, 1, 1)).toBe(true);
    expect(applyRingResult(2, true)).toEqual({ score: 3, points: 1 });
    expect(applyRingResult(2, false)).toEqual({ score: 2, points: 0 });
  });
  it("banks and yaws into lateral steering without exceeding visual limits", () => {
    expect(aircraftAttitude(3).roll).toBeCloseTo(-0.3);
    expect(aircraftAttitude(3).yaw).toBeCloseTo(-0.105);
    expect(aircraftAttitude(-3).roll).toBeCloseTo(0.3);
    expect(aircraftAttitude(-3).yaw).toBeCloseTo(0.105);
    expect(aircraftAttitude(99, 99)).toEqual({ roll: -0.48, yaw: -0.16 });
  });
  it("turns continuous headset roll into a deadzoned steering axis", () => {
    const degrees = (value: number) => (value * Math.PI) / 180;
    expect(headTiltSteering(degrees(3))).toBe(0);
    expect(headTiltSteering(degrees(16))).toBeCloseTo(-0.5);
    expect(headTiltSteering(degrees(-16))).toBeCloseTo(0.5);
    expect(headTiltSteering(degrees(45))).toBe(-1);
    expect(headTiltSteering(degrees(-45))).toBe(1);
    expect(headTiltSteering(Number.NaN)).toBe(0);
  });
});
