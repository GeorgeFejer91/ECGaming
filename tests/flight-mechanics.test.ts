import { describe, expect, it } from "vitest";
import { advanceSteering, cardiacEnvelope, FLIGHT_HALF_WIDTH, RrBeatClock, touchesMountain, type RrHeartbeatSignal } from "../src/game/flight-mechanics";

describe("gentle flight steering", () => {
  it("matches travel across frame rates and brakes without springing to center", () => {
    const travel = (hz: number) => {
      let state = { position: 0, velocity: 0 };
      for (let i = 0; i < hz; i++) state = advanceSteering(state, 1, 1/hz);
      return state;
    };
    expect(travel(30).position).toBeCloseTo(travel(120).position, 8);
    expect(advanceSteering({ position: 0, velocity: 0 }, 1, .05).position).toBeLessThan(.04);
    const before = travel(60);
    const stopped = advanceSteering(before, 0, 1);
    expect(stopped.position).toBeGreaterThan(before.position);
    expect(stopped.position-before.position).toBeLessThan(.75);
    expect(stopped.velocity).toBeLessThan(.01);
  });
  it("holds the flight boundary and reverses immediately without stored outward velocity", () => {
    const edge = advanceSteering({ position: 12.99, velocity: 6 }, 1, .1);
    expect(edge).toEqual({ position: FLIGHT_HALF_WIDTH, velocity: 0 });
    expect(advanceSteering(edge, -1, .1).position).toBeLessThan(FLIGHT_HALF_WIDTH);
  });
});

describe("Polar RR interaction clock", () => {
  const signal = (counter: number, extra: Partial<RrHeartbeatSignal> = {}): RrHeartbeatSignal =>
    ({ sessionId: "polar-a", counter, ageMs: 20, rrMs: 700, ready: true, ...extra });
  it("uses received beats only, spaces batches, and ignores duplicate/out-of-order counters", () => {
    const clock = new RrBeatClock();
    clock.accept(signal(10), true);
    expect(clock.advance(1)).toBeUndefined();
    clock.accept(signal(12), true);
    expect(clock.advance(.01)).toBe(700);
    clock.accept(signal(12), true);
    clock.accept(signal(11), true);
    expect(clock.advance(.3)).toBeUndefined();
    expect(clock.advance(.4)).toBe(700);
    expect(clock.advance(10)).toBeUndefined();
  });
  it("discards stale, paused and previous-session beats without a recovery burst", () => {
    const clock = new RrBeatClock();
    clock.accept(signal(10), true);
    clock.accept(signal(12), true);
    clock.accept(signal(12, { ready: false }), true);
    expect(clock.advance(1)).toBeUndefined();
    clock.accept(signal(13), false);
    clock.accept(signal(13), true);
    expect(clock.advance(1)).toBeUndefined();
    clock.accept(signal(14, { ageMs: 2000 }), true);
    expect(clock.advance(1)).toBeUndefined();
    clock.accept(signal(3, { sessionId: "polar-b" }), true);
    expect(clock.advance(1)).toBeUndefined();
    clock.accept(signal(4, { sessionId: "polar-b" }), true);
    expect(clock.advance(.01)).toBe(700);
  });
  it("handles uint32 rollover and ignores implausible counter jumps", () => {
    const clock = new RrBeatClock();
    clock.accept(signal(0xffffffff), true);
    clock.accept(signal(0), true);
    expect(clock.advance(.01)).toBe(700);
    clock.accept(signal(1000), true);
    expect(clock.advance(5)).toBeUndefined();
  });
  it("returns to a resting airframe between beats without periodic idle pulsation", () => {
    expect(cardiacEnvelope(0, 700)).toBe(0);
    expect(cardiacEnvelope(.08, 700)).toBeGreaterThan(.3);
    expect(cardiacEnvelope(.7, 700)).toBe(0);
    expect(cardiacEnvelope(Infinity)).toBe(0);
  });
});

describe("mountain contact", () => {
  const peak = { x: 0, y: -2, z: 0, radius: 8, height: 10, rotation: .7 };
  it("hits the visible mountain body but permits flying over a peak or past a sloped edge", () => {
    expect(touchesMountain(0, 2, 0, peak)).toBe(true);
    expect(touchesMountain(0, 9, 0, peak)).toBe(false);
    expect(touchesMountain(7, 6, 0, peak)).toBe(false);
    expect(touchesMountain(0, 2, 14, peak)).toBe(false);
  });
});
