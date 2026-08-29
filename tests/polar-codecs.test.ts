import { describe, expect, it } from "vitest";
import {
  decodePolarEcg,
  decodePolarHeartRate,
  PolarMetricProcessor,
  polarWebBluetoothSupport,
} from "../src/vendor/affect-tracker/polar-stream.js";
import {
  decodePolarAccelerometer,
  PolarBreathingProcessor,
} from "../src/vendor/polar-stream/breathing.js";

describe("Polar browser signal layer", () => {
  it("decodes HR and every RR notification entry", () => {
    const result = decodePolarHeartRate(
      new Uint8Array([0x10, 72, 0x00, 0x04, 0x33, 0x03]),
    );
    expect(result.beatsPerMinute).toBe(72);
    expect(result.rrIntervalsMs).toEqual([1000, 799.8046875]);
  });
  it("decodes signed 24-bit ECG and the last-sample sensor timestamp", () => {
    const bytes = new Uint8Array(16);
    bytes[0] = 0;
    bytes[1] = 1;
    bytes[9] = 0;
    bytes.set([0xff, 0xff, 0xff, 0x34, 0x12, 0], 10);
    expect(decodePolarEcg(bytes)).toEqual({
      sensorTimestampNs: "1",
      microvolts: [-1, 0x1234],
    });
  });
  it("does not fake readiness without Web Bluetooth", () => {
    expect(
      polarWebBluetoothSupport({
        secureContext: true,
        navigatorObject: {} as Navigator,
      }).supported,
    ).toBe(false);
    const processor = new PolarMetricProcessor();
    expect(
      (processor.snapshot().values as Record<string, number>).excitement_score,
    ).toBeUndefined();
  });

  it("decodes uncompressed 200 Hz Polar accelerometer samples", () => {
    const bytes = new Uint8Array(22);
    bytes[0] = 0x02;
    bytes[1] = 0x80;
    bytes[9] = 0x01;
    const view = new DataView(bytes.buffer);
    view.setInt16(10, -120, true);
    view.setInt16(12, 1000, true);
    view.setInt16(14, 45, true);
    view.setInt16(16, 130, true);
    view.setInt16(18, 995, true);
    view.setInt16(20, -40, true);
    expect(decodePolarAccelerometer(bytes)).toEqual({
      sensorTimestampNs: "128",
      samples: [
        { xMg: -120, yMg: 1000, zMg: 45 },
        { xMg: 130, yMg: 995, zMg: -40 },
      ],
    });
  });

  it("decodes Polar delta-compressed accelerometer samples", () => {
    const bytes = new Uint8Array(20);
    bytes[0] = 0x02;
    bytes[1] = 0x40;
    bytes[9] = 0x81;
    const view = new DataView(bytes.buffer);
    view.setInt16(10, 100, true);
    view.setInt16(12, -200, true);
    view.setInt16(14, 300, true);
    bytes[16] = 4;
    bytes[17] = 1;
    // One little-endian signed 4-bit XYZ delta: +1, -2, +3.
    bytes[18] = 0xe1;
    bytes[19] = 0x03;
    expect(decodePolarAccelerometer(bytes)).toEqual({
      sensorTimestampNs: "64",
      samples: [
        { xMg: 100, yMg: -200, zMg: 300 },
        { xMg: 101, yMg: -202, zMg: 303 },
      ],
    });
  });

  it("keeps breathing unavailable until timed ACC calibration completes", () => {
    const processor = new PolarBreathingProcessor({
      calibrationWindowSeconds: 2,
    });
    let snapshot;
    for (let frame = 0; frame < 14; frame += 1) {
      const samples = Array.from({ length: 40 }, (_, index) => {
        const sampleIndex = frame * 40 + index;
        const phase = (sampleIndex / 200) * Math.PI * 0.8;
        return {
          xMg: Math.round(Math.sin(phase) * 45),
          yMg: 1000,
          zMg: Math.round(Math.cos(phase) * 30),
        };
      });
      snapshot = processor.pushTimed(
        samples,
        String(BigInt((frame + 1) * 40) * 5_000_000n),
      );
    }
    if (!snapshot) throw new Error("Expected a breathing snapshot");
    expect(snapshot.calibrated).toBe(true);
    expect(snapshot.ready).toBe(true);
    expect(snapshot.values.breathing_volume).toBeGreaterThanOrEqual(0);
    expect(snapshot.values.breathing_volume).toBeLessThanOrEqual(1);
    expect(snapshot.values.breathing_signal_ready).toBe(1);
    expect(snapshot.values.acc_breathing_magnitude).toEqual(
      expect.any(Number),
    );
    expect(snapshot.values.breathing_axis_range).toBeGreaterThan(0);
    expect(snapshot.derivativePerSecond).toEqual(expect.any(Number));
    expect(snapshot.presentationPoints.length).toBeGreaterThan(0);
    expect(snapshot.presentationPoints.at(-1)?.volume01).toBe(
      snapshot.values.breathing_volume,
    );
    expect(
      BigInt(snapshot.presentationPoints.at(-1)?.sourceTimestampNs ?? "0"),
    ).toBeGreaterThan(
      BigInt(snapshot.presentationPoints[0]?.sourceTimestampNs ?? "0"),
    );
  });

  it("fails breathing readiness closed across a source-time ACC gap", () => {
    const processor = new PolarBreathingProcessor({
      calibrationWindowSeconds: 1,
      staleTimeoutSeconds: 0.5,
    });
    const samplesFor = (offset: number) =>
      Array.from({ length: 40 }, (_, index) => {
        const phase = ((offset + index) / 200) * Math.PI;
        return {
          xMg: Math.round(Math.sin(phase) * 55),
          yMg: 1000,
          zMg: Math.round(Math.cos(phase) * 35),
        };
      });
    let snapshot;
    for (let frame = 0; frame < 8; frame += 1) {
      snapshot = processor.pushTimed(
        samplesFor(frame * 40),
        String(BigInt((frame + 1) * 40) * 5_000_000n),
      );
    }
    expect(snapshot?.ready).toBe(true);

    snapshot = processor.pushTimed(samplesFor(8 * 40), "3000000000");
    expect(snapshot?.lost).toBe(true);
    expect(snapshot?.ready).toBe(false);
    expect(snapshot?.values.breathing_signal_ready).toBe(0);
    expect(snapshot?.diagnostics.forwardGaps).toBe(1);
  });
});
