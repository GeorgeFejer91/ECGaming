import { describe, expect, it } from "vitest";
import { CockpitRecoveryGate } from "../src/game/ground-cockpit";

describe("integrated cockpit recovery gate", () => {
  it("starts ready, then requires three continuous seconds after signal loss", () => {
    const gate = new CockpitRecoveryGate();
    expect(gate.begin(true, 0)).toEqual({ ready: true, holding: false });
    expect(gate.update(false, 100)).toEqual({ ready: false, holding: true });
    expect(gate.update(true, 200)).toEqual({
      ready: false,
      holding: true,
      countdownSeconds: 3,
    });
    expect(gate.update(true, 1_250).countdownSeconds).toBe(2);
    expect(gate.update(true, 2_250).countdownSeconds).toBe(1);
    expect(gate.update(true, 3_200)).toEqual({
      ready: true,
      holding: false,
    });
  });

  it("cancels and restarts recovery when readiness drops again", () => {
    const gate = new CockpitRecoveryGate();
    gate.begin(true, 0);
    gate.update(false, 100);
    gate.update(true, 200);
    expect(gate.update(false, 2_900)).toEqual({
      ready: false,
      holding: true,
    });
    expect(gate.update(true, 3_000).countdownSeconds).toBe(3);
    expect(gate.update(true, 5_999).countdownSeconds).toBe(1);
    expect(gate.update(true, 6_000)).toEqual({
      ready: true,
      holding: false,
    });
  });
});
