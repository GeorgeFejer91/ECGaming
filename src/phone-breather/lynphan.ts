/**
 * Authoritative smartphone breath detector.
 *
 * A faithful TypeScript port of the lynphan mobile breathing detection
 * algorithm (https://github.com/lynphan/Mobile-Phone-Breathing-Detection,
 * MobilePhoneBreathingDetection.cs) for the browser:
 *
 *   - per-axis short (12 sample) vs long (12000 sample) running-average buffers
 *   - totalDifference = |xShortAvg - xLongAvg| + |yShortAvg - yLongAvg| + |zShortAvg - zLongAvg|
 *   - adaptive threshold: starts at 0.05, increments 5e-6 when a peak is seen,
 *     decrements 5e-6 otherwise, resets to the starting value when it leaves (0, 1)
 *   - a 60-sample peak-debounce buffer where onePeakDetected = count of trues == 1
 *   - a goingDown flag plus 0.25 s refractory window to prevent double counting
 *   - a rolling filtered buffer sized sampleRate * breathingRateInterval (60 s)
 *     whose true-count becomes breathsPerMinute = counter * (60 / interval)
 *
 * On top of the faithful core it derives the presentation outputs the breathing
 * apps already consume (volume01, phase, flow01, confidence01, ready,
 * calibration01) so it can replace PhoneBreathProcessor as a drop-in.
 */

export interface LynphanSettings {
  shortBufferSize: number;
  longBufferSize: number;
  startingThreshold: number;
  thresholdIncrement: number;
  thresholdDecrement: number;
  peakBufferSize: number;
  breathDetectionWaitTime: number;
  breathingRateInterval: number;
  initialSampleRate: number;
  rateRefreshSeconds: number;
  staleTimeoutMs: number;
  warmupSeconds: number;
  breathSeenSeconds: number;
  signalTauMs: number;
  envelopeWindowMs: number;
  minSignalScale: number;
  phaseDerivativeTauMs: number;
  phaseEnterThreshold: number;
  phaseHoldThreshold: number;
  phaseConfirmationMs: number;
  phaseMinimumDwellMs: number;
  minSampleRate: number;
  maxSampleRate: number;
}

export const defaultLynphanSettings = (): LynphanSettings => ({
  shortBufferSize: 12,
  longBufferSize: 12_000,
  startingThreshold: 0.05,
  thresholdIncrement: 0.000_005,
  thresholdDecrement: 0.000_005,
  peakBufferSize: 60,
  breathDetectionWaitTime: 0.25,
  breathingRateInterval: 60,
  initialSampleRate: 0,
  rateRefreshSeconds: 0.05,
  staleTimeoutMs: 600,
  warmupSeconds: 2,
  breathSeenSeconds: 6,
  signalTauMs: 240,
  envelopeWindowMs: 5000,
  minSignalScale: 1e-4,
  phaseDerivativeTauMs: 400,
  phaseEnterThreshold: 0.03,
  phaseHoldThreshold: 0.02,
  phaseConfirmationMs: 400,
  phaseMinimumDwellMs: 400,
  minSampleRate: 1,
  maxSampleRate: 500,
});

export interface LynphanSnapshot {
  sampleRate: number;
  threshold: number;
  totalDifference: number;
  peakDetected: boolean;
  breathCounted: boolean;
  bpm: number;
  calibrated: boolean;
  ready: boolean;
  lost: boolean;
  phase: -1 | 0 | 1;
  volume01: number;
  derivativePerSecond: number;
  flow01: number;
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

interface AccelSample {
  x: number;
  y: number;
  z: number;
}

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));
const clamp01 = (value: number) => clamp(value, 0, 1);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const inverseLerp01 = (low: number, high: number, value: number) =>
  Math.abs(high - low) < 1e-8
    ? 0.5
    : clamp01((value - low) / (high - low));

/** Running average over the most recent N samples (O(1) push via ring + sum). */
class RingAverage {
  private buffer: number[];
  private index = 0;
  private count = 0;
  private sum = 0;

  constructor(readonly size: number) {
    this.buffer = new Array<number>(Math.max(1, size)).fill(0);
  }

  push(value: number): number {
    const old = this.buffer[this.index]!;
    this.buffer[this.index] = value;
    this.sum += value - old;
    if (this.count < this.size) this.count++;
    this.index = (this.index + 1) % this.size;
    return this.sum / this.count;
  }

