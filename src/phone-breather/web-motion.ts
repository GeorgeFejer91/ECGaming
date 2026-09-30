/**
 * Shared browser inertial acquisition for phone-breath experiences.
 *
 * Goals:
 * - use both accelerometer and gyroscope when the browser exposes them;
 * - keep DeviceMotion as the broad compatibility path;
 * - opportunistically use Generic Sensor API streams;
 * - fall back to accelerometer-only without inventing data;
 * - expose one conditioned gravity-motion vector to the breath estimator.
 *
 * The fusion is intentionally lightweight and transparent. It follows the
 * Sensor Zoo complementary-filter principle: integrate gyro motion, then
 * slowly correct gravity direction from the accelerometer. It is not copied
 * from Sensor Zoo and does not depend on a native/OS fusion black box.
 */

const G = 9.80665;
const DEG_TO_RAD = Math.PI / 180;
const DEFAULT_FREQUENCY_HZ = 60;
const GYRO_FRESH_MS = 220;
const GENERIC_ACCEL_FRESH_MS = 240;

type Vec3 = { x: number; y: number; z: number };

export type BreathMotionMode =
  | "generic-fused"
  | "generic-accel"
  | "devicemotion-fused"
  | "orientation-fused"
  | "accel-only";

export interface BreathMotionCapabilities {
  secureContext: boolean;
  deviceMotion: boolean;
  deviceOrientation: boolean;
  genericAccelerometer: boolean;
  genericGyroscope: boolean;
}

export interface BreathMotionSample {
  /** Conditioned vector used by the breathing estimator, in m/s². */
  x: number;
  y: number;
  z: number;
  /** Raw accelerometer including gravity, in m/s². */
  rawX: number;
  rawY: number;
  rawZ: number;
  /** Estimated non-gravity acceleration, in m/s². */
  userAccelX: number;
  userAccelY: number;
  userAccelZ: number;
  /** Angular velocity in rad/s when available. */
  gyroX?: number;
  gyroY?: number;
  gyroZ?: number;
  angularSpeedRadPerSecond: number;
  accelerationMagnitude: number;
  sampleRateHz: number;
  fusionConfidence01: number;
  hasGyroscope: boolean;
  mode: BreathMotionMode;
  timeMs: number;
}

export interface BreathMotionStatus {
  active: boolean;
  mode: BreathMotionMode | null;
  capabilities: BreathMotionCapabilities;
  message: string;
}

export interface WebBreathMotionOptions {
  frequencyHz?: number;
  onSample: (sample: BreathMotionSample) => void;
  onStatus?: (status: BreathMotionStatus) => void;
}

interface GenericSensorLike extends EventTarget {
  x: number | null;
  y: number | null;
  z: number | null;
  timestamp?: number | null;
  start(): void;
  stop(): void;
}

type GenericSensorConstructor = new (options?: {
  frequency?: number;
  referenceFrame?: "device" | "screen";
}) => GenericSensorLike;

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

const magnitude = (v: Vec3) => Math.hypot(v.x, v.y, v.z);

const finiteVec = (v: Vec3) =>
  Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

function normalized(v: Vec3, length = 1): Vec3 {
  const n = magnitude(v);
  if (!Number.isFinite(n) || n < 1e-8) return { x: 0, y: 0, z: length };
  const scale = length / n;
  return { x: v.x * scale, y: v.y * scale, z: v.z * scale };
}

