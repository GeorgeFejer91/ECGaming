import { describe, expect, it } from "vitest";
import { RealtimeEcgTrace } from "../src/signals/realtime-ecg-trace";

describe("RealtimeEcgTrace", () => {
  it("scrolls continuously in source time between BLE notifications", () => {
    const trace = new RealtimeEcgTrace({
      sampleRateHz: 100,
      windowSeconds: 1,
    });
    trace.pushFrame([10, 20, 30], "30000000", 100);

    const received = trace.snapshot(100);
    const nextAnimationFrame = trace.snapshot(116);

    expect(received.rightEdge01).toBe(1);
    expect(received.sampleStep01).toBe(0.01);
    expect(nextAnimationFrame.rightEdge01).toBeCloseTo(0.984, 6);
    expect(nextAnimationFrame.values).toEqual([10, 20, 30]);
  });

  it("adds a contiguous frame without moving existing samples on screen", () => {
    const trace = new RealtimeEcgTrace({
      sampleRateHz: 100,
      windowSeconds: 1,
    });
    trace.pushFrame([10, 20, 30], "30000000", 100);
    const previousRightEdge = trace.snapshot(120).rightEdge01;

    trace.pushFrame([40, 50], "50000000", 120);
    const updated = trace.snapshot(120);
    const oldLatestX = updated.rightEdge01 - updated.sampleStep01 * 2;

    expect(oldLatestX).toBeCloseTo(previousRightEdge, 6);
    expect(updated.values).toEqual([10, 20, 30, 40, 50]);
  });

  it("shows transport jitter as honest sample age instead of a waveform snap", () => {
    const trace = new RealtimeEcgTrace({
      sampleRateHz: 100,
      windowSeconds: 1,
    });
    trace.pushFrame([10, 20, 30], "30000000", 100);
    trace.pushFrame([40, 50], "50000000", 150);

    const delayed = trace.snapshot(150);
    expect(delayed.latestAgeMs).toBe(30);
    expect(delayed.rightEdge01).toBeCloseTo(0.97, 6);
  });

  it("breaks the trace across a source-time discontinuity", () => {
    const trace = new RealtimeEcgTrace({ sampleRateHz: 100 });
    trace.pushFrame([1, 2, 3], "30000000", 100);
    trace.pushFrame([9, 10], "200000000", 200);

    expect(trace.snapshot(200).values).toEqual([9, 10]);
  });

  it("bounds memory to the visible ECG window", () => {
    const trace = new RealtimeEcgTrace({
      sampleRateHz: 10,
      windowSeconds: 1,
    });
    trace.pushFrame(
      Array.from({ length: 30 }, (_, index) => index),
      "3000000000",
      100,
    );

    expect(trace.sampleCount).toBe(trace.capacity);
    expect(trace.snapshot(100).values.at(-1)).toBe(29);
  });
});
