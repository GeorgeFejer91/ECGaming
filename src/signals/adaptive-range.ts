import type {
  DerivedMetricId,
  NormalizationConfig,
} from "../protocol/types";

export interface AdaptiveRangeSnapshot {
  sourceSessionId: string;
  metric: DerivedMetricId;
  observedMinimum?: number;
  observedMaximum?: number;
  sampleCount: number;
  startedAt?: number;
  lastSampleAt?: number;
  span: number;
  ready: boolean;
}

interface AdaptiveRangeState {
  sourceSessionId: string;
  metric: DerivedMetricId;
  policyKey: string;
  observedMinimum: number;
  observedMaximum: number;
  sampleCount: number;
  startedAt: number;
  lastSampleAt: number;
  lastValue: number;
}

const finiteNonnegative = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const normalizedPolicy = (config: NormalizationConfig) => ({
  minimumSamples: Math.max(2, Math.floor(finiteNonnegative(config.minimumSamples, 2))),
  warmupMs: finiteNonnegative(config.warmupMs, 0),
  minimumSpan: finiteNonnegative(config.minimumSpan, 0),
});

const policyKey = (config: NormalizationConfig) => {
  const policy = normalizedPolicy(config);
  return `${policy.minimumSamples}:${policy.warmupMs}:${policy.minimumSpan}`;
};

/**
 * Owns learned metric extrema for exactly one active signal-source session.
 * Calling startSession with a different id clears every learned range so one
 * wearer/source can never silently inherit another one's calibration.
 */
export class AdaptiveRangeTracker {
  private sourceSessionId = "";
  private readonly states = new Map<DerivedMetricId, AdaptiveRangeState>();

  startSession(sourceSessionId: string) {
    const next = String(sourceSessionId ?? "").trim();
    if (next === this.sourceSessionId) return false;
    this.sourceSessionId = next;
    this.states.clear();
    return true;
  }

  reset(metric?: DerivedMetricId) {
    if (metric) return this.states.delete(metric);
    const changed = this.states.size > 0;
    this.states.clear();
    return changed;
  }

  observe(
    metric: DerivedMetricId,
    value: number,
    config: NormalizationConfig,
    observedAt: number,
  ) {
    if (
      !this.sourceSessionId ||
      config.mode !== "adaptive" ||
      !Number.isFinite(value) ||
      !Number.isFinite(observedAt)
    )
      return false;
    const key = policyKey(config);
    let state = this.states.get(metric);
    if (
      !state ||
      state.sourceSessionId !== this.sourceSessionId ||
      state.policyKey !== key
    ) {
      state = {
        sourceSessionId: this.sourceSessionId,
        metric,
        policyKey: key,
        observedMinimum: value,
        observedMaximum: value,
        sampleCount: 1,
        startedAt: observedAt,
        lastSampleAt: observedAt,
        lastValue: value,
      };
      this.states.set(metric, state);
      return true;
    }
    if (observedAt < state.lastSampleAt) return false;
    if (observedAt === state.lastSampleAt && value === state.lastValue)
      return false;
    state.observedMinimum = Math.min(state.observedMinimum, value);
    state.observedMaximum = Math.max(state.observedMaximum, value);
    state.sampleCount += 1;
    state.lastSampleAt = observedAt;
    state.lastValue = value;
    return true;
  }

  snapshot(
    metric: DerivedMetricId,
    config: NormalizationConfig,
  ): AdaptiveRangeSnapshot {
    const state = this.states.get(metric);
    if (
      !state ||
      !this.sourceSessionId ||
      state.sourceSessionId !== this.sourceSessionId ||
      state.policyKey !== policyKey(config)
    )
      return {
        sourceSessionId: this.sourceSessionId,
        metric,
        sampleCount: 0,
        span: 0,
        ready: false,
      };
    const policy = normalizedPolicy(config);
    const span = state.observedMaximum - state.observedMinimum;
    return {
      sourceSessionId: state.sourceSessionId,
      metric,
      observedMinimum: state.observedMinimum,
      observedMaximum: state.observedMaximum,
      sampleCount: state.sampleCount,
      startedAt: state.startedAt,
      lastSampleAt: state.lastSampleAt,
      span,
      ready:
        state.sampleCount >= policy.minimumSamples &&
        state.lastSampleAt - state.startedAt >= policy.warmupMs &&
        span >= policy.minimumSpan &&
        span > 0,
    };
  }

  normalize(
    metric: DerivedMetricId,
    value: number,
    config: NormalizationConfig,
  ): number | undefined {
    if (!Number.isFinite(value) || config.mode !== "adaptive") return undefined;
    const snapshot = this.snapshot(metric, config);
    if (
      !snapshot.ready ||
      snapshot.observedMinimum === undefined ||
      snapshot.observedMaximum === undefined
    )
      return undefined;
    return Math.max(
      0,
      Math.min(
        1,
        (value - snapshot.observedMinimum) /
          (snapshot.observedMaximum - snapshot.observedMinimum),
      ),
    );
  }
}
