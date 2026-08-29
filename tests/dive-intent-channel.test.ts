import { describe, expect, it } from "vitest";
import {
  BreathingDiveGate,
  DIVE_HOLD_MS,
  DIVE_MAX_ACTIVE_MS,
  DIVE_RECOVERY_MS,
  isGameDiveMessage,
} from "../src/game/dive-intent-channel";

const physical = (volume01: number) => ({
  volume01,
  ready: true,
  physicalPolar: true,
  simulated: false,
  signalAgeMs: 20,
});

describe("breathing dive intent", () => {
  it("arms only after a stable upper-crest hold", () => {
    const gate = new BreathingDiveGate();
    expect(gate.update(physical(0.92), 0).state).toBe("hold");
    for (let now = 50; now < DIVE_HOLD_MS; now += 50)
      expect(gate.update(physical(0.92 + (now % 100 ? 0.005 : 0)), now).active).toBe(false);
    const armed = gate.update(physical(0.92), DIVE_HOLD_MS);
    expect(armed.state).toBe("active");
    expect(armed.active).toBe(true);
  });

  it("rejects rising motion, stale data, and simulation", () => {
    const gate = new BreathingDiveGate();
    gate.update(physical(0.88), 0);
    expect(gate.update(physical(0.96), 400).reason).toBe("steady-the-crest");
    expect(
      gate.update({ ...physical(0.95), signalAgeMs: 501 }, 500).state,
    ).toBe("unavailable");
    expect(
      gate.update(
        { ...physical(0.95), physicalPolar: false, simulated: true },
        600,
      ).reason,
    ).toBe("simulation-blocked");
  });

  it("releases on exhale and imposes bounded recovery", () => {
    const gate = new BreathingDiveGate();
    for (let now = 0; now <= DIVE_HOLD_MS; now += 50)
      gate.update(physical(0.93), now);
    expect(gate.update(physical(0.8), DIVE_HOLD_MS + 50).state).toBe(
      "recovery",
    );
    expect(
      gate.update(physical(0.55), DIVE_HOLD_MS + DIVE_RECOVERY_MS).state,
    ).toBe("recovery");
    expect(
      gate.update(
        physical(0.55),
        DIVE_HOLD_MS + DIVE_RECOVERY_MS + 51,
      ).state,
    ).toBe("inhale");
  });

  it("caps one active interval", () => {
    const gate = new BreathingDiveGate();
    for (let now = 0; now <= DIVE_HOLD_MS; now += 50)
      gate.update(physical(0.93), now);
    const capped = gate.update(physical(0.93), DIVE_HOLD_MS + DIVE_MAX_ACTIVE_MS);
    expect(capped.active).toBe(false);
    expect(capped.reason).toBe("active-limit");
  });

  it("validates only bounded, versioned public messages", () => {
    expect(
      isGameDiveMessage({
        kind: "ecgaming-dive-intent",
        version: 1,
        route: "ground-control",
        state: "active",
        active: true,
        volume01: 0.94,
        holdProgress01: 1,
        activeRemainingMs: 7000,
        reason: "inspiratory-crest-held",
        physicalPolar: true,
        simulated: false,
        signalAgeMs: 15,
        sentAtEpochMs: Date.now(),
      }),
    ).toBe(true);
  });
});
