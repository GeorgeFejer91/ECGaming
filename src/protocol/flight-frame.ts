import type {
  DerivedMetricId,
  FlightFrame,
  SignalBeaconFrame,
} from "./types";

export const FLIGHT_WIRE_BYTES = 32;
export const FLIGHT_MAX_HZ = 60;
export const FLIGHT_HEARTBEAT_MS = 100;
export const FLIGHT_STALE_MS = 2_000;
export const FLIGHT_RECOVERY_FRAMES = 3;
export const FLIGHT_BEAT_FRESH_MS = 250;

export const SIGNAL_BEACON_CHANNEL = "ecgsignalv1";
export const SIGNAL_BEACON_WIRE_BYTES = 88;
export const SIGNAL_BEACON_MAX_HZ = 20;
export const SIGNAL_BEACON_HEARTBEAT_MS = 250;
export const SIGNAL_BEACON_STALE_MS = 2_000;
const SIGNAL_BEACON_MAGIC = 0x31474345; // ASCII "ECG1" when little-endian.
const SIGNAL_BEACON_SCHEMA_VERSION = 1;

export const SIGNAL_BEACON_METRICS = Object.freeze([
  "excitement_score",
  "excitometer",
  "heart_rate",
  "rr_interval",
  "rmssd",
  "ln_rmssd",
  "sdnn",
  "ecg_local_power",
  "ecg_rms",
  "ecg_peak_to_peak",
] as const satisfies readonly DerivedMetricId[]);

export const SignalBeaconFlags = Object.freeze({
  physicalPolar: 1 << 0,
  simulation: 1 << 1,
  ecgStreamReady: 1 << 2,
  ecgBeatDetectorReady: 1 << 3,
  rrStreamReady: 1 << 4,
});

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

/**
 * Encodes finite derived metrics and independent ECG/RR beat timing. The fixed
 * schema has no waveform/sample-array field.
 *
 *  0  u32 magic "ECG1"
 *  4  u16 schema version
 *  6  u16 byte length
 *  8  u32 sequence
 * 12  u32 source-session token
 * 16  u32 metric validity mask
 * 20  u32 provenance/readiness flags
 * 24  u32 ECG R-peak counter
 * 28  u32 Polar RR counter
 * 32  f32 ECG beat age ms
 * 36  f32 RR beat age ms
 * 40  f32 ECG beat quality 0..1
 * 44  f32 RR beat quality 0..1
 * 48  ten f32 derived metrics in SIGNAL_BEACON_METRICS order
 */
export function encodeSignalBeaconFrame(
  frame: SignalBeaconFrame,
): ArrayBuffer {
  const bytes = new ArrayBuffer(SIGNAL_BEACON_WIRE_BYTES);
  const view = new DataView(bytes);
  view.setUint32(0, SIGNAL_BEACON_MAGIC, true);
  view.setUint16(4, SIGNAL_BEACON_SCHEMA_VERSION, true);
  view.setUint16(6, SIGNAL_BEACON_WIRE_BYTES, true);
  view.setUint32(8, frame.sequence >>> 0, true);
  view.setUint32(12, frame.sessionToken >>> 0, true);
  let metricMask = 0;
  SIGNAL_BEACON_METRICS.forEach((metric, index) => {
    const value = frame.metrics[metric];
    if (Number.isFinite(value)) {
      metricMask |= 1 << index;
      view.setFloat32(48 + index * 4, Number(value), true);
    }
  });
  view.setUint32(16, metricMask >>> 0, true);
  view.setUint32(20, frame.flags >>> 0, true);
  view.setUint32(24, frame.ecgBeatCounter >>> 0, true);
  view.setUint32(28, frame.rrBeatCounter >>> 0, true);
  view.setFloat32(32, Math.max(0, Number(frame.ecgBeatAgeMs)), true);
  view.setFloat32(36, Math.max(0, Number(frame.rrBeatAgeMs)), true);
  view.setFloat32(40, clamp(Number(frame.ecgBeatQuality), 0, 1), true);
  view.setFloat32(44, clamp(Number(frame.rrBeatQuality), 0, 1), true);
  return bytes;
}

export function decodeSignalBeaconFrame(
  value: unknown,
): SignalBeaconFrame | undefined {
  const bytes = arrayBuffer(value);
  if (!bytes || bytes.byteLength !== SIGNAL_BEACON_WIRE_BYTES) return undefined;
  const view = new DataView(bytes);
  if (
    view.getUint32(0, true) !== SIGNAL_BEACON_MAGIC ||
    view.getUint16(4, true) !== SIGNAL_BEACON_SCHEMA_VERSION ||
    view.getUint16(6, true) !== SIGNAL_BEACON_WIRE_BYTES
  )
    return undefined;
  const metricMask = view.getUint32(16, true);
  if (metricMask >>> SIGNAL_BEACON_METRICS.length) return undefined;
  const metrics: SignalBeaconFrame["metrics"] = {};
  for (let index = 0; index < SIGNAL_BEACON_METRICS.length; index += 1) {
    if ((metricMask & (1 << index)) === 0) continue;
    const metric = SIGNAL_BEACON_METRICS[index]!,
      metricValue = view.getFloat32(48 + index * 4, true);
    if (!Number.isFinite(metricValue)) return undefined;
    metrics[metric] = metricValue;
  }
  const frame: SignalBeaconFrame = {
    sequence: view.getUint32(8, true),
    sessionToken: view.getUint32(12, true),
    metrics,
    flags: view.getUint32(20, true),
    ecgBeatCounter: view.getUint32(24, true),
    rrBeatCounter: view.getUint32(28, true),
    ecgBeatAgeMs: view.getFloat32(32, true),
    rrBeatAgeMs: view.getFloat32(36, true),
    ecgBeatQuality: view.getFloat32(40, true),
    rrBeatQuality: view.getFloat32(44, true),
  };
  if (
    frame.sessionToken === 0 ||
    ![
      frame.ecgBeatAgeMs,
      frame.rrBeatAgeMs,
      frame.ecgBeatQuality,
      frame.rrBeatQuality,
    ].every(Number.isFinite) ||
    frame.ecgBeatAgeMs < 0 ||
    frame.rrBeatAgeMs < 0 ||
    frame.ecgBeatQuality < 0 ||
    frame.ecgBeatQuality > 1 ||
    frame.rrBeatQuality < 0 ||
    frame.rrBeatQuality > 1
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
