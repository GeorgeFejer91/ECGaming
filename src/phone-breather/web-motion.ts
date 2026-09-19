/**
 * Shared browser motion acquisition for phone-breath experiences.
 * Uses accelerometer + gyroscope when available and falls back to
 * accelerometer-only rather than inventing missing sensor data.
 */

const G = 9.80665;
const DEG_TO_RAD = Math.PI / 180;
const GYRO_FRESH_MS = 220;
const GENERIC_ACCEL_FRESH_MS = 240;

type Vec3 = { x: number; y: number; z: number };

export type BreathMotionMode =
  | "generic-fused"
  | "generic-accel"
  | "devicemotion-fused"
  | "orientation-fused"
  | "accel-only";

export interface BreathMotionSample {
  x: number;
  y: number;
  z: number;
  rawX: number;
  rawY: number;
  rawZ: number;
  userAccelX: number;
  userAccelY: number;
  userAccelZ: number;
  angularSpeedRadPerSecond: number;
  sampleRateHz: number;
  fusionConfidence01: number;
  hasGyroscope: boolean;
  mode: BreathMotionMode;
  timeMs: number;
}

export interface BreathMotionStatus {
  active: boolean;
  mode: BreathMotionMode | null;
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
  start(): void;
  stop(): void;
}

type GenericSensorConstructor = new (options?: {
  frequency?: number;
  referenceFrame?: "device" | "screen";
}) => GenericSensorLike;

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

const length = (v: Vec3) => Math.hypot(v.x, v.y, v.z);

const normalize = (v: Vec3, target = 1): Vec3 => {
  const n = length(v);
  if (!Number.isFinite(n) || n < 1e-8) return { x: 0, y: 0, z: target };
  const s = target / n;
  return { x: v.x * s, y: v.y * s, z: v.z * s };
};

const finiteVec = (v: Vec3) =>
  Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

const angleDelta = (next: number, previous: number) => {
  let d = next - previous;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
};

class GravityFusion {
  private gravity: Vec3 | null = null;
  private lastTimeMs: number | null = null;

  reset() {
    this.gravity = null;
    this.lastTimeMs = null;
  }

  update(accel: Vec3, gyro: Vec3 | null, timeMs: number) {
    const accelMagnitude = length(accel);
    if (!finiteVec(accel) || accelMagnitude < 1e-6) {
      const gravity = this.gravity ?? { x: 0, y: 0, z: G };
      return {
        gravity,
        userAcceleration: { x: 0, y: 0, z: 0 },
        confidence01: 0,
        angularSpeed: 0,
      };
    }

    if (!this.gravity) this.gravity = normalize(accel, G);

    const dt =
      this.lastTimeMs === null
        ? 1 / 60
        : clamp((timeMs - this.lastTimeMs) / 1000, 0.001, 0.1);
    this.lastTimeMs = timeMs;

    let predicted = this.gravity;
    let angularSpeed = 0;

    if (gyro && finiteVec(gyro)) {
      angularSpeed = length(gyro);
      const g = predicted;
      const dx = -(gyro.y * g.z - gyro.z * g.y);
      const dy = -(gyro.z * g.x - gyro.x * g.z);
      const dz = -(gyro.x * g.y - gyro.y * g.x);
      predicted = normalize(
        { x: g.x + dx * dt, y: g.y + dy * dt, z: g.z + dz * dt },
        G,
      );
    }

    const measured = normalize(accel, G);
    const magnitudeError = Math.abs(accelMagnitude - G) / G;
    const accelTrust = clamp(1 - magnitudeError / 0.28, 0.04, 1);
    const tau = gyro ? 0.7 : 0.22;
    const correction = (1 - Math.exp(-dt / tau)) * accelTrust;

    const gravity = normalize(
      {
        x: predicted.x + (measured.x - predicted.x) * correction,
        y: predicted.y + (measured.y - predicted.y) * correction,
        z: predicted.z + (measured.z - predicted.z) * correction,
      },
      G,
    );
    this.gravity = gravity;

    const userAcceleration = {
      x: accel.x - gravity.x,
      y: accel.y - gravity.y,
      z: accel.z - gravity.z,
    };

    const base = gyro ? 1 : 0.48;
    const confidence01 = clamp(
      base * (1 - 0.55 * clamp(magnitudeError / 0.45, 0, 1)),
      0,
      1,
    );

    return { gravity, userAcceleration, confidence01, angularSpeed };
  }
}