function angularDifferenceDegrees(next: number, previous: number) {
  let delta = next - previous;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

/**
 * Six-axis gravity estimator optimized for the phone-on-body case.
 *
 * The gyroscope predicts rapid orientation changes. Accelerometer direction
 * corrects drift slowly, and that correction is down-weighted during strong
 * non-gravitational acceleration. The returned gravity vector preserves the
 * slow body/phone tilt that carries much of the respiratory signal.
 */
export class BreathGravityFusion {
  private gravity: Vec3 | null = null;
  private lastTimeMs: number | null = null;

  reset() {
    this.gravity = null;
    this.lastTimeMs = null;
  }

  update(
    accel: Vec3,
    gyroRadPerSecond: Vec3 | null,
    timeMs: number,
  ): {
    gravity: Vec3;
    userAcceleration: Vec3;
    confidence01: number;
    angularSpeedRadPerSecond: number;
  } {
    const accelMagnitude = magnitude(accel);
    if (!finiteVec(accel) || accelMagnitude < 1e-6) {
      const gravity = this.gravity ?? { x: 0, y: 0, z: G };
      return {
        gravity,
        userAcceleration: { x: 0, y: 0, z: 0 },
        confidence01: 0,
        angularSpeedRadPerSecond: 0,
      };
    }

    if (!this.gravity) this.gravity = normalized(accel, G);

    const previousTime = this.lastTimeMs;
    this.lastTimeMs = timeMs;
    const dt =
      previousTime === null
        ? 1 / DEFAULT_FREQUENCY_HZ
        : clamp((timeMs - previousTime) / 1000, 0.001, 0.1);

    let predicted = this.gravity;
    let angularSpeed = 0;

    if (gyroRadPerSecond && finiteVec(gyroRadPerSecond)) {
      const w = gyroRadPerSecond;
      angularSpeed = magnitude(w);

      // Gravity is fixed in the world frame, therefore in device coordinates
      // its derivative is approximately -(omega x gravity).
      const g = predicted;
      const dx = -(w.y * g.z - w.z * g.y);
      const dy = -(w.z * g.x - w.x * g.z);
      const dz = -(w.x * g.y - w.y * g.x);
      predicted = normalized(
        {
          x: g.x + dx * dt,
          y: g.y + dy * dt,
          z: g.z + dz * dt,
        },
        G,
      );
    }

    const measuredGravity = normalized(accel, G);
    const magnitudeError = Math.abs(accelMagnitude - G) / G;

    // During translation/shock, the accelerometer is a poor gravity reference.
    // During quiet breathing it is trusted enough to correct gyro drift.
    const accelTrust = clamp(1 - magnitudeError / 0.28, 0.04, 1);
    const correctionTauSeconds = gyroRadPerSecond ? 0.7 : 0.22;
    const correction =
      (1 - Math.exp(-dt / correctionTauSeconds)) * accelTrust;

    const corrected = normalized(
      {
        x: predicted.x + (measuredGravity.x - predicted.x) * correction,
        y: predicted.y + (measuredGravity.y - predicted.y) * correction,
        z: predicted.z + (measuredGravity.z - predicted.z) * correction,
      },
      G,
    );

    this.gravity = corrected;
    const userAcceleration = {
      x: accel.x - corrected.x,
      y: accel.y - corrected.y,
      z: accel.z - corrected.z,
    };

    const gyroConfidence = gyroRadPerSecond ? 1 : 0.48;
    const dynamicPenalty = clamp(magnitudeError / 0.45, 0, 1);
    const confidence01 = clamp(
      gyroConfidence * (1 - 0.55 * dynamicPenalty),
      0,
      1,
    );

    return {
      gravity: corrected,
      userAcceleration,
      confidence01,
      angularSpeedRadPerSecond: angularSpeed,
    };
  }
}

export function detectBreathMotionCapabilities(): BreathMotionCapabilities {
  const global = globalThis as typeof globalThis & {
    Accelerometer?: GenericSensorConstructor;
    Gyroscope?: GenericSensorConstructor;
  };
  return {
    secureContext:
      typeof window === "undefined" ? true : window.isSecureContext !== false,
    deviceMotion:
      typeof window !== "undefined" && typeof window.DeviceMotionEvent !== "undefined",
    deviceOrientation:
      typeof window !== "undefined" &&
      typeof window.DeviceOrientationEvent !== "undefined",
    genericAccelerometer: typeof global.Accelerometer === "function",
    genericGyroscope: typeof global.Gyroscope === "function",
  };
}

/**
 * Request legacy motion/orientation permissions from one user gesture.
 * Generic Sensor API permission is handled by sensor construction/start.
 */
export async function requestBreathMotionPermission(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const motionCtor = window.DeviceMotionEvent as typeof DeviceMotionEvent & {
    requestPermission?: () => Promise<"granted" | "denied">;
  };
  const orientationCtor =
    window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<"granted" | "denied">;
    };

  let motionGranted = true;

  if (typeof motionCtor?.requestPermission === "function") {
    try {
      motionGranted = (await motionCtor.requestPermission()) === "granted";
    } catch {
      motionGranted = false;
    }
  }

  if (typeof orientationCtor?.requestPermission === "function") {
    try {
      await orientationCtor.requestPermission();
    } catch {
      // Orientation is optional; accelerometer permission still determines readiness.
    }
  }

  // Orientation is an enhancement. Device motion/accelerometer is the minimum.
  return motionGranted || detectBreathMotionCapabilities().genericAccelerometer;
}

