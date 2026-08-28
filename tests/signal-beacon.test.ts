import { describe, expect, it } from "vitest";
import {
  decodeSignalBeaconFrame,
  encodeSignalBeaconFrame,
  SIGNAL_BEACON_LEGACY_METRICS,
  SIGNAL_BEACON_LEGACY_WIRE_BYTES,
  SIGNAL_BEACON_WIRE_BYTES,
  SignalBeaconFlags,
} from "../src/protocol/flight-frame";

describe("derived-metric beacon wire frame", () => {
  it("round trips finite metrics and independent ECG/RR beat timing", () => {
    const bytes = encodeSignalBeaconFrame({
      sequence: 12,
      sessionToken: 0x12345678,
      metrics: {
        heart_rate: 73,
        breathing_volume: 0.62,
        rr_interval: 822,
        excitement_score: 0.41,
      },
      ecgBeatCounter: 7,
      rrBeatCounter: 6,
      ecgBeatAgeMs: 14,
      rrBeatAgeMs: 38,
      ecgBeatQuality: 0.94,
      rrBeatQuality: 0.75,
      flags:
        SignalBeaconFlags.physicalPolar |
        SignalBeaconFlags.ecgBeatDetectorReady |
        SignalBeaconFlags.accBreathingReady,
    });
    expect(bytes.byteLength).toBe(SIGNAL_BEACON_WIRE_BYTES);
    const decoded = decodeSignalBeaconFrame(bytes)!;
    expect(decoded).toMatchObject({
      sequence: 12,
      sessionToken: 0x12345678,
      ecgBeatCounter: 7,
      rrBeatCounter: 6,
    });
    expect(decoded.metrics.heart_rate).toBeCloseTo(73);
    expect(decoded.metrics.breathing_volume).toBeCloseTo(0.62);
    expect(decoded.metrics.excitement_score).toBeCloseTo(0.41);
  });

  it("still decodes schema-1 88-byte heart-only beacons", () => {
    const bytes = new ArrayBuffer(SIGNAL_BEACON_LEGACY_WIRE_BYTES);
    const view = new DataView(bytes);
    view.setUint32(0, 0x31474345, true);
    view.setUint16(4, 1, true);
    view.setUint16(6, SIGNAL_BEACON_LEGACY_WIRE_BYTES, true);
    view.setUint32(8, 4, true);
    view.setUint32(12, 123, true);
    const heartIndex = SIGNAL_BEACON_LEGACY_METRICS.indexOf("heart_rate");
    view.setUint32(16, 1 << heartIndex, true);
    view.setFloat32(48 + heartIndex * 4, 81, true);
    view.setFloat32(32, 999, true);
    view.setFloat32(36, 999, true);
    expect(decodeSignalBeaconFrame(bytes)).toMatchObject({
      sequence: 4,
      sessionToken: 123,
      metrics: { heart_rate: 81 },
    });
  });

  it("omits non-finite derived values and rejects malformed identity", () => {
    const bytes = encodeSignalBeaconFrame({
      sequence: 1,
      sessionToken: 99,
      metrics: { heart_rate: Number.NaN, rr_interval: 800 },
      ecgBeatCounter: 0,
      rrBeatCounter: 0,
      ecgBeatAgeMs: 9999,
      rrBeatAgeMs: 9999,
      ecgBeatQuality: 0,
      rrBeatQuality: 0,
      flags: 0,
    });
    expect(decodeSignalBeaconFrame(bytes)?.metrics).toEqual({ rr_interval: 800 });
    new DataView(bytes).setUint32(12, 0, true);
    expect(decodeSignalBeaconFrame(bytes)).toBeUndefined();
    expect(decodeSignalBeaconFrame(new ArrayBuffer(32))).toBeUndefined();
  });
});
