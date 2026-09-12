/** Local H10 notifications only. Never synthesize beats from BPM or replay an RR backlog. */
export class PolarRrHaptics {
  private connected = false;
  private lastPulseAt = -Infinity;
  private lastRPeakAt = -Infinity;
  constructor(
    private readonly vibrate: (duration: number) => unknown,
    private readonly visible: () => boolean,
    private readonly now: () => number = () => performance.now(),
  ) {}
  handle(event: { kind?: string; connected?: boolean; mock?: boolean; rrIntervalsMs?: unknown; ageMs?: number }) {
    if (event.mock === true || event.kind === "error") { this.stop(); return; }
    if (event.kind === "connection") {
      this.stop(); this.connected = event.connected === true;
      return;
    }
    if (!this.connected || !this.visible()) return;
    const now = this.now();
    if (event.kind === "r-peak") {
      if (typeof event.ageMs !== "number" || !Number.isFinite(event.ageMs) || event.ageMs < 0 || event.ageMs > 200) return;
      this.lastRPeakAt = now;
    } else {
      if (event.kind !== "heart-rate" || !Array.isArray(event.rrIntervalsMs) || now - this.lastRPeakAt < 2500) return;
      const rr = event.rrIntervalsMs.at(-1);
      if (typeof rr !== "number" || !Number.isFinite(rr) || rr < 250 || rr > 2500) return;
    }
    if (now - this.lastPulseAt < 200) return;
    // A Bluetooth notification can contain older RR intervals. Pulse for its newest beat once.
    this.lastPulseAt = now;
    this.output(100);
  }
  pause() { this.output(0); }
  stop() { this.connected = false; this.lastPulseAt = this.lastRPeakAt = -Infinity; this.pause(); }
  private output(duration: number) {
    try { this.vibrate(duration); } catch { /* Unsupported haptics never interrupt steering or ECG. */ }
  }
}
