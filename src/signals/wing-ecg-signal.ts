import { RealtimeEcgTrace } from "./realtime-ecg-trace";

/** Raw samples stay in memory. RR intervals alone are not an ECG waveform. */
export interface WingEcgFrame {
  microvolts: readonly number[];
  sensorTimestampNs: string;
  sourceId: string;
  simulated: boolean;
}

export class WingEcgSignal {
  readonly trace = new RealtimeEcgTrace({ windowSeconds: 3, minimumHalfRange: 150 });
  private sourceId?: string;
  private simulated = false;
  private lastTimestamp?: bigint;
  private lastReceivedAt = -Infinity;

  clear() {
    this.trace.reset();
    this.sourceId = undefined;
    this.lastTimestamp = undefined;
    this.lastReceivedAt = -Infinity;
  }

  accept(frame: WingEcgFrame, now: number) {
    if (!frame.sourceId || !Number.isFinite(now) || !frame.microvolts.length ||
        frame.microvolts.length > 520 || !frame.microvolts.every(Number.isFinite)) return false;
    let timestamp: bigint;
    try { timestamp = BigInt(frame.sensorTimestampNs); } catch { return false; }
    if (timestamp < 0n) return false;
    if (this.sourceId !== frame.sourceId || this.simulated !== frame.simulated) this.clear();
    if (this.lastTimestamp !== undefined && timestamp <= this.lastTimestamp) return false;
    // Do not connect a new arrival across a long silence in the source.
    if (now-this.lastReceivedAt > 1000) this.trace.reset();
    this.sourceId = frame.sourceId;
    this.simulated = frame.simulated;
    this.lastTimestamp = timestamp;
    this.lastReceivedAt = now;
    return this.trace.pushFrame(frame.microvolts, frame.sensorTimestampNs, now);
  }

  snapshot(now: number) {
    const trace = this.trace.snapshot(now);
    // Keep short R peaks intact even when they fall outside the scope's robust
    // percentile range. This is a visual auto-scale, never a diagnostic scale.
    let halfRange = trace.halfRange;
    for (const value of trace.values) halfRange = Math.max(halfRange, Math.abs(value-trace.center)*1.05);
    const state = this.trace.sampleCount < 2 ? "waiting"
      : now-this.lastReceivedAt > 1000 ? "stale"
      : this.simulated ? "simulated" : "live";
    return { ...trace, halfRange, state } as const;
  }
}