  reset(): void {
    this.buffer.fill(0);
    this.index = 0;
    this.count = 0;
    this.sum = 0;
  }
}

/** Rolling boolean window that tracks how many entries are true (O(1) push). */
class BoolWindow {
  private buffer: boolean[] = [];
  private ones = 0;
  private maxCapacity = 0;

  get capacity(): number {
    return this.maxCapacity;
  }

  set capacity(value: number) {
    this.maxCapacity = Math.max(0, Math.floor(value));
    this.trim();
  }

  get length(): number {
    return this.buffer.length;
  }

  push(value: boolean): number {
    this.buffer.push(value);
    if (value) this.ones++;
    this.trim();
    return this.ones;
  }

  private trim(): void {
    while (this.buffer.length > this.maxCapacity) {
      if (this.buffer.shift()) this.ones--;
    }
  }

  clear(): void {
    this.buffer = [];
    this.ones = 0;
  }
}

export class LynphanBreathDetector {
  settings: LynphanSettings;

  private shortX: RingAverage;
  private shortY: RingAverage;
  private shortZ: RingAverage;
  private longX: RingAverage;
  private longY: RingAverage;
  private longZ: RingAverage;

  private threshold: number;
  private peakDetected = false;
  private peakWindow: BoolWindow;
  private goingDown = false;
  private peakDetectedFiltered = false;
  private breathDetectionTimeCounter = 0;
  private filteredWindow: BoolWindow;
  private breathCounted = false;
  private bpm = 0;

  private sampleRate: number;
  private samplesSeen = 0;
  private lastSourceMs: number | null = null;
  private lastPushedMs: number | null = null;
  private lost = false;

  private lastTotalDiff = 0;
  private smoothedDiff = 0;
  private lastSmoothedDiff: number | null = null;
  private lastSmoothedAtMs: number | null = null;
  private derivative = 0;
  private flow01 = 0;
  private volume01 = 0.5;
  lastVolume = 0.5;
  private phase: -1 | 0 | 1 = 0;
  private activeSinceMs: number | null = null;
  private candidate: -1 | 0 | 1 = 0;
  private candidateSinceMs: number | null = null;
  private envelope: Array<{ t: number; v: number }> = [];
  private countedTimes: number[] = [];

  private rateSamples = 0;
  private lastRateRefreshMs: number | null = null;

  constructor(settings?: Partial<LynphanSettings>) {
    this.settings = { ...defaultLynphanSettings(), ...settings };
    const s = this.settings;
    this.shortX = new RingAverage(s.shortBufferSize);
    this.shortY = new RingAverage(s.shortBufferSize);
    this.shortZ = new RingAverage(s.shortBufferSize);
    this.longX = new RingAverage(s.longBufferSize);
    this.longY = new RingAverage(s.longBufferSize);
    this.longZ = new RingAverage(s.longBufferSize);
    this.threshold = s.startingThreshold;
    this.sampleRate = s.initialSampleRate;
    this.peakWindow = new BoolWindow();
    this.peakWindow.capacity = s.peakBufferSize;
    this.filteredWindow = new BoolWindow();
    this.filteredWindow.capacity = Math.round(this.sampleRate * s.breathingRateInterval);
  }

  reset(): void {
    const s = this.settings;
    this.shortX.reset();
    this.shortY.reset();
    this.shortZ.reset();
    this.longX.reset();
    this.longY.reset();
    this.longZ.reset();
    this.threshold = s.startingThreshold;
    this.peakDetected = false;
    this.peakWindow.clear();
    this.goingDown = false;
    this.peakDetectedFiltered = false;
    this.breathDetectionTimeCounter = 0;
    this.filteredWindow.clear();
    this.breathCounted = false;
    this.bpm = 0;
    this.sampleRate = s.initialSampleRate;
    this.samplesSeen = 0;
    this.lastSourceMs = null;
    this.lastPushedMs = null;
    this.lost = false;
    this.lastTotalDiff = 0;
    this.smoothedDiff = 0;
    this.lastSmoothedDiff = null;
    this.lastSmoothedAtMs = null;
    this.derivative = 0;
    this.flow01 = 0;
    this.volume01 = 0.5;
    this.lastVolume = 0.5;
    this.phase = 0;
    this.activeSinceMs = null;
    this.candidate = 0;
    this.candidateSinceMs = null;
    this.envelope = [];
    this.countedTimes = [];
    this.rateSamples = 0;
    this.lastRateRefreshMs = null;
    this.filteredWindow.capacity = Math.round(this.sampleRate * s.breathingRateInterval);
  }

