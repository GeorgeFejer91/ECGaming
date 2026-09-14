export class ScreenWakeLock {
  private sentinel?: WakeLockSentinel;
  private readonly manualReleases = new WeakSet<WakeLockSentinel>();

  constructor(private readonly shouldHold: () => boolean) {}

  async request() {
    if (document.hidden || !this.shouldHold() || this.sentinel) return;
    try {
      const lock = await navigator.wakeLock?.request("screen");
      if (!lock) return;
      if (document.hidden || !this.shouldHold()) {
        this.manualReleases.add(lock);
        await lock.release().catch(() => {});
        return;
      }
      this.sentinel = lock;
      lock.addEventListener("release", () => {
        if (this.sentinel === lock) this.sentinel = undefined;
        if (!this.manualReleases.has(lock) && !document.hidden && this.shouldHold())
          setTimeout(() => void this.request(), 0);
      });
    } catch {
      // Wake lock is best-effort; reconnect and leases remain the safety net.
    }
  }

  async release() {
    const lock = this.sentinel;
    this.sentinel = undefined;
    if (!lock) return;
    this.manualReleases.add(lock);
    await lock.release().catch(() => {});
  }
}
