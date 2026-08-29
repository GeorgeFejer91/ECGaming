const NANOSECONDS_PER_SECOND = 1_000_000_000n;

export interface RealtimeEcgTraceSnapshot {
  values: readonly number[];
  rightEdge01: number;
  sampleStep01: number;
  center: number;
  halfRange: number;
  latestAgeMs: number;
}

interface RealtimeEcgTraceOptions {
  sampleRateHz?: number;
  windowSeconds?: number;
  minimumHalfRange?: number;
}

function finiteSamples(samples: readonly unknown[]) {
  return samples.map(Number).filter(Number.isFinite);
}

function sourceTimestamp(value: unknown) {
  try {
    const parsed = BigInt(String(value));
    return parsed >= 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Keeps the raw Polar ECG window in sensor time. Rendering can therefore move
 * the trace continuously between batched BLE notifications without delaying or
 * inventing samples.
 */
export class RealtimeEcgTrace {
  readonly sampleRateHz: number;
  readonly windowMs: number;
  readonly capacity: number;
  readonly minimumHalfRange: number;
  readonly sampleIntervalNs: bigint;
  private values: number[] = [];
  private latestSourceTimestampNs?: bigint;
  private sensorToPageOffsetsMs: number[] = [];
  private sensorToPageOffsetMs?: number;
  private center = 0;
  private halfRange: number;

  constructor({
    sampleRateHz = 130,
    windowSeconds = 5,
    minimumHalfRange = 50,
  }: RealtimeEcgTraceOptions = {}) {
    this.sampleRateHz = Math.max(1, Number(sampleRateHz) || 130);
    this.windowMs = Math.max(250, (Number(windowSeconds) || 5) * 1_000);
    this.capacity = Math.ceil((this.windowMs / 1_000) * this.sampleRateHz) + 2;
    this.minimumHalfRange = Math.max(1, Number(minimumHalfRange) || 50);
    this.halfRange = this.minimumHalfRange;
    this.sampleIntervalNs =
      NANOSECONDS_PER_SECOND / BigInt(Math.round(this.sampleRateHz));
  }

  get sampleCount() {
    return this.values.length;
  }

  reset() {
    this.values.length = 0;
    this.latestSourceTimestampNs = undefined;
    this.sensorToPageOffsetsMs.length = 0;
    this.sensorToPageOffsetMs = undefined;
    this.center = 0;
    this.halfRange = this.minimumHalfRange;
  }

  pushFrame(
    samples: readonly unknown[],
    sensorTimestampNs: unknown,
    receivedAtMs: number,
  ) {
    const incoming = finiteSamples(samples);
    if (!incoming.length) return false;
    const received = Number(receivedAtMs);
    if (!Number.isFinite(received)) return false;

    const parsedEnd = sourceTimestamp(sensorTimestampNs);
    const endTimestampNs =
      parsedEnd ??
      (this.latestSourceTimestampNs === undefined
        ? BigInt(Math.round(received * 1_000_000))
        : this.latestSourceTimestampNs +
          this.sampleIntervalNs * BigInt(incoming.length));
    const frameStartTimestampNs =
      endTimestampNs - this.sampleIntervalNs * BigInt(incoming.length - 1);

    if (this.latestSourceTimestampNs !== undefined) {
      const expectedStartTimestampNs =
        this.latestSourceTimestampNs + this.sampleIntervalNs;
      const sourceGapNs = frameStartTimestampNs - expectedStartTimestampNs;
      const toleratedGapNs = this.sampleIntervalNs * 2n;
      if (sourceGapNs > toleratedGapNs || sourceGapNs < -toleratedGapNs)
        this.values.length = 0;
      if (sourceGapNs < -toleratedGapNs) {
        this.sensorToPageOffsetsMs.length = 0;
        this.sensorToPageOffsetMs = undefined;
      }
    }

    this.values.push(...incoming);
    if (this.values.length > this.capacity)
      this.values.splice(0, this.values.length - this.capacity);
    this.latestSourceTimestampNs = endTimestampNs;
    const observedOffsetMs = received - Number(endTimestampNs) / 1_000_000;
    if (Number.isFinite(observedOffsetMs)) {
      this.sensorToPageOffsetsMs.push(observedOffsetMs);
      if (this.sensorToPageOffsetsMs.length > 64)
        this.sensorToPageOffsetsMs.splice(
          0,
          this.sensorToPageOffsetsMs.length - 64,
        );
      const sortedOffsets = [...this.sensorToPageOffsetsMs].sort(
        (a, b) => a - b,
      );
      this.sensorToPageOffsetMs =
        sortedOffsets[Math.floor((sortedOffsets.length - 1) * 0.1)];
    }
    this.updateRange();
    return true;
  }

  snapshot(nowMs: number): RealtimeEcgTraceSnapshot {
    const now = Number(nowMs);
    const latestPresentationAtMs =
      this.latestSourceTimestampNs === undefined ||
      this.sensorToPageOffsetMs === undefined
        ? undefined
        : Number(this.latestSourceTimestampNs) / 1_000_000 +
          this.sensorToPageOffsetMs;
    const latestAgeMs =
      latestPresentationAtMs === undefined || !Number.isFinite(now)
        ? 0
        : Math.max(0, now - latestPresentationAtMs);
    return {
      values: this.values,
      rightEdge01: 1 - latestAgeMs / this.windowMs,
      sampleStep01: 1_000 / this.sampleRateHz / this.windowMs,
      center: this.center,
      halfRange: this.halfRange,
      latestAgeMs,
    };
  }

  private updateRange() {
    if (!this.values.length) return;
    const sorted = [...this.values].sort((a, b) => a - b);
    const low = sorted[Math.floor((sorted.length - 1) * 0.02)] ?? 0;
    const high = sorted[Math.floor((sorted.length - 1) * 0.98)] ?? 0;
    this.center = (low + high) / 2;
    this.halfRange = Math.max(this.minimumHalfRange, (high - low) / 2);
  }
}
