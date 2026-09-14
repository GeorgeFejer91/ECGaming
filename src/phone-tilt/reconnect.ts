export interface ReconnectBackoffOptions {
  windowMs: number;
  initialMs?: number;
  maxMs?: number;
  multiplier?: number;
}

export const TRANSIENT_RECONNECT: ReconnectBackoffOptions = {
  windowMs: 90_000,
  initialMs: 250,
  maxMs: 4_000,
  multiplier: 1.7,
};

export class ReconnectBackoff {
  private timer?: ReturnType<typeof setTimeout>;
  private until = 0;
  private delay: number;
  private readonly initialMs: number;
  private readonly maxMs: number;
  private readonly multiplier: number;

  constructor(private readonly options: ReconnectBackoffOptions = TRANSIENT_RECONNECT) {
    this.initialMs = options.initialMs ?? 250;
    this.maxMs = options.maxMs ?? 4_000;
    this.multiplier = options.multiplier ?? 1.7;
    this.delay = this.initialMs;
  }

  schedule(run: () => void, now = performance.now()) {
    if (!this.until) this.until = now + this.options.windowMs;
    if (now >= this.until) return false;
    this.cancelTimer();
    const wait = this.delay;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      run();
    }, wait);
    this.delay = Math.min(this.maxMs, Math.max(this.initialMs, Math.ceil(this.delay * this.multiplier)));
    return true;
  }

  clear() {
    this.cancelTimer();
    this.until = 0;
    this.delay = this.initialMs;
  }

  cancelTimer() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
