/** Two-axis phone control, independent of physiological flight commands. */
export const TILT_SCOPE = "flight.tilt";
export const TILT_PROFILE = "ecgaming-tilt-v1";
export const TILT_LEASE_MS = 500;
export const SENSOR_STALE_MS = 350;
export interface TiltControls { x: number; y: number; active: boolean }
export const neutralControls = (): TiltControls => ({ x: 0, y: 0, active: false });
export interface TiltState extends TiltControls {
  profile: typeof TILT_PROFILE;
  revision: number;
  speedEnabled: boolean;
  flying: boolean;
}

const exact = (v: unknown, keys: string[]): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v) &&
  Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const axis = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1;
export function validControls(v: unknown): v is TiltControls {
  return exact(v, ["x", "y", "active"]) && axis(v.x) && axis(v.y) && typeof v.active === "boolean" &&
    (v.active || (v.x === 0 && v.y === 0));
}
export function validTiltState(v: unknown): v is TiltState {
  return exact(v, ["profile", "revision", "x", "y", "active", "speedEnabled", "flying"]) &&
    v.profile === TILT_PROFILE && Number.isSafeInteger(v.revision) && (v.revision as number) >= 0 &&
    axis(v.x) && axis(v.y) && typeof v.active === "boolean" && typeof v.speedEnabled === "boolean" &&
    typeof v.flying === "boolean" && (v.active || (v.x === 0 && v.y === 0));
}

/** Receiver-local lease: even a lost release or suspended producer cannot hold steering. */
export class TiltAuthority {
  private state: TiltState = { profile: TILT_PROFILE, revision: 0, ...neutralControls(), speedEnabled: true, flying: false };
  private acceptedAt = -Infinity;
  snapshot(): TiltState { return { ...this.state }; }
  accept(scope: string, controls: unknown, now: number) {
    if (scope !== TILT_SCOPE || !validControls(controls) || !Number.isFinite(now))
      throw new Error("Invalid phone control");
    // A bounded reducer; protocol sequencing happens before this application boundary.
    if (now - this.acceptedAt < 1000 / 90) return this.snapshot();
    this.acceptedAt = now;
    this.change(controls);
    return this.snapshot();
  }
  configure(speedEnabled: boolean, flying: boolean) { this.change({ speedEnabled, flying }); }
  expire(now: number) {
    if (now - this.acceptedAt >= TILT_LEASE_MS) this.neutralize();
    return this.snapshot();
  }
  neutralize() { this.change(neutralControls()); this.acceptedAt = -Infinity; }
  private change(next: Partial<TiltState>) {
    if (Object.entries(next).some(([key, value]) => this.state[key as keyof TiltState] !== value))
      this.state = { ...this.state, ...next, revision: this.state.revision + 1 };
  }
}

export interface OrientationReading { beta: number | null; gamma: number | null }
interface TiltAngles { bank: number; pitch: number }
const radians = Math.PI / 180;
const degrees = 180 / Math.PI;
const wrap = (angle: number) => ((angle + 180) % 360 + 360) % 360 - 180;
export const normalizeScreenAngle = (angle: number) => ((angle % 360) + 360) % 360;

/** Project gravity onto screen axes. Alpha/compass heading is deliberately unnecessary. */
export function orientationAngles(reading: OrientationReading, screenAngle: number): TiltAngles | undefined {
  if (reading.beta === null || reading.gamma === null || !Number.isFinite(reading.beta) ||
      !Number.isFinite(reading.gamma) || Math.abs(reading.beta) > 180 || Math.abs(reading.gamma) > 90 ||
      !Number.isFinite(screenAngle)) return;
  const beta = reading.beta * radians, gamma = reading.gamma * radians, theta = screenAngle * radians;
  const gx = -Math.sin(gamma) * Math.cos(beta), gy = Math.sin(beta), gz = Math.cos(gamma) * Math.cos(beta);
  const x = gx * Math.cos(theta) + gy * Math.sin(theta);
  const y = -gx * Math.sin(theta) + gy * Math.cos(theta);
  return { bank: Math.asin(Math.max(-1, Math.min(1, -x))) * degrees, pitch: Math.atan2(y, gz) * degrees };
}
export function tiltAxis(angle: number, deadzone = 3, fullTilt = 28) {
  if (!Number.isFinite(angle)) return 0;
  return Math.sign(angle) * Math.min(1, Math.max(0, (Math.abs(angle) - deadzone) / (fullTilt - deadzone)));
}

export class TiltCalibration {
  private centre?: TiltAngles;
  private screenAngle = 0;
  private x = 0;
  private y = 0;
  private previousAt = 0;
  reset() { this.centre = undefined; this.x = this.y = 0; }
  calibrate(reading: OrientationReading, screenAngle: number, now: number) {
    const angles = orientationAngles(reading, screenAngle);
    if (!angles) return false;
    this.centre = angles; this.screenAngle = normalizeScreenAngle(screenAngle);
    this.x = this.y = 0; this.previousAt = now;
    return true;
  }
  read(reading: OrientationReading, screenAngle: number, now: number): TiltControls {
    if (normalizeScreenAngle(screenAngle) !== this.screenAngle) this.reset();
    const angles = orientationAngles(reading, screenAngle);
    if (!this.centre || !angles) return neutralControls();
    const dt = Math.max(0, Math.min(100, now - this.previousAt));
    const mix = 1 - Math.exp(-dt / 65);
    this.previousAt = now;
    this.x += (tiltAxis(wrap(angles.bank - this.centre.bank)) - this.x) * mix;
    // Tip the top edge away to speed up; pull it toward you to slow down.
    this.y += (tiltAxis(wrap(this.centre.pitch - angles.pitch)) - this.y) * mix;
    return { x: this.x, y: this.y, active: true };
  }
}

/** Speed is a temporary trim around the target's command, never a replacement ECG source. */
export function phoneThrottle(base: number, state: TiltControls & { speedEnabled: boolean }) {
  return Math.max(0, Math.min(1, base + (state.active && state.speedEnabled ? state.y * .5 : 0)));
}
