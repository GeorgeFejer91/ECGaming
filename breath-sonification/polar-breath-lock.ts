export type LockedBreathPhase = "inhale" | "exhale" | "hold";

export interface PolarBreathingSnapshotLike {
  calibrated?: boolean;
  ready?: boolean;
  phase?: number;
  volume01?: number;
  derivativePerSecond?: number;
  values?: Record<string, number | undefined>;
  diagnostics?: Record<string, number | undefined>;
}

export interface PolarLockFrame {
  calibration01: number;
  calibrated: boolean;
  confidence01: number;
  flow01: number;
  phase: LockedBreathPhase;
  phaseValue: -1 | 0 | 1;
  ready: boolean;
  receivedAtMs: number;
  stale: boolean;
  volume01: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const finite = (value: unknown, fallback: unknown = 0) => {
  const number = Number(value);
  const fallbackNumber = Number(fallback);
  return Number.isFinite(number)
    ? number
    : Number.isFinite(fallbackNumber)
      ? fallbackNumber
      : 0;
};

const phaseValue = (value: unknown): -1 | 0 | 1 =>
  Number(value) > 0 ? 1 : Number(value) < 0 ? -1 : 0;

const phaseName = (value: -1 | 0 | 1): LockedBreathPhase =>
  value > 0 ? "inhale" : value < 0 ? "exhale" : "hold";

export class PolarBreathLock {
  private latest?: PolarLockFrame;

  constructor(
    readonly staleAfterMs = 650,
    readonly fullFlowPerSecond = 0.15,
  ) {}

  accept(
    snapshot: PolarBreathingSnapshotLike,
    receivedAtMs: number,
  ): PolarLockFrame {
    const values = snapshot.values ?? {};
    const diagnostics = snapshot.diagnostics ?? {};
    const phase = phaseValue(snapshot.phase ?? values.breathing_phase);
    const calibrated = snapshot.calibrated === true;
    const readyMetric = values.breathing_signal_ready;
    const ready =
      snapshot.ready === true &&
      (readyMetric === undefined || finite(readyMetric) === 1);
    const frame: PolarLockFrame = {
      calibration01: clamp01(
        finite(values.breathing_calibration, calibrated ? 1 : 0),
      ),
      calibrated,
      confidence01: ready
        ? clamp01(
            finite(
              diagnostics.confidence01,
              values.breathing_signal_confidence,
            ),
          )
        : 0,
      flow01: ready
        ? clamp01(
            Math.abs(finite(snapshot.derivativePerSecond)) /
              Math.max(0.001, this.fullFlowPerSecond),
          )
        : 0,
      phase: phaseName(ready ? phase : 0),
      phaseValue: ready ? phase : 0,
      ready,
      receivedAtMs: finite(receivedAtMs),
      stale: false,
      volume01: clamp01(
        finite(snapshot.volume01, values.breathing_volume),
      ),
    };
    this.latest = frame;
    return { ...frame };
  }

  read(nowMs: number): PolarLockFrame | undefined {
    if (!this.latest) return undefined;
    if (finite(nowMs) - this.latest.receivedAtMs <= this.staleAfterMs)
      return { ...this.latest };
    return {
      ...this.latest,
      confidence01: 0,
      flow01: 0,
      phase: "hold",
      phaseValue: 0,
      ready: false,
      stale: true,
    };
  }

  reset(): void {
    this.latest = undefined;
  }
}
