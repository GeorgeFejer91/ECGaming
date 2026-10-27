import { describe, expect, it, vi } from "vitest";
import {
  createGameHeartbeatMessage,
  isFreshGameHeartbeatMessage,
  isGameHeartbeatMessage,
  GameHeartbeatPublisher,
} from "../src/game/heartbeat-channel";

describe("game heartbeat channel", () => {
  it("ignores a queued heartbeat after teardown and closes only once", () => {
    let closed = false;
    const post = vi.fn(() => { if (closed) throw new DOMException("Channel is closed", "InvalidStateError"); });
    const close = vi.fn(() => { closed = true; });
    vi.stubGlobal("BroadcastChannel", class { postMessage = post; close = close; });
    try {
      const publisher = new GameHeartbeatPublisher("ground-control");
      const input = { source: "polar-rr" as const, beatCounter: 1, ageMs: 0, confidence: 1, physicalPolar: true, simulated: false, ready: true };
      publisher.publish(input);
      expect(post).toHaveBeenCalledTimes(1);
      publisher.close(); publisher.close();
      expect(() => publisher.publish({ ...input, beatCounter: 2 })).not.toThrow();
      expect(post).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });

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