export async function requestBreathMotionPermission(): Promise<boolean> {
  const generic = globalThis as typeof globalThis & {
    Accelerometer?: GenericSensorConstructor;
  };
  const motionCtor = window.DeviceMotionEvent as typeof DeviceMotionEvent & {
    requestPermission?: () => Promise<"granted" | "denied">;
  };
  const orientationCtor =
    window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<"granted" | "denied">;
    };

  const motionPromise =
    typeof motionCtor?.requestPermission === "function"
      ? motionCtor.requestPermission().catch(() => "denied" as const)
      : Promise.resolve("granted" as const);
  const orientationPromise =
    typeof orientationCtor?.requestPermission === "function"
      ? orientationCtor.requestPermission().catch(() => "denied" as const)
      : Promise.resolve("granted" as const);

  const [motion, orientation] = await Promise.all([
    motionPromise,
    orientationPromise,
  ]);

  return (
    motion === "granted" ||
    orientation === "granted" ||
    typeof generic.Accelerometer === "function"
  );
}

export class WebBreathMotionSource {
  private readonly fusion = new GravityFusion();
  private readonly frequencyHz: number;
  private active = false;
  private mode: BreathMotionMode | null = null;
  private genericAccel?: GenericSensorLike;
  private genericGyro?: GenericSensorLike;
  private latestGenericAccel: (Vec3 & { t: number }) | null = null;
  private latestGenericGyro: (Vec3 & { t: number }) | null = null;
  private orientationGyro: (Vec3 & { t: number }) | null = null;
  private previousOrientation:
    | { alpha: number; beta: number; gamma: number; t: number }
    | null = null;
  private lastSampleAt: number | null = null;
  private sampleRateHz = 0;

  constructor(private readonly options: WebBreathMotionOptions) {
    this.frequencyHz = clamp(options.frequencyHz ?? 60, 10, 120);
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.fusion.reset();
    window.addEventListener("devicemotion", this.onDeviceMotion, { passive: true });
    window.addEventListener("deviceorientation", this.onOrientation, { passive: true });
    this.startGeneric();
    this.status("Waiting for live motion readings.");
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener("devicemotion", this.onDeviceMotion);
    window.removeEventListener("deviceorientation", this.onOrientation);
    this.genericAccel?.stop();
    this.genericGyro?.stop();
    this.genericAccel = undefined;
    this.genericGyro = undefined;
    this.latestGenericAccel = null;
    this.latestGenericGyro = null;
    this.orientationGyro = null;
    this.previousOrientation = null;
    this.mode = null;
    this.fusion.reset();
    this.status("Motion sensing stopped.");
  }

  private startGeneric() {
    const global = globalThis as typeof globalThis & {
      Accelerometer?: GenericSensorConstructor;
      Gyroscope?: GenericSensorConstructor;
    };

    if (global.Accelerometer) {
      try {
        this.genericAccel = new global.Accelerometer({
          frequency: this.frequencyHz,
          referenceFrame: "device",
        });
        this.genericAccel.addEventListener("reading", this.onGenericAccel);
        this.genericAccel.addEventListener("error", this.onGenericError);
        this.genericAccel.start();
      } catch {
        this.genericAccel = undefined;
      }
    }

    if (global.Gyroscope) {
      try {
        this.genericGyro = new global.Gyroscope({
          frequency: this.frequencyHz,
          referenceFrame: "device",
        });
        this.genericGyro.addEventListener("reading", this.onGenericGyro);
        this.genericGyro.addEventListener("error", this.onGenericError);
        this.genericGyro.start();
      } catch {
        this.genericGyro = undefined;
      }
    }
  }

  private onGenericError = () => {
    this.status("Generic sensor unavailable; using browser motion fallback.");
  };

