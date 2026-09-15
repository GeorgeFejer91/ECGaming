import {
  LynphanBreathDetector,
  type LynphanSettings,
} from "../phone-breather/lynphan";

/**
 * Canonical breath-analysis unit.  Phone DeviceMotion emits m/s²;
 * Polar H10 raw ACC is in "g" (9.80665 m/s² ≡ 1 g).
 * LynphanBreathDetector operates on g, so all input is normalised
 * to g before being pushed.
 */
export type AccelerometerUnit = "ms2" | "g";

const G_TO_MS2 = 9.80665;

/** Single accelerometer sample with a timestamp. */
export interface AccelSample {
  x: number;
  y: number;
  z: number;
  timeMs: number;
  unit?: AccelerometerUnit;
}

/** Polar-compatible presentation point (volume01 over time). */
export interface BreathPresentationPoint {
  timeMs: number;
  volume01: number;
}

/**
 * Unified breath frame produced by the central analyzer.
 *
 * The `values` shape is deliberately identical to the Polar ACC
 * breathing snapshot so ground-control can substitute it directly.
 */
export interface BreathAnalysisFrame {
  timestampMs: number;
  ready: boolean;
  calibrated: boolean;
  lost: boolean;
  phase: -1 | 0 | 1;
  volume01: number;
  derivativePerSecond: number;
  confidence01: number;
  calibration01: number;
  bpm: number;
  values: {
    acc_breathing_magnitude: number | undefined;
    breathing_volume: number | undefined;
    breathing_axis_range: number | undefined;
    breathing_signal_ready: number;
    breathing_signal_confidence: number;
    breathing_calibration: number;
    breathing_phase: number;
  };
  diagnostics: {
    motionScore01: number;
    pcaDominance01: number;
    confidence01: number;
  };
  presentationPoints: BreathPresentationPoint[];
}

const MAX_PRESENTATION_POINTS = 512;

/**
 * Central breath analyzer — reusable, framework-free.
 *
 * Wraps {@link LynphanBreathDetector} with unit normalisation,
 * presentation-point collection and a diagnostic snapshot.  The
 * manager (`BreathSourceManager`) decides *which* source feeds this
 * analyzer, keeping the detection logic itself device-agnostic.
 */
export class BreathAnalyzer {
  private readonly processor: LynphanBreathDetector;
  private lastFrame: BreathAnalysisFrame | null = null;
  private readonly presentation: BreathPresentationPoint[] = [];
  private publishedCount = 0;
  private totalAppended = 0;
  private readonly frameListeners = new Set<
    (frame: BreathAnalysisFrame) => void
  >();

  constructor(settings?: Partial<LynphanSettings>) {
    this.processor = new LynphanBreathDetector(settings);
  }

  /** Mutable tuning knobs forwarded from the wrapped processor. */
  get settings(): LynphanSettings {
    return this.processor.settings;
  }

  /** Push a single accelerometer sample and return the current frame. */
  ingest(sample: AccelSample): BreathAnalysisFrame {
    // LynphanBreathDetector operates on g. Phone DeviceMotion is m/s²;
    // Polar ACC from ground-control arrives as m/s² (converted from mg).
    const scale = sample.unit === "g" ? 1 : 1 / G_TO_MS2;
    const snapshot = this.processor.pushSample(
      { x: sample.x * scale, y: sample.y * scale, z: sample.z * scale },
      sample.timeMs,
    );

    const snapshotValues = snapshot.values;
    const frame: BreathAnalysisFrame = {
      timestampMs: sample.timeMs,
      ready: snapshot.ready,
      calibrated: snapshot.calibrated,
      lost: snapshot.lost,
      phase: snapshot.phase,
      volume01: snapshot.volume01,
      derivativePerSecond: snapshot.derivativePerSecond,
      confidence01: snapshot.confidence01,
      calibration01: snapshot.calibration01,
      bpm: snapshot.bpm,
      values: {
        acc_breathing_magnitude: snapshotValues.acc_breathing_magnitude,
        breathing_volume: snapshotValues.breathing_volume,
        breathing_axis_range: snapshotValues.breathing_axis_range,
        breathing_signal_ready: snapshotValues.breathing_signal_ready,
        breathing_signal_confidence: snapshotValues.breathing_signal_confidence,
        breathing_calibration: snapshotValues.breathing_calibration,
        breathing_phase: snapshotValues.breathing_phase,
      },
      diagnostics: {
        motionScore01: snapshot.ready ? 1 : snapshot.totalDifference / 0.1,
        pcaDominance01: 0,
        confidence01: snapshot.confidence01,
      },
      presentationPoints: [],
    };

    if (snapshot.calibrated) {
      this.presentation.push({
        timeMs: sample.timeMs,
        volume01: snapshot.volume01,
      });
      if (this.presentation.length > MAX_PRESENTATION_POINTS)
        this.presentation.shift();
      this.totalAppended += 1;
    }

    // Emit only the points appended since the previous ingest so consumers
    // get a rolling waveform, not the whole buffer.  The ring is trimmed
    // from the front, so map monotonic appended indices back into it.
    const oldestIndex = this.totalAppended - this.presentation.length;
    const emitFrom = Math.max(0, this.publishedCount - oldestIndex);
    if (this.totalAppended > this.publishedCount)
      frame.presentationPoints = this.presentation.slice(emitFrom);
    this.publishedCount = this.totalAppended;

    this.lastFrame = frame;
    for (const l of [...this.frameListeners]) l(frame);
    return frame;
  }

  snapshot(): BreathAnalysisFrame {
    return (
      this.lastFrame ?? {
        timestampMs: performance.now(),
        ready: false,
        calibrated: false,
        lost: false,
        phase: 0,
        volume01: 0.5,
        derivativePerSecond: 0,
        confidence01: 0,
        calibration01: 0,
        bpm: 0,
        values: {
          acc_breathing_magnitude: undefined,
          breathing_volume: undefined,
          breathing_axis_range: undefined,
          breathing_signal_ready: 0,
          breathing_signal_confidence: 0,
          breathing_calibration: 0,
          breathing_phase: 0,
        },
        diagnostics: { motionScore01: 0, pcaDominance01: 0, confidence01: 0 },
        presentationPoints: [],
      }
    );
  }

  reset(): void {
    this.processor.reset();
    this.lastFrame = null;
    this.presentation.length = 0;
    this.publishedCount = 0;
    this.totalAppended = 0;
  }

  onFrame(listener: (frame: BreathAnalysisFrame) => void): () => void {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }
}
