import { describe, expect, it } from "vitest";
import {
  applyRingResult,
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
  it("scores passes and removes one of three lives on a miss", () => {
    expect(ringPassed(0, 0, 1, 1)).toBe(true);
    expect(applyRingResult(2, 3, true)).toEqual({
      score: 3,
      lives: 3,
      gameOver: false,
    });
    expect(applyRingResult(2, 1, false)).toEqual({
      score: 2,
      lives: 0,
      gameOver: true,
    });
  });
});
