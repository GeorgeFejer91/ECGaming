import { describe, expect, it } from "vitest";
import { WingEcgSignal, type WingEcgFrame } from "../src/signals/wing-ecg-signal";

const frame = (overrides: Partial<WingEcgFrame> = {}): WingEcgFrame => ({
  sourceId: "polar-a", sensorTimestampNs: "1000000000",
  microvolts: [0, -100, 1100, -200, 0], simulated: false, ...overrides,
});

describe("local wing ECG", () => {
  it("retains the measured samples and R peak, then expires without inventing new samples", () => {
    const signal = new WingEcgSignal();
    signal.accept(frame(), 1000);
    const first = signal.snapshot(1000);
    expect(first.values).toEqual(frame().microvolts);
    expect(first.state).toBe("live");
    expect(Math.abs((1100-first.center)/first.halfRange)).toBeLessThan(1);
    const later = signal.snapshot(1100);
    expect(later.values).toEqual(first.values);
    expect(later.rightEdge01).toBeLessThan(first.rightEdge01);
    expect(signal.snapshot(2001).state).toBe("stale");
  });

  it("duplicates, old and invalid packets cannot keep a disconnected signal live", () => {
    const signal = new WingEcgSignal();
    signal.accept(frame(), 0);
    expect(signal.accept(frame(), 800)).toBe(false);
    expect(signal.accept(frame({ sensorTimestampNs: "1" }), 900)).toBe(false);
    expect(signal.accept(frame({ microvolts: [NaN] }), 950)).toBe(false);
    expect(signal.accept(frame({ microvolts: Array(521).fill(0) }), 950)).toBe(false);
    expect(signal.snapshot(1001).state).toBe("stale");
  });

  it("clears previous participants and labels simulation separately", () => {
    const signal = new WingEcgSignal();
    signal.accept(frame(), 0);
    signal.accept(frame({ sourceId: "polar-b", microvolts: [7,8], sensorTimestampNs: "1" }), 10);
    expect(signal.snapshot(10).values).toEqual([7,8]);
    signal.accept(frame({ sourceId: "polar-b", simulated: true, microvolts: [9,10] }), 20);
    expect(signal.snapshot(20)).toMatchObject({ state: "simulated", values: [9,10] });
    signal.clear();
    expect(signal.snapshot(21)).toMatchObject({ state: "waiting", values: [] });
  });

  it("bounds retained data to three seconds and breaks the trace on a gap", () => {
    const signal = new WingEcgSignal();
    for (let i=0; i<100; i++) signal.accept(frame({
      sensorTimestampNs: String(BigInt(i+1)*1000000000n), microvolts: Array(130).fill(i),
    }), i*1000);
    expect(signal.snapshot(99000).values.length).toBeLessThanOrEqual(392);
    signal.accept(frame({ sensorTimestampNs: "110000000000", microvolts: [5,6] }), 110000);
    expect(signal.snapshot(110000).values).toEqual([5,6]);
  });
});