export class WebBreathMotionSource {
  private readonly fusion = new BreathGravityFusion();
  private readonly frequencyHz: number;
  private readonly capabilities = detectBreathMotionCapabilities();
  private active = false;
  private mode: BreathMotionMode | null = null;
  private genericAccel?: GenericSensorLike;
  private genericGyro?: GenericSensorLike;
  private latestGenericAccel: (Vec3 & { t: number }) | null = null;
  private latestGenericGyro: (Vec3 & { t: number }) | null = null;
  private latestOrientationGyro: (Vec3 & { t: number }) | null = null;
  private previousOrientation:
    | { alpha: number; beta: number; gamma: number; t: number }
    | null = null;
  private lastSampleAt: number | null = null;
  private sampleRateHz = 0;

  constructor(private readonly options: WebBreathMotionOptions) {
    this.frequencyHz = clamp(
      options.frequencyHz ?? DEFAULT_FREQUENCY_HZ,
      10,
      120,
    );
  }

  get currentMode() {
    return this.mode;
  }

  get sensorCapabilities() {
    return { ...this.capabilities };
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.fusion.reset();
    this.lastSampleAt = null;
    this.sampleRateHz = 0;

    window.addEventListener("devicemotion", this.onDeviceMotion, {
      passive: true,
    });
    window.addEventListener("deviceorientation", this.onDeviceOrientation, {
      passive: true,
    });

    this.startGenericSensors();
    this.emitStatus("Waiting for phone motion readings.");
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener("devicemotion", this.onDeviceMotion);
    window.removeEventListener("deviceorientation", this.onDeviceOrientation);
    this.genericAccel?.stop();
    this.genericGyro?.stop();
    this.genericAccel = undefined;
    this.genericGyro = undefined;
    this.latestGenericAccel = null;
    this.latestGenericGyro = null;
    this.latestOrientationGyro = null;
    this.previousOrientation = null;
    this.mode = null;
    this.fusion.reset();
    this.emitStatus("Phone motion sensing stopped.");
  }

  private startGenericSensors() {
    const global = globalThis as typeof globalThis & {
      Accelerometer?: GenericSensorConstructor;
      Gyroscope?: GenericSensorConstructor;
    };

    if (!global.Accelerometer) return;

    try {
      const accel = new global.Accelerometer({
        frequency: this.frequencyHz,
        referenceFrame: "device",
      });
      this.genericAccel = accel;
      accel.addEventListener("reading", this.onGenericAccel);
      accel.addEventListener("error", this.onGenericError);
      accel.start();
    } catch {
      this.genericAccel = undefined;
    }

    if (!global.Gyroscope) return;
    try {
      const gyro = new global.Gyroscope({
        frequency: this.frequencyHz,
        referenceFrame: "device",
      });
      this.genericGyro = gyro;
      gyro.addEventListener("reading", this.onGenericGyro);
      gyro.addEventListener("error", this.onGenericError);
      gyro.start();
    } catch {
      this.genericGyro = undefined;
    }
  }

  private onGenericError = () => {
    // Keep DeviceMotion listeners alive as the automatic fallback.
    this.emitStatus("Generic sensor unavailable; using browser motion fallback.");
  };

  private onGenericGyro = () => {
    if (!this.active || !this.genericGyro) return;
    const { x, y, z } = this.genericGyro;
    if (x === null || y === null || z === null) return;
    const t = performance.now();
    // Generic Gyroscope angular velocity is normalized to rad/s here.
    this.latestGenericGyro = { x, y, z, t };
  };

  private onGenericAccel = () => {
    if (!this.active || !this.genericAccel) return;
    const { x, y, z } = this.genericAccel;
    if (x === null || y === null || z === null) return;
    const t = performance.now();
    const accel = { x, y, z, t };
    this.latestGenericAccel = accel;
    const gyro =
      this.latestGenericGyro && t - this.latestGenericGyro.t <= GYRO_FRESH_MS
        ? this.latestGenericGyro
        : null;
    this.emitMotion(
      accel,
      gyro,
      gyro ? "generic-fused" : "generic-accel",
      t,
    );
  };

