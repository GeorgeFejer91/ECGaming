import { describe, expect, it } from "vitest";
import {
  decodeFlightFrame,
  encodeFlightFrame,
  FlightFlags,
  isFreshBeat,
  isNewerSequence,
} from "../src/protocol/flight-frame";

describe("ECG flight wire frame", () => {
  it("round trips the exact 32-byte little-endian schema", () => {
    const frame = {
      sequence: 42,
      beatCounter: 7,
      altitude: -0.25,
      throttle: 0.7,
      traffic: 0.2,
      beatAgeMs: 18.5,
      quality: 0.91,
      flags: FlightFlags.controlReady | FlightFlags.physicalPolar,
    };
    const bytes = encodeFlightFrame(frame);
    expect(bytes.byteLength).toBe(32);
    const decoded = decodeFlightFrame(bytes)!;
    expect(decoded.sequence).toBe(frame.sequence);
    expect(decoded.beatCounter).toBe(frame.beatCounter);
    expect(decoded.flags).toBe(frame.flags);
    expect(decoded.altitude).toBeCloseTo(frame.altitude);
    expect(decoded.throttle).toBeCloseTo(frame.throttle);
    expect(decoded.traffic).toBeCloseTo(frame.traffic);
    expect(decoded.quality).toBeCloseTo(frame.quality);
  });
  it("clamps unsafe outbound controls and rejects wrong sizes", () => {
    const decoded = decodeFlightFrame(
      encodeFlightFrame({
        sequence: 1,
        beatCounter: 0,
        altitude: 9,
        throttle: -2,
        traffic: 4,
        beatAgeMs: -1,
        quality: 5,
        flags: 0,
      }),
    )!;
    expect(decoded.altitude).toBe(1);
    expect(decoded.throttle).toBe(0);
    expect(decoded.traffic).toBe(1);
    expect(decodeFlightFrame(new ArrayBuffer(12))).toBeUndefined();
  });
  it("handles sequence wrap and beat freshness without replay", () => {
    expect(isNewerSequence(0, 0xffffffff)).toBe(true);
    expect(isNewerSequence(9, 9)).toBe(false);
    expect(
      isFreshBeat(
        {
          sequence: 2,
          beatCounter: 4,
          altitude: 0,
          throttle: 0.5,
          traffic: 0.5,
          beatAgeMs: 250,
          quality: 1,
          flags: 0,
        },
        3,
      ),
    ).toBe(true);
    expect(
      isFreshBeat(
        {
          sequence: 3,
          beatCounter: 5,
          altitude: 0,
          throttle: 0.5,
          traffic: 0.5,
          beatAgeMs: 251,
          quality: 1,
          flags: 0,
        },
        4,
      ),
    ).toBe(false);
  });
});