  pushSample(accel: AccelSample, timeMs: number): LynphanSnapshot {
    const s = this.settings;

    if (this.lastPushedMs !== null && timeMs < this.lastPushedMs - 250) {
      this.reset();
    }

    const last = this.lastSourceMs;
    const deltaMs = last === null ? 16 : Math.max(1, timeMs - last);
    const dt = deltaMs / 1000;
    const stale = last !== null && deltaMs > s.staleTimeoutMs;
    if (stale) {
      this.lost = true;
      this.phase = 0;
      this.activeSinceMs = null;
      this.candidate = 0;
      this.candidateSinceMs = null;
      this.goingDown = false;
      this.breathDetectionTimeCounter = 0;
      this.lastSmoothedDiff = null;
      this.lastSmoothedAtMs = null;
      this.derivative = 0;
      this.flow01 = 0;
    } else {
      this.lost = false;
    }
    this.lastSourceMs = timeMs;

    // Short vs long running averages per axis, then total difference.
    const xShort = this.shortX.push(accel.x);
    const yShort = this.shortY.push(accel.y);
    const zShort = this.shortZ.push(accel.z);
    const xLong = this.longX.push(accel.x);
    const yLong = this.longY.push(accel.y);
    const zLong = this.longZ.push(accel.z);
    const totalDiff =
      Math.abs(xShort - xLong) + Math.abs(yShort - yLong) + Math.abs(zShort - zLong);
    this.lastTotalDiff = totalDiff;

    // Adaptive threshold (uses the previous frame's peak state, then compares).
    if (this.threshold <= 0 || this.threshold >= 1) this.threshold = s.startingThreshold;
    this.threshold += this.peakDetected ? s.thresholdIncrement : -s.thresholdDecrement;
    this.peakDetected = totalDiff > this.threshold;

    // Peak debounce: exactly one true in the last peakBufferSize samples.
    const peaksInWindow = this.peakWindow.push(this.peakDetected);
    const onePeakDetected = peaksInWindow === 1;

    if (onePeakDetected) {
      if (!this.goingDown && this.breathDetectionTimeCounter > s.breathDetectionWaitTime) {
        this.peakDetectedFiltered = true;
        this.goingDown = true;
        this.breathDetectionTimeCounter = 0;
        this.countedTimes.push(timeMs);
        this.trimCounted(timeMs);
      } else {
        this.peakDetectedFiltered = false;
        this.goingDown = false;
      }
    } else {
      this.peakDetectedFiltered = false;
    }
    this.breathDetectionTimeCounter += dt;

    // Measure sample rate from timestamps (mirrors the framerate counter).
    this.rateSamples += 1;
    if (this.lastRateRefreshMs === null) this.lastRateRefreshMs = timeMs;
    if (timeMs - this.lastRateRefreshMs >= s.rateRefreshSeconds * 1000) {
      const windowSeconds = (timeMs - this.lastRateRefreshMs) / 1000;
      if (windowSeconds > 0) {
        this.sampleRate = clamp(
          this.rateSamples / windowSeconds,
          s.minSampleRate,
          s.maxSampleRate,
        );
      }
      this.lastRateRefreshMs = timeMs;
      this.rateSamples = 0;
    }

    // Rolling breaths-per-minute over sampleRate * breathingRateInterval samples.
    this.filteredWindow.capacity = Math.round(this.sampleRate * s.breathingRateInterval);
    const breaths = this.filteredWindow.push(this.peakDetectedFiltered);
    this.bpm = Math.round(breaths * (60 / s.breathingRateInterval));
    this.breathCounted = this.peakDetectedFiltered;

    this.samplesSeen++;
    this.lastPushedMs = timeMs;
    this.updatePresentation(totalDiff, timeMs, Math.max(1, deltaMs));
    return this.snapshot(timeMs);
  }

