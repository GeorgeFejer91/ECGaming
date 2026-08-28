export class FlightSound {
  private context?: AudioContext;
  private muted = false;
  async unlock() {
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === "suspended") await this.context.resume();
  }
  setMuted(value: boolean) {
    this.muted = value;
  }
  beat() {
    if (!this.context || this.muted) return;
    const at = this.context.currentTime,
      osc = this.context.createOscillator(),
      gain = this.context.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(84, at);
    osc.frequency.exponentialRampToValueAtTime(48, at + 0.12);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.18, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
    osc.connect(gain).connect(this.context.destination);
    osc.start(at);
    osc.stop(at + 0.2);
  }
  ring(success = true) {
    if (!this.context || this.muted) return;
    const at = this.context.currentTime,
      osc = this.context.createOscillator(),
      gain = this.context.createGain();
    osc.type = success ? "triangle" : "sawtooth";
    osc.frequency.setValueAtTime(success ? 520 : 140, at);
    osc.frequency.exponentialRampToValueAtTime(success ? 880 : 72, at + 0.2);
    gain.gain.setValueAtTime(0.12, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.24);
    osc.connect(gain).connect(this.context.destination);
    osc.start();
    osc.stop(at + 0.25);
  }
}
