/**
 * Phone accelerometer breath processor.
 *
 * Adapted from the polar breathing processor's PCA calibration, projection,
 * derivative, and phase classification pipeline. Input is raw DeviceMotionEvent
 * acceleration (m/s²) rather than Polar H10 Bluetooth PMD frames.
 */

export interface BreathProcessorSettings {
  calibrationWindowMs: number;
  minimumAxisRange: number;
  volumeFilterTauMs: number;
  staleTimeoutMs: number;
  phaseDerivativeTauMs: number;
  phaseEnterThreshold: number;
  phaseHoldThreshold: number;
  phaseConfirmationMs: number;
  phaseMinimumDwellMs: number;
}

export const defaultSettings = (): BreathProcessorSettings => ({
  calibrationWindowMs: 10_000,
  minimumAxisRange: 0.05,
  volumeFilterTauMs: 180,
  staleTimeoutMs: 500,
  phaseDerivativeTauMs: 400,
  phaseEnterThreshold: 0.03,
  phaseHoldThreshold: 0.025,
  phaseConfirmationMs: 400,
  phaseMinimumDwellMs: 400,
});

export interface BreathSnapshot {
  calibrated: boolean;
  ready: boolean;
  lost: boolean;
  phase: -1 | 0 | 1;
  volume01: number;
  derivativePerSecond: number;
  confidence01: number;
  calibration01: number;
  values: {
    acc_breathing_magnitude: number | undefined;
    breathing_volume: number | undefined;
    breathing_axis_range: number | undefined;
    breathing_signal_ready: number;
    breathing_signal_confidence: number;
    breathing_calibration: number;
    breathing_phase: number;
  };
}

const dot = (l: number[], r: number[]) =>
  l[0] * r[0] + l[1] * r[1] + l[2] * r[2];
const subtract = (l: number[], r: number[]): number[] => [
  l[0] - r[0],
  l[1] - r[1],
  l[2] - r[2],
];
const inverseLerp = (low: number, high: number, value: number) =>
  Math.abs(high - low) < 1e-8
    ? 0.5
    : Math.max(0, Math.min(1, (value - low) / (high - low)));
