const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v));

export const FLIGHT_HALF_WIDTH = 13;
export interface SteeringState { position: number; velocity: number }

/** World-units/second, integrated analytically so 30/60/120 Hz feel the same. */
export function advanceSteering(state: SteeringState, input: number, dt: number): SteeringState {
  const axis = Number.isFinite(input) ? clamp(input, -1, 1) : 0;
  const target = axis * 6;
  const rate = Math.abs(axis) < .02 || axis * state.velocity < 0 ? 8 : 4.2;
  const decay = Math.exp(-rate * dt);
  const velocity = target + (state.velocity - target) * decay;
  const position = state.position + target * dt + (state.velocity - target) * (1 - decay) / rate;
  const bounded = clamp(position, -FLIGHT_HALF_WIDTH, FLIGHT_HALF_WIDTH);
  return { position: bounded, velocity: bounded !== position ? 0 : velocity };
}

/** A short contraction, rebound and release; RR affects duration, never creates beats. */
export function cardiacEnvelope(ageSeconds: number, rrMs = 800) {
  const duration = clamp(rrMs * .00048, .20, .46);
  const t = ageSeconds / duration;
  if (t < 0 || t >= 1) return 0;
  return Math.sin(Math.PI * t) * Math.exp(-2.2 * t);
}

export interface RrHeartbeatSignal {
  sessionId: string;
  counter: number;
  ageMs: number;
  rrMs?: number;
  ready: boolean;
  simulated?: boolean;
}

/**
 * Consume only received RR counter increments. Batched notifications are replayed
 * with the latest reported interval (the beacon has no per-interval history).
 * No extrapolated beats, stale backlog, reconnect burst, or duplicate pulses.
 */
export class RrBeatClock {
  private sessionId?: string;
  private counter?: number;
  private pending: number[] = [];
  private untilNext = 0;
  rrMs = 800;

  accept(signal: RrHeartbeatSignal, active: boolean) {
    const sessionChanged = this.sessionId !== signal.sessionId;
    const distance = sessionChanged || this.counter === undefined
      ? 0 : ((signal.counter >>> 0) - this.counter) >>> 0;
    this.sessionId = signal.sessionId;
    if (sessionChanged || distance < 0x80000000) this.counter = signal.counter >>> 0;
    if (Number.isFinite(signal.rrMs) && signal.rrMs! >= 250 && signal.rrMs! <= 2500)
      this.rrMs = signal.rrMs!;
    if (!active || !signal.ready || !Number.isFinite(signal.ageMs) || signal.ageMs < 0 || signal.ageMs > 1500) {
      this.clear();
      return;
    }
    if (sessionChanged) { this.clear(); return; }
    if (distance === 0 || distance >= 0x80000000) return;
    // Huge counter jumps are a discontinuity, not heartbeats to replay.
    if (distance > 4) { this.clear(); return; }
    if (!this.pending.length) this.untilNext = 0;
    for (let i = 0; i < distance && this.pending.length < 4; i++)
      this.pending.push(this.rrMs);
  }

  advance(dt: number): number | undefined {
    this.untilNext = Math.max(0, this.untilNext - dt);
    if (!this.pending.length || this.untilNext > 0) return;
    const interval = this.pending.shift()!;
    this.untilNext = interval / 1000;
    return interval;
  }

  clear() { this.pending = []; this.untilNext = 0; }
}

export interface MountainPeak {
  x: number; y: number; z: number;
  radius: number; height: number; rotation: number;
}

/** Cross-section of the visible five-sided mountain, expanded by the aircraft. */
export function touchesMountain(x: number, y: number, z: number, peak: MountainPeak, radius = .42) {
  if (y + radius < peak.y || y - radius > peak.y + peak.height) return false;
  const section = peak.radius * (1 - clamp((y - radius - peak.y) / peak.height, 0, 1));
  const px = x - peak.x, pz = z - peak.z;
  if (Math.hypot(px, pz) > section + radius) return false;
  let positive = false, negative = false, edgeDistance = Infinity;
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5 + peak.rotation;
    const b = (i + 1) * Math.PI * 2 / 5 + peak.rotation;
    const ax = Math.sin(a) * section, az = Math.cos(a) * section;
    const bx = Math.sin(b) * section, bz = Math.cos(b) * section;
    const cross = (bx-ax)*(pz-az) - (bz-az)*(px-ax);
    positive ||= cross > 0; negative ||= cross < 0;
    const length = (bx-ax)**2 + (bz-az)**2;
    const t = length ? clamp(((px-ax)*(bx-ax)+(pz-az)*(bz-az))/length, 0, 1) : 0;
    edgeDistance = Math.min(edgeDistance, Math.hypot(px-ax-t*(bx-ax), pz-az-t*(bz-az)));
  }
  return !(positive && negative) || edgeDistance <= radius;
}
