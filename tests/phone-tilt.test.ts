import { describe, it, expect } from "vitest";
import { createTiltInvitation, readTiltInvitation, tiltControllerUrl } from "../src/phone-tilt/invitation";
import { neutralControls, orientationAngles, phoneThrottle, TILT_SCOPE, TiltAuthority, TiltCalibration, validControls, validTiltState } from "../src/phone-tilt/controls";

describe("phone pairing", () => {
  it("creates independent bounded invitations and preserves the hosted project path", () => {
    const invitation = createTiltInvitation();
    expect(createTiltInvitation()).not.toEqual(invitation);
    for (const path of ["ground-control/", "flight/", "mobile/index.html"]) {
      const url = new URL(tiltControllerUrl(`https://example.org/ECGaming/${path}?old=1`, invitation));
      expect(url.pathname).toBe("/ECGaming/controller/");
      expect(url.search).toBe("");
      expect(readTiltInvitation(url.hash)).toEqual(invitation);
      expect(url.origin + url.pathname).not.toContain(invitation.secret);
    }
  });
  it("rejects truncated, duplicate, unexpected and unbounded invitation fields", () => {
    const valid = new URL(tiltControllerUrl("https://example.org/flight/", createTiltInvitation())).hash;
    expect(readTiltInvitation(valid)).toBeDefined();
    for (const bad of ["", "#room=abc&secret=1234", valid + "&x=1", valid + "&room=duplicate", "#" + "x".repeat(200)])
      expect(readTiltInvitation(bad)).toBeUndefined();
  });
});

describe("phone tilt mapping", () => {
  it("maps the same physical right bank in either landscape orientation", () => {
    const landscapeRight = orientationAngles({ beta: -20, gamma: -40 }, 90)!;
    const landscapeLeft = orientationAngles({ beta: 20, gamma: 40 }, 270)!;
    expect(landscapeRight.bank).toBeCloseTo(20);
    expect(landscapeLeft.bank).toBeCloseTo(20);
    expect(landscapeLeft.pitch).toBeCloseTo(landscapeRight.pitch);
    expect(orientationAngles({ beta: null, gamma: 0 }, 90)).toBeUndefined();
    expect(orientationAngles({ beta: NaN, gamma: 0 }, 90)).toBeUndefined();
  });
  it("centres a comfortable grip, ignores tremor, smooths larger tilt, and centres again", () => {
    const tilt = new TiltCalibration();
    expect(tilt.read({ beta: 0, gamma: -40 }, 90, 0)).toEqual(neutralControls());
    expect(tilt.calibrate({ beta: 0, gamma: -40 }, 90, 0)).toBe(true);
    expect(tilt.read({ beta: -2, gamma: -40 }, 90, 20).x).toBe(0);
    const first = tilt.read({ beta: -28, gamma: -40 }, 90, 40);
    expect(first.x).toBeGreaterThan(0); expect(first.x).toBeLessThan(.4);
    let sustained = first;
    for (let at = 60; at <= 600; at += 20) sustained = tilt.read({ beta: -28, gamma: -40 }, 90, at);
    expect(sustained.x).toBeGreaterThan(.99);
    tilt.calibrate({ beta: -28, gamma: -40 }, 90, 610);
    expect(tilt.read({ beta: -28, gamma: -40 }, 90, 630)).toEqual({ x: 0, y: 0, active: true });
  });
  it("measures forward/back independently and requires re-centring after a screen rotation", () => {
    const tilt = new TiltCalibration();
    tilt.calibrate({ beta: 0, gamma: -40 }, 90, 0);
    const away = tilt.read({ beta: 0, gamma: -65 }, 90, 100);
    expect(away.x).toBeCloseTo(0); expect(away.y).toBeGreaterThan(.6);
    expect(tilt.read({ beta: 0, gamma: -65 }, 270, 200)).toEqual(neutralControls());
    expect(tilt.read({ beta: 0, gamma: -65 }, 90, 300)).toEqual(neutralControls());
  });
});

describe("flight-owned phone authority", () => {
  it("expires held steering after 500 ms, and invalid input never renews the lease", () => {
    const authority = new TiltAuthority();
    authority.accept(TILT_SCOPE, { x: .8, y: .3, active: true }, 10);
    expect(authority.expire(509).active).toBe(true);
    expect(() => authority.accept(TILT_SCOPE, { x: NaN, y: 0, active: true }, 400)).toThrow();
    expect(authority.expire(510)).toMatchObject(neutralControls());
  });
  it("rejects wrong scopes and extra fields without partial mutation", () => {
    const authority = new TiltAuthority();
    const before = authority.snapshot();
    for (const controls of [{ x: 3, y: 0, active: true }, { x: 0, y: 0, active: true, altitude: 1 }, { x: 1, y: 0, active: false }])
      expect(() => authority.accept(TILT_SCOPE, controls, 20)).toThrow();
    expect(() => authority.accept("flight.altitude", { x: 0, y: 0, active: true }, 20)).toThrow();
    expect(authority.snapshot()).toEqual(before);
    expect(validControls({ x: 0, y: 0, active: true })).toBe(true);
    expect(validTiltState(before)).toBe(true);
    expect(validTiltState({ ...before, revision: -1 })).toBe(false);
  });
  it("renews unchanged valid input without revision churn; Stop immediately clears both axes", () => {
    const authority = new TiltAuthority();
    const controls = { x: 1, y: -.5, active: true };
    const first = authority.accept(TILT_SCOPE, controls, 10);
    expect(authority.accept(TILT_SCOPE, controls, 400).revision).toBe(first.revision);
    expect(authority.expire(700).active).toBe(true);
    authority.neutralize();
    expect(authority.snapshot()).toMatchObject(neutralControls());
  });
  it("adds bounded temporary speed trim and restores target speed when released or disabled", () => {
    const state = { x: 0, y: 1, active: true, speedEnabled: true };
    expect(phoneThrottle(.6, state)).toBe(1);
    expect(phoneThrottle(.6, { ...state, y: -1 })).toBeCloseTo(.1);
    expect(phoneThrottle(.6, { ...state, active: false })).toBe(.6);
    expect(phoneThrottle(.6, { ...state, speedEnabled: false })).toBe(.6);
  });
});