const quantile = (sorted: number[], fraction: number) => {
  const pos = (sorted.length - 1) * fraction;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

interface Sample {
  values: number[];
  timeMs: number;
}

interface PcaResult {
  center: number[];
  axis: number[];
  low: number;
  high: number;
  dominance: number;
}

export class PhoneBreathProcessor {
  settings: BreathProcessorSettings;
  private samplesSeen = 0;
  private calibration: Sample[] = [];
  private center = [0, 0, 0];
  private axis = [1, 0, 0];
  private boundMin = -0.05;
  private boundMax = 0.05;
  private calibrationSpan = 0.1;
  private pcaDominance01 = 0;
  calibrated = false;
  private filtered: number[] | null = null;
  private lastSourceMs: number | null = null;
  private lastWatermarkMs: number | null = null;
  lastVolume = 0.5;
  private lastProjection: number | null = null;
  private derivative = 0;
  phase: -1 | 0 | 1 = 0;
  private activeSinceMs: number | null = null;
  private candidate: -1 | 0 | 1 = 0;
  private candidateSinceMs: number | null = null;
  private motionEma = 0;
  lost = false;

  constructor(settings?: Partial<BreathProcessorSettings>) {
    this.settings = { ...defaultSettings(), ...settings };
  }

  reset(): void {
    this.samplesSeen = 0;
    this.calibration = [];
    this.center = [0, 0, 0];
    this.axis = [1, 0, 0];
    this.boundMin = -0.05;
    this.boundMax = 0.05;
    this.calibrationSpan = 0.1;
    this.pcaDominance01 = 0;
    this.calibrated = false;
    this.filtered = null;
    this.lastSourceMs = null;
    this.lastWatermarkMs = null;
    this.lastVolume = 0.5;
    this.lastProjection = null;
    this.derivative = 0;
    this.phase = 0;
    this.activeSinceMs = null;
    this.candidate = 0;
    this.candidateSinceMs = null;
    this.motionEma = 0;
    this.lost = false;
  }

  private alpha(deltaMs: number, tauMs: number): number {
    return Math.max(0, Math.min(1, deltaMs / Math.max(1, tauMs + deltaMs)));
  }

  private pca(samples: number[][]): PcaResult | null {
    const count = samples.length;
    if (count < 4) return null;
    const center = [0, 0, 0];
    for (const s of samples)
      for (let i = 0; i < 3; i++) center[i] += s[i] / count;
    const cov = Array.from({ length: 3 }, () => [0, 0, 0]);
    for (const s of samples) {
      const d = subtract(s, center);
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++) cov[r][c] += (d[r] * d[c]) / count;
    }
    let domDim = 0;
    for (let i = 1; i < 3; i++)
      if (cov[i][i] > cov[domDim][domDim]) domDim = i;
    let a = [0, 0, 0];
    a[domDim] = 1;
    for (let iter = 0; iter < 32; iter++) {
      const next = cov.map(row => dot(row, a));
      const mag = Math.sqrt(dot(next, next));
      if (mag < 1e-10) return null;
      a = next.map(v => v / mag);
    }
    const signIdx = a.reduce((best, v, i) =>
      Math.abs(v) > Math.abs(a[best]) ? i : best, 0);
    if (a[signIdx] < 0) a = a.map(v => -v);
    const trace = cov[0][0] + cov[1][1] + cov[2][2];
    const eigenvalue = dot(a, cov.map(row => dot(row, a)));
    const projections = samples
      .map(s => dot(subtract(s, center), a))
      .sort((l, r) => l - r);
    const low = quantile(projections, 0.05);
    const high = quantile(projections, 0.95);
    const dominance = trace > 1e-10 ? Math.max(0, Math.min(1, eigenvalue / trace)) : 0;
    if (!Number.isFinite(low) || high - low < this.settings.minimumAxisRange || dominance < 0.05)
      return null;
    return { center: [...center], axis: [...a], low, high, dominance };
  }

  private classifyDerivative(deriv: number, timeMs: number): void {
    const enter = this.settings.phaseEnterThreshold;
    const hold = this.settings.phaseHoldThreshold;
    let requested: -1 | 0 | 1 = this.phase;
    if (deriv >= enter) requested = 1;
    else if (deriv <= -enter) requested = -1;
    else if (Math.abs(deriv) <= hold) requested = 0;
    if (requested === this.phase) {
      this.candidate = requested;
      this.candidateSinceMs = null;
      return;
    }
    if (this.candidate !== requested || this.candidateSinceMs === null) {
      this.candidate = requested;
      this.candidateSinceMs = timeMs;
      return;
    }
    const confirmed = timeMs - this.candidateSinceMs >= this.settings.phaseConfirmationMs;
    const dwell = this.activeSinceMs === null || timeMs - this.activeSinceMs >= this.settings.phaseMinimumDwellMs;
    if (confirmed && dwell) {
      this.phase = requested;
      this.activeSinceMs = timeMs;
      this.candidateSinceMs = null;
    }
  }

  pushSample(accel: { x: number; y: number; z: number }, timeMs: number): BreathSnapshot {
    const values = [accel.x, accel.y, accel.z];

    if (this.lastWatermarkMs !== null && timeMs < this.lastWatermarkMs - 250) {
      this.reset();
    }

    const stale = this.lastSourceMs !== null && timeMs - this.lastSourceMs > this.settings.staleTimeoutMs;
    if (stale) {
      this.lost = true;
      this.phase = 0;
      this.activeSinceMs = null;
      this.candidateSinceMs = null;
      this.lastProjection = null;
      this.derivative = 0;
    }

    this.lastSourceMs = timeMs;

    const deltaMs = this.lastWatermarkMs === null
      ? 16
      : Math.max(1, timeMs - this.lastWatermarkMs);

    const a = this.alpha(deltaMs, this.settings.volumeFilterTauMs);
    if (this.filtered === null) {
      this.filtered = [...values];
    } else {
      const prev = [...this.filtered];
      this.filtered = this.filtered.map((v, i) => v + (values[i] - v) * a);
      const motionDelta = Math.sqrt(dot(subtract(this.filtered, prev), subtract(this.filtered, prev)));
      // Normalize per-step motion to a 5 ms reference period so the motion
      // score is independent of the phone's event rate (devices emit roughly
      // 20-200 Hz while the Polar processor samples at a fixed 200 Hz).
      const normalizedDelta = (motionDelta * 5) / Math.max(1, deltaMs);
      const motionAlpha = this.alpha(deltaMs, 500);
      this.motionEma += motionAlpha * (normalizedDelta - this.motionEma);
    }

    this.lastWatermarkMs = timeMs;
    this.samplesSeen++;

    if (!this.calibrated) {
      this.calibration.push({ values: [...this.filtered!], timeMs });
      const cutoff = timeMs - this.settings.calibrationWindowMs - 100;
      while (this.calibration.length && this.calibration[0].timeMs < cutoff)
        this.calibration.shift();
      if (
        this.calibration.length >= 8 &&
        timeMs - this.calibration[0].timeMs >= this.settings.calibrationWindowMs
      ) {
        const result = this.pca(this.calibration.map(s => s.values));
        if (result) {
          this.center = result.center;
          this.axis = result.axis;
          this.boundMin = result.low;
          this.boundMax = result.high;
          this.calibrationSpan = Math.max(1e-8, result.high - result.low);
          this.pcaDominance01 = result.dominance;
          this.calibrated = true;
          this.lastProjection = dot(subtract(this.filtered!, this.center), this.axis);
          this.activeSinceMs = timeMs;
        }
      }
    }

    if (this.calibrated) {
      const projection = dot(subtract(this.filtered!, this.center), this.axis);
      this.lastVolume = inverseLerp(this.boundMin, this.boundMax, projection);
      if (!stale && this.lastProjection !== null) {
        const rawDeriv =
          (projection - this.lastProjection) /
          Math.max(1e-8, this.calibrationSpan) /
          (deltaMs / 1000);
        this.derivative += this.alpha(deltaMs, this.settings.phaseDerivativeTauMs) *
          (rawDeriv - this.derivative);
        this.classifyDerivative(this.derivative, timeMs);
      }
      if (!stale) this.lastProjection = projection;
    }

    return this.snapshot(timeMs);
  }

  snapshot(timeMs: number): BreathSnapshot {
    const threshold = Math.max(this.settings.minimumAxisRange * 0.1, 0.005);
    const motionRatio = this.motionEma / threshold;
    const motionScore = Math.max(0, Math.min(1, 1 / (1 + motionRatio * motionRatio)));
    const ready = this.calibrated && !this.lost && motionScore >= 0.35;
    const rangeScore = Math.max(0, Math.min(1, this.calibrationSpan / (this.settings.minimumAxisRange * 2)));
    const confidence01 = ready
      ? Math.max(0, Math.min(1, rangeScore * motionScore * this.pcaDominance01))
      : 0;
    const calibration01 = this.calibrated
      ? 1
      : this.calibration.length < 2
        ? 0
        : Math.max(0, Math.min(1,
          (timeMs - this.calibration[0].timeMs) / this.settings.calibrationWindowMs));
    return {
      calibrated: this.calibrated,
      ready,
      lost: this.lost,
      phase: ready ? this.phase : 0,
      volume01: this.lastVolume,
      derivativePerSecond: this.derivative,
      confidence01,
      calibration01,
      values: {
        acc_breathing_magnitude: this.calibrated ? (this.lastProjection ?? 0) : undefined,
        breathing_volume: this.calibrated ? this.lastVolume : undefined,
        breathing_axis_range: this.calibrated ? this.boundMax - this.boundMin : undefined,
        breathing_signal_ready: ready ? 1 : 0,
        breathing_signal_confidence: confidence01,
        breathing_calibration: calibration01,
        breathing_phase: ready ? this.phase : 0,
      },
    };
  }
}
