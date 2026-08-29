import { describe, expect, it } from "vitest";
import {
  createGameHeartbeatMessage,
  isFreshGameHeartbeatMessage,
  isGameHeartbeatMessage,
} from "../src/game/heartbeat-channel";

describe("game heartbeat channel", () => {
  it("creates a bounded versioned message", () => {
    const message = createGameHeartbeatMessage(
      "ground-control",
      {
        source: "ecg-rpeak",
        beatCounter: 7,
        ageMs: -4,
        confidence: 2,
        physicalPolar: true,
        simulated: false,
        ready: true,
      },
      10_000,
    );
    expect(message).toMatchObject({
      kind: "ecgaming-heartbeat",
      version: 1,
      beatCounter: 7,
      ageMs: 0,
      confidence: 1,
      sentAtEpochMs: 10_000,
    });
    expect(isGameHeartbeatMessage(message)).toBe(true);
  });

  it("rejects stale, unready, and malformed messages", () => {
    const base = createGameHeartbeatMessage(
      "mobile-direct",
      {
        source: "polar-rr",
        beatCounter: 8,
        ageMs: 20,
        confidence: 0.8,
        physicalPolar: true,
        simulated: false,
        ready: true,
      },
      20_000,
    );
    expect(isFreshGameHeartbeatMessage(base, 20_400)).toBe(true);
    expect(isFreshGameHeartbeatMessage(base, 20_600)).toBe(false);
    expect(
      isFreshGameHeartbeatMessage({ ...base, ageMs: 251 }, 20_100),
    ).toBe(false);
    expect(
      isFreshGameHeartbeatMessage({ ...base, ready: false }, 20_100),
    ).toBe(false);
    expect(isGameHeartbeatMessage({ ...base, confidence: 4 })).toBe(false);
  });
});
