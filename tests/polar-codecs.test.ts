import { describe, expect, it } from "vitest";
import {
  decodePolarEcg,
  decodePolarHeartRate,
  PolarMetricProcessor,
  polarWebBluetoothSupport,
} from "../src/vendor/affect-tracker/polar-stream.js";

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
});