  private onDeviceMotion = (event: DeviceMotionEvent) => {
    if (!this.active) return;
    const t = performance.now();

    // Prefer an actually-live Generic Accelerometer, not mere API presence.
    if (
      this.latestGenericAccel &&
      t - this.latestGenericAccel.t < GENERIC_ACCEL_FRESH_MS
    ) {
      return;
    }

    const accel = event.accelerationIncludingGravity;
    if (
      !accel ||
      accel.x === null ||
      accel.y === null ||
      accel.z === null
    ) {
      return;
    }

    let gyro: Vec3 | null = null;
    let mode: BreathMotionMode = "accel-only";
    const rotation = event.rotationRate;
    if (
      rotation &&
      rotation.alpha !== null &&
      rotation.beta !== null &&
      rotation.gamma !== null
    ) {
      // DeviceMotion rotationRate is degrees/s. Map beta->x, gamma->y,
      // alpha->z before converting to rad/s.
      gyro = {
        x: rotation.beta * DEG_TO_RAD,
        y: rotation.gamma * DEG_TO_RAD,
        z: rotation.alpha * DEG_TO_RAD,
      };
      mode = "devicemotion-fused";
    } else if (
      this.latestOrientationGyro &&
      t - this.latestOrientationGyro.t <= GYRO_FRESH_MS
    ) {
      gyro = this.latestOrientationGyro;
      mode = "orientation-fused";
    }

    this.emitMotion(
      { x: accel.x, y: accel.y, z: accel.z },
      gyro,
      mode,
      t,
    );
  };

  private onDeviceOrientation = (event: DeviceOrientationEvent) => {
    if (!this.active) return;
    if (
      event.alpha === null ||
      event.beta === null ||
      event.gamma === null
    ) {
      return;
    }

    const t = performance.now();
    const previous = this.previousOrientation;
    this.previousOrientation = {
      alpha: event.alpha,
      beta: event.beta,
      gamma: event.gamma,
      t,
    };
    if (!previous) return;

    const dt = clamp((t - previous.t) / 1000, 0.005, 0.25);
    this.latestOrientationGyro = {
      x: angularDifferenceDegrees(event.beta, previous.beta) * DEG_TO_RAD / dt,
      y: angularDifferenceDegrees(event.gamma, previous.gamma) * DEG_TO_RAD / dt,
      z: angularDifferenceDegrees(event.alpha, previous.alpha) * DEG_TO_RAD / dt,
      t,
    };
  };

  private emitMotion(
    accel: Vec3,
    gyro: Vec3 | null,
    mode: BreathMotionMode,
    timeMs: number,
  ) {
    if (!finiteVec(accel)) return;

    if (this.lastSampleAt !== null) {
      const dt = timeMs - this.lastSampleAt;
      if (dt > 0 && dt < 1000) {
        const instantaneous = 1000 / dt;
        this.sampleRateHz =
          this.sampleRateHz === 0
            ? instantaneous
            : this.sampleRateHz * 0.9 + instantaneous * 0.1;
      }
    }
    this.lastSampleAt = timeMs;

    const fused = this.fusion.update(accel, gyro, timeMs);
    const breathVector = gyro ? fused.gravity : accel;
    const nextMode = gyro ? mode : mode === "generic-accel" ? mode : "accel-only";
    const changedMode = this.mode !== nextMode;
    this.mode = nextMode;

    this.options.onSample({
      x: breathVector.x,
      y: breathVector.y,
      z: breathVector.z,
      rawX: accel.x,
      rawY: accel.y,
      rawZ: accel.z,
      userAccelX: fused.userAcceleration.x,
      userAccelY: fused.userAcceleration.y,
      userAccelZ: fused.userAcceleration.z,
      ...(gyro
        ? { gyroX: gyro.x, gyroY: gyro.y, gyroZ: gyro.z }
        : {}),
      angularSpeedRadPerSecond: fused.angularSpeedRadPerSecond,
      accelerationMagnitude: magnitude(accel),
      sampleRateHz: this.sampleRateHz,
      fusionConfidence01: fused.confidence01,
      hasGyroscope: !!gyro,
      mode: nextMode,
      timeMs,
    });

    if (changedMode) {
      this.emitStatus(
        gyro
          ? "Accelerometer + gyroscope fusion active."
          : "Accelerometer-only breathing fallback active.",
      );
    }
  }

  private emitStatus(message: string) {
    this.options.onStatus?.({
      active: this.active,
      mode: this.mode,
      capabilities: { ...this.capabilities },
      message,
    });
  }
}
