export interface DetectedBeat {
  timestampMs: number;
  intervalMs?: number;
  confidence: number;
  polarity: 1 | -1;
}

export class CausalRPeakDetector {
  private baseline = 0;
  private previous = 0;
  private noise = 25;
  private signal = 180;
  private lastBeatMs = -Infinity;
  private samplePeriodNs: bigint;
  private warmupSamples = 0;
  private polarity: 1 | -1 = 1;
  private lastRrMs?: number;
  readonly sampleRateHz: number;

  constructor(sampleRateHz = 130) {
    this.sampleRateHz = sampleRateHz;
    this.samplePeriodNs = BigInt(Math.round(1_000_000_000 / sampleRateHz));
  }

  reset() {
    this.baseline = 0;
    this.previous = 0;
    this.noise = 25;
    this.signal = 180;
    this.lastBeatMs = -Infinity;
    this.warmupSamples = 0;
    this.polarity = 1;
    this.lastRrMs = undefined;
  }
  setReferenceRr(rrMs: number | undefined) {
    if (Number.isFinite(rrMs) && rrMs! >= 300 && rrMs! <= 2000)
      this.lastRrMs = rrMs;
  }
  get ready() {
    return this.warmupSamples >= this.sampleRateHz * 2;
  }

  pushFrame(
    microvolts: readonly number[],
    sensorTimestampNs: string | bigint,
  ): DetectedBeat[] {
    if (!microvolts.length) return [];
    const lastNs = BigInt(sensorTimestampNs);
    const beats: DetectedBeat[] = [];
    const firstNs =
      lastNs - BigInt(microvolts.length - 1) * this.samplePeriodNs;
    for (let index = 0; index < microvolts.length; index += 1) {
      const timestampMs =
        Number(firstNs + BigInt(index) * this.samplePeriodNs) / 1_000_000;
      const beat = this.pushSample(microvolts[index]!, timestampMs);
      if (beat) beats.push(beat);
    }
    return beats;
  }

  pushSample(raw: number, timestampMs: number): DetectedBeat | undefined {
    if (!Number.isFinite(raw) || !Number.isFinite(timestampMs))
      return undefined;
    this.warmupSamples += 1;
    this.baseline += 0.012 * (raw - this.baseline);
    const centered = raw - this.baseline;
    const derivative = centered - this.previous;
    this.previous = centered;
    const energy = Math.abs(derivative) * 0.7 + Math.abs(centered) * 0.3;
    const threshold =
      this.noise + 0.38 * Math.max(40, this.signal - this.noise);
    const refractoryMs = 250;
    const candidate =
      energy > threshold && timestampMs - this.lastBeatMs >= refractoryMs;
    if (!candidate) {
      this.noise += 0.008 * (energy - this.noise);
      return undefined;
    }
    this.signal += 0.12 * (energy - this.signal);
    this.polarity = centered >= 0 ? 1 : -1;
    const intervalMs = Number.isFinite(this.lastBeatMs)
      ? timestampMs - this.lastBeatMs
      : undefined;
    this.lastBeatMs = timestampMs;
    const amplitudeConfidence = Math.max(
      0,
      Math.min(1, (energy - threshold) / Math.max(60, threshold)),
    );
    const rrConfidence =
      intervalMs && this.lastRrMs
        ? Math.max(
            0,
            1 -
              Math.abs(intervalMs - this.lastRrMs) /
                Math.max(200, this.lastRrMs * 0.35),
          )
        : 0.55;
    const confidence = Math.max(
      0,
      Math.min(1, 0.65 * amplitudeConfidence + 0.35 * rrConfidence),
    );
    return { timestampMs, intervalMs, confidence, polarity: this.polarity };
  }
}

export function frameSampleTimestamps(
  sensorTimestampNs: string | bigint,
  sampleCount: number,
  sampleRateHz = 130,
): number[] {
  const last = BigInt(sensorTimestampNs);
  const step = BigInt(Math.round(1_000_000_000 / sampleRateHz));
  const first = last - BigInt(Math.max(0, sampleCount - 1)) * step;
  return Array.from(
    { length: sampleCount },
    (_, index) => Number(first + BigInt(index) * step) / 1_000_000,
  );
}
