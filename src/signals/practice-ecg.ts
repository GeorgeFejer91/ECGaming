/** Deterministic game ECG in microvolts; the generated R peaks also clock practice beats. */
export class PracticeEcg {
  private nextSampleAt = 0;
  private nextBeatAt = 0;
  private lastBeatAt = -Infinity;
  reset(now: number) { this.nextSampleAt = this.nextBeatAt = now; this.lastBeatAt = -Infinity; }
  sample(now: number, bpm: number) {
    const rr = 60_000 / Math.max(30, Math.min(220, bpm));
    // Resume at the present time after a suspended tab, without replaying missed beats.
    if (now - this.nextSampleAt > 500) this.reset(now);
    const microvolts: number[] = [], beats: number[] = [];
    let lastSampleAt = now;
    const gaussian = (t: number, centre: number, width: number, height: number) => height * Math.exp(-.5 * ((t - centre) / width) ** 2);
    while (this.nextSampleAt <= now) {
      const at = this.nextSampleAt;
      if (at >= this.nextBeatAt) {
        this.lastBeatAt = at; this.nextBeatAt = at + rr; beats.push(at);
      }
      const t = (at - this.lastBeatAt) / 1000, upcoming = (at - this.nextBeatAt) / 1000;
      const qrs = (x: number) => gaussian(x, -.035, .012, -140) + gaussian(x, 0, .012, 1000) + gaussian(x, .035, .014, -250);
      microvolts.push(qrs(t) + qrs(upcoming) + gaussian(upcoming, -.16, .035, 100) + gaussian(t, .24, .06, 240) + 12 * Math.sin(at / 700));
      lastSampleAt = at; this.nextSampleAt += 1000 / 130;
    }
    return { microvolts, beats, sensorTimestampNs: BigInt(Math.round(lastSampleAt * 1_000_000)) };
  }
}
