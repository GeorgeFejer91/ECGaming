import type { FlightFrame } from "./types";

export const FLIGHT_WIRE_BYTES = 32;
export const FLIGHT_MAX_HZ = 60;
export const FLIGHT_HEARTBEAT_MS = 100;
export const FLIGHT_STALE_MS = 2_000;
export const FLIGHT_RECOVERY_FRAMES = 3;
export const FLIGHT_BEAT_FRESH_MS = 250;

export const FlightFlags = Object.freeze({
  controlReady: 1 << 0,
  physicalPolar: 1 << 1,
  beatDetectorReady: 1 << 2,
  simulation: 1 << 3,
});

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

export function encodeFlightFrame(frame: FlightFrame): ArrayBuffer {
  const bytes = new ArrayBuffer(FLIGHT_WIRE_BYTES);
  const view = new DataView(bytes);
  view.setUint32(0, frame.sequence >>> 0, true);
  view.setUint32(4, frame.beatCounter >>> 0, true);
  view.setFloat32(8, clamp(Number(frame.altitude), -1, 1), true);
  view.setFloat32(12, clamp(Number(frame.throttle), 0, 1), true);
  view.setFloat32(16, clamp(Number(frame.traffic), 0, 1), true);
  view.setFloat32(20, Math.max(0, Number(frame.beatAgeMs)), true);
  view.setFloat32(24, clamp(Number(frame.quality), 0, 1), true);
  view.setUint32(28, frame.flags >>> 0, true);
  return bytes;
}

function arrayBuffer(value: unknown): ArrayBuffer | undefined {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value))
    return value.buffer.slice(
      value.byteOffset,
      value.byteOffset + value.byteLength,
    ) as ArrayBuffer;
  return undefined;
}

export function decodeFlightFrame(value: unknown): FlightFrame | undefined {
  const bytes = arrayBuffer(value);
  if (!bytes || bytes.byteLength !== FLIGHT_WIRE_BYTES) return undefined;
  const view = new DataView(bytes);
  const frame: FlightFrame = {
    sequence: view.getUint32(0, true),
    beatCounter: view.getUint32(4, true),
    altitude: view.getFloat32(8, true),
    throttle: view.getFloat32(12, true),
    traffic: view.getFloat32(16, true),
    beatAgeMs: view.getFloat32(20, true),
    quality: view.getFloat32(24, true),
    flags: view.getUint32(28, true),
  };
  if (
    ![
      frame.altitude,
      frame.throttle,
      frame.traffic,
      frame.beatAgeMs,
      frame.quality,
    ].every(Number.isFinite)
  )
    return undefined;
  if (
    frame.altitude < -1.001 ||
    frame.altitude > 1.001 ||
    frame.throttle < -0.001 ||
    frame.throttle > 1.001 ||
    frame.traffic < -0.001 ||
    frame.traffic > 1.001
  )
    return undefined;
  return frame;
}

export function isNewerSequence(sequence: number, previous?: number): boolean {
  if (previous === undefined) return true;
  const distance = ((sequence >>> 0) - (previous >>> 0)) >>> 0;
  return distance > 0 && distance < 0x80000000;
}

export function isFreshBeat(
  frame: FlightFrame,
  previousBeatCounter?: number,
): boolean {
  return (
    frame.beatCounter !== previousBeatCounter &&
    frame.beatAgeMs >= 0 &&
    frame.beatAgeMs <= FLIGHT_BEAT_FRESH_MS
  );
}