  snapshot(timeMs = this.lastPushedMs ?? 0): LynphanSnapshot {
    const s = this.settings;
    this.trimCounted(timeMs);
    const lost = this.lost;
    const breathSeen = this.countedTimes.length > 0;
    const rate = Math.max(10, this.sampleRate);
    const warmupSamples = Math.round(Math.max(40, s.warmupSeconds * rate));
    const warmedUp = this.samplesSeen >= warmupSamples;
    const ready = warmedUp && breathSeen && !lost;
    const calibrated = warmedUp && !lost;
    const capacity = Math.round(rate * s.breathingRateInterval);
    const calibration01 = capacity > 0 ? clamp01(this.filteredWindow.length / capacity) : 0;
    const confidence01 = ready
      ? clamp01(0.35 + 0.65 * calibration01)
      : breathSeen
        ? 0.25
        : 0;
    const phase = ready ? this.phase : 0;
    const span = this.envelopeSpan();

    return {
      sampleRate: this.sampleRate,
      threshold: this.threshold,
      totalDifference: this.lastTotalDiff,
      peakDetected: this.peakDetected,
      breathCounted: this.breathCounted && ready,
      bpm: this.bpm,
      calibrated,
      ready,
      lost,
      phase,
      volume01: this.volume01,
      derivativePerSecond: this.derivative,
      flow01: this.flow01,
      confidence01,
      calibration01,
      values: {
        acc_breathing_magnitude: ready ? this.smoothedDiff : undefined,
        breathing_volume: ready ? this.volume01 : undefined,
        breathing_axis_range: ready ? span : undefined,
        breathing_signal_ready: ready ? 1 : 0,
        breathing_signal_confidence: confidence01,
        breathing_calibration: calibration01,
        breathing_phase: phase,
      },
    };
  }

  private updatePresentation(totalDiff: number, timeMs: number, deltaMs: number): void {
    const s = this.settings;
    if (this.lastSmoothedDiff === null) {
      this.smoothedDiff = totalDiff;
      this.lastSmoothedDiff = totalDiff;
      this.lastSmoothedAtMs = timeMs;
    } else {
      const alpha = clamp(deltaMs / (s.signalTauMs + deltaMs), 0, 1);
      const prev = this.smoothedDiff;
      this.smoothedDiff = lerp(prev, totalDiff, alpha);
      this.envelope.push({ t: timeMs, v: this.smoothedDiff });
      this.trimEnvelope(timeMs);
      const span = this.envelopeSpan();
      this.volume01 = inverseLerp01(0, span, this.smoothedDiff);
      this.lastVolume = this.volume01;
      if (this.lastSmoothedAtMs !== null) {
        const dt = Math.max(0.001, (timeMs - this.lastSmoothedAtMs) / 1000);
        const rawDeriv = ((this.smoothedDiff - prev) / span) / dt;
        const dAlpha = clamp(deltaMs / (s.phaseDerivativeTauMs + deltaMs), 0, 1);
        this.derivative += dAlpha * (rawDeriv - this.derivative);
        this.flow01 = clamp01(Math.abs(this.derivative));
        this.classifyDerivative(this.derivative, timeMs);
      }
      this.lastSmoothedAtMs = timeMs;
      this.lastSmoothedDiff = this.smoothedDiff;
    }
  }

  private classifyDerivative(deriv: number, timeMs: number): void {
    const s = this.settings;
    let requested: -1 | 0 | 1 = this.phase;
    if (deriv >= s.phaseEnterThreshold) requested = 1;
    else if (deriv <= -s.phaseEnterThreshold) requested = -1;
    else if (Math.abs(deriv) <= s.phaseHoldThreshold) requested = 0;
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
    const confirmed = timeMs - this.candidateSinceMs >= s.phaseConfirmationMs;
    const dwell =
      this.activeSinceMs === null ||
      timeMs - this.activeSinceMs >= s.phaseMinimumDwellMs;
    if (confirmed && dwell) {
      this.phase = requested;
      this.activeSinceMs = timeMs;
      this.candidateSinceMs = null;
    }
  }

  private envelopeSpan(): number {
    let low = Infinity;
    let high = -Infinity;
    for (const entry of this.envelope) {
      if (entry.v < low) low = entry.v;
      if (entry.v > high) high = entry.v;
    }
    if (!Number.isFinite(low)) return this.settings.minSignalScale;
    return Math.max(this.settings.minSignalScale, high - low);
  }

  private trimEnvelope(timeMs: number): void {
    const cutoff = timeMs - this.settings.envelopeWindowMs;
    while (this.envelope.length && this.envelope[0]!.t < cutoff) this.envelope.shift();
  }

  private trimCounted(timeMs: number): void {
    const cutoff = timeMs - this.settings.breathSeenSeconds * 1000;
    while (this.countedTimes.length && this.countedTimes[0]! < cutoff) this.countedTimes.shift();
  }
}