  private onGenericGyro = () => {
    if (!this.active || !this.genericGyro) return;
    const { x, y, z } = this.genericGyro;
    if (x === null || y === null || z === null) return;
    this.latestGenericGyro = { x, y, z, t: performance.now() };
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
    this.emit(
      accel,
      gyro,
      gyro ? "generic-fused" : "generic-accel",
      t,
    );
  };

  private onDeviceMotion = (event: DeviceMotionEvent) => {
    if (!this.active) return;
    const t = performance.now();

    if (
      this.latestGenericAccel &&
      t - this.latestGenericAccel.t < GENERIC_ACCEL_FRESH_MS
    ) {
      return;
    }

    const a = event.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;

    let gyro: Vec3 | null = null;
    let mode: BreathMotionMode = "accel-only";
    const r = event.rotationRate;

    if (
      r &&
      r.alpha !== null &&
      r.beta !== null &&
      r.gamma !== null
    ) {
      // Current Device Orientation spec: rotationRate alpha=x, beta=y, gamma=z.
      gyro = {
        x: r.alpha * DEG_TO_RAD,
        y: r.beta * DEG_TO_RAD,
        z: r.gamma * DEG_TO_RAD,
      };
      mode = "devicemotion-fused";
    } else if (
      this.orientationGyro &&
      t - this.orientationGyro.t <= GYRO_FRESH_MS
    ) {
      gyro = this.orientationGyro;
      mode = "orientation-fused";
    }

    this.emit({ x: a.x, y: a.y, z: a.z }, gyro, mode, t);
  };

  private onOrientation = (event: DeviceOrientationEvent) => {
    if (!this.active) return;
    if (event.alpha === null || event.beta === null || event.gamma === null) return;

    const t = performance.now();
    const current = {
      alpha: event.alpha,
      beta: event.beta,
      gamma: event.gamma,
      t,
    };
    const previous = this.previousOrientation;
    this.previousOrientation = current;
    if (!previous) return;

    const dt = clamp((t - previous.t) / 1000, 0.005, 0.25);
    // Orientation angles use alpha=z, beta=x, gamma=y.
    this.orientationGyro = {
      x: angleDelta(current.beta, previous.beta) * DEG_TO_RAD / dt,
      y: angleDelta(current.gamma, previous.gamma) * DEG_TO_RAD / dt,
      z: angleDelta(current.alpha, previous.alpha) * DEG_TO_RAD / dt,
      t,
    };
  };

  private emit(
    accel: Vec3,
    gyro: Vec3 | null,
    requestedMode: BreathMotionMode,
    timeMs: number,
  ) {
    if (!finiteVec(accel)) return;

    if (this.lastSampleAt !== null) {
      const dt = timeMs - this.lastSampleAt;
      if (dt > 0 && dt < 1000) {
        const instant = 1000 / dt;
        this.sampleRateHz =
          this.sampleRateHz === 0
            ? instant
            : this.sampleRateHz * 0.9 + instant * 0.1;
      }
    }
    this.lastSampleAt = timeMs;

    const fused = this.fusion.update(accel, gyro, timeMs);
    const mode =
      gyro
        ? requestedMode
        : requestedMode === "generic-accel"
          ? "generic-accel"
          : "accel-only";
    const vector = gyro ? fused.gravity : accel;
    const changed = mode !== this.mode;
    this.mode = mode;

    this.options.onSample({
      x: vector.x,
      y: vector.y,
      z: vector.z,
      rawX: accel.x,
      rawY: accel.y,
      rawZ: accel.z,
      userAccelX: fused.userAcceleration.x,
      userAccelY: fused.userAcceleration.y,
      userAccelZ: fused.userAcceleration.z,
      angularSpeedRadPerSecond: fused.angularSpeed,
      sampleRateHz: this.sampleRateHz,
      fusionConfidence01: fused.confidence01,
      hasGyroscope: !!gyro,
      mode,
      timeMs,
    });

    if (changed) {
      this.status(
        gyro
          ? "Accelerometer + gyroscope fusion active."
          : "Accelerometer-only fallback active.",
      );
    }
  }

  private status(message: string) {
    this.options.onStatus?.({ active: this.active, mode: this.mode, message });
  }
}
