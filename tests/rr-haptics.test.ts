import { describe, expect, it, vi } from "vitest";
import { HEARTBEAT_HAPTIC_MS, PolarRrHaptics } from "../src/phone-tilt/rr-haptics";
import { PolarControlProcessor } from "../src/flight-session/polar-source";

describe("phone-local Polar RR haptics", () => {
  it("uses actual ECG detector peaks and suppresses double RR feedback", () => {
    const vibrate = vi.fn(); let now = 0;
    const haptics = new PolarRrHaptics(vibrate, () => true, () => now);
    const processor = new PolarControlProcessor(ageMs => haptics.handle({ kind: "r-peak", ageMs }));
    processor.handle({ kind: "connection", connected: true }, now);
    haptics.handle({ kind: "connection", connected: true }); vibrate.mockClear();
    // Warm up with two seconds of ECG, then feed a fresh sharp R peak at the frame end.
    processor.handle({ kind: "ecg", microvolts: Array(260).fill(0), sensorTimestampNs: 2_000_000_000n }, now);
    now = 100;
    processor.handle({ kind: "ecg", microvolts: [0, 0, 1000], sensorTimestampNs: 2_100_000_000n }, now);
    expect(vibrate.mock.calls).toEqual([[HEARTBEAT_HAPTIC_MS]]);
    now = 500; haptics.handle({ kind: "heart-rate", rrIntervalsMs: [800] });
    expect(vibrate).toHaveBeenCalledTimes(1);
    now = 900;
    processor.handle({ kind: "ecg", microvolts: [0, 0, 1000], sensorTimestampNs: 2_900_000_000n }, now);
    expect(vibrate.mock.calls).toEqual([[HEARTBEAT_HAPTIC_MS], [HEARTBEAT_HAPTIC_MS]]);
    now = 1700; haptics.handle({ kind: "r-peak", ageMs: 400 });
    expect(vibrate).toHaveBeenCalledTimes(2);
    now = 4000; haptics.handle({ kind: "heart-rate", rrIntervalsMs: [800] });
    expect(vibrate).toHaveBeenLastCalledWith(HEARTBEAT_HAPTIC_MS);
    expect(vibrate).toHaveBeenCalledTimes(3);
  });
  it("pulses for fresh RR notifications without replaying batched historical beats or using BPM", () => {
    const vibrate = vi.fn(); let now = 0;
    const haptics = new PolarRrHaptics(vibrate, () => true, () => now);
    haptics.handle({ kind: "heart-rate", rrIntervalsMs: [800] });
    expect(vibrate).not.toHaveBeenCalled();
    haptics.handle({ kind: "connection", connected: true }); vibrate.mockClear();
    haptics.handle({ kind: "heart-rate", rrIntervalsMs: [800, 790, 810] });
    expect(vibrate.mock.calls).toEqual([[HEARTBEAT_HAPTIC_MS]]);
    now = 40; haptics.handle({ kind: "heart-rate", rrIntervalsMs: [810] });
    now = 810; haptics.handle({ kind: "heart-rate", rrIntervalsMs: [805] });
    expect(vibrate.mock.calls).toEqual([[HEARTBEAT_HAPTIC_MS], [HEARTBEAT_HAPTIC_MS]]);
    now = 2000;
    for (const rrIntervalsMs of [undefined, [], [NaN], [0], [249], [2501], ["800"]])
      haptics.handle({ kind: "heart-rate", rrIntervalsMs });
    expect(vibrate).toHaveBeenCalledTimes(2);
  });
  it("cancels on hide and disconnect, ignores simulation and never queues a pulse for later", () => {
    const vibrate = vi.fn(); let visible = true; let now = 0;
    const haptics = new PolarRrHaptics(vibrate, () => visible, () => now);
    haptics.handle({ kind: "connection", connected: true });
    haptics.handle({ kind: "heart-rate", rrIntervalsMs: [800] });
    visible = false; haptics.pause(); vibrate.mockClear();
    now = 800; haptics.handle({ kind: "heart-rate", rrIntervalsMs: [800] });
    visible = true; expect(vibrate).not.toHaveBeenCalled();
    now = 1600; haptics.handle({ kind: "heart-rate", rrIntervalsMs: [800] });
    expect(vibrate.mock.calls).toEqual([[HEARTBEAT_HAPTIC_MS]]);
    haptics.handle({ kind: "connection", connected: false });
    expect(vibrate).toHaveBeenLastCalledWith(0); vibrate.mockClear();
    now = 2400; haptics.handle({ kind: "heart-rate", rrIntervalsMs: [800] });
    expect(vibrate).not.toHaveBeenCalled();
    haptics.handle({ kind: "connection", connected: true }); vibrate.mockClear();
    haptics.handle({ kind: "heart-rate", mock: true, rrIntervalsMs: [800] });
    expect(vibrate.mock.calls).toEqual([[0]]);
  });
  it("contains unsupported or rejected vibration API calls", () => {
    const haptics = new PolarRrHaptics(() => { throw new Error("unsupported"); }, () => true);
    expect(() => {
      haptics.handle({ kind: "connection", connected: true });
      haptics.handle({ kind: "heart-rate", rrIntervalsMs: [800] });
      haptics.stop();
    }).not.toThrow();
  });
});
