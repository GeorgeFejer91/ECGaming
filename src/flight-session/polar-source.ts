import { getPolarBrowserHub, polarWebBluetoothSupport } from "../polar/browser-hub";
import { FlightFlags } from "../protocol/flight-frame";
import { CausalRPeakDetector } from "../signals/rpeak";
import { AdaptiveRangeTracker } from "../signals/adaptive-range";
import { AttackReleaseSmoother, commandValue } from "../signals/mappings";
import type { RelayState, SourceOffer, SourceStatus } from "./contract";

const commands = ["altitude", "throttle", "traffic"] as const;
const age = (now: number, at: number) => Math.max(0, Math.min(999_999, now - at));

/** Raw ECG and all derived metrics remain inside this source instance. Only offer() crosses the network. */
export class PolarControlProcessor {
  private readonly detector = new CausalRPeakDetector(130);
  private readonly ranges = new AdaptiveRangeTracker();
  private readonly smoothers = { altitude: new AttackReleaseSmoother(), throttle: new AttackReleaseSmoother(.5), traffic: new AttackReleaseSmoother(.5) };
  private metrics: Record<string, number> = {};
  private config?: RelayState;
  private connected = false;
  private lastEcgAt = -Infinity;
  private lastAccAt = -Infinity;
  private breathingReady = false;
  private ecgReady = false;
  private rrAt = -Infinity;
  private rpeakAt = -Infinity;
  private rrCount = 0;
  private rpeakCount = 0;
  private confidence = 0;
  private sequence = 0;
  private lastFrameAt = 0;
  status: SourceStatus = "idle";
  configure(config: RelayState) {
    if (this.config?.configRevision !== config.configRevision || this.config?.sourceEpoch !== config.sourceEpoch) {
      this.ranges.startSession(`${config.sourceEpoch}:${config.configRevision}`);
      for (const command of commands) this.smoothers[command].reset(command === "altitude" ? 0 : .5);
    }
    this.config = config;
  }
  reset() {
    this.connected = this.ecgReady = this.breathingReady = false;
    this.lastEcgAt = this.lastAccAt = this.rrAt = this.rpeakAt = -Infinity;
    this.metrics = {}; this.detector.reset(); this.ranges.reset(); this.status = "idle";
  }
  handle(event: any, now: number) {
    if (event.mock === true) { this.reset(); this.status = "error"; return; }
    if (event.kind === "connection") {
      if (event.connected !== true) this.reset();
      else { this.connected = true; this.status = "warming"; }
    }
    if (event.kind === "error") { this.reset(); this.status = "error"; }
    if (!this.connected) return;
    if (event.kind === "metrics") {
      for (const [metric, value] of Object.entries(event.snapshot?.values ?? {})) {
        if (typeof value === "number" && Number.isFinite(value)) this.metrics[metric] = value;
        else delete this.metrics[metric];
      }
      // Observe each actual measurement once, never count display/transport ticks as calibration data.
      const observed = new Set<string>();
      for (const command of commands) {
        const binding = this.config?.mappings[command];
        if (!binding || binding.metric === "manual" || !binding.normalization || observed.has(binding.metric)) continue;
        this.ranges.observe(binding.metric, this.metrics[binding.metric], binding.normalization, now);
        observed.add(binding.metric);
      }
    }
    if (event.kind === "heart-rate") {
      for (const rr of event.rrIntervalsMs ?? []) {
        if (!Number.isFinite(rr) || rr < 250 || rr > 2500) continue;
        this.detector.setReferenceRr(rr); this.rrAt = now; this.rrCount++;
      }
    }
    if (event.kind === "ecg") {
      const samples = Array.from(event.microvolts ?? [], Number).filter(Number.isFinite);
      if (!samples.length) return;
      this.lastEcgAt = now;
      this.ecgReady = Number(event.streamHealth?.observedSampleRateHz ?? 130) >= 110;
      for (const beat of this.detector.pushFrame(samples, event.sensorTimestampNs)) {
        if (!this.detector.ready) continue;
        this.confidence = beat.confidence; this.rpeakAt = now; this.rpeakCount++;
      }
    }
    if (event.kind === "accelerometer") { this.lastAccAt = now; this.breathingReady = event.breathing?.ready === true; }
  }
  offer(now: number): SourceOffer | null {
    const config = this.config;
    if (!config) return null;
    const base = { configRevision: config.configRevision, sourceEpoch: config.sourceEpoch, status: this.status };
    if (!config.assignedSource || !this.connected) return { ...base, frame: null };
    const dt = Math.min(100, Math.max(0, now - this.lastFrameAt)); this.lastFrameAt = now;
    const mapping = config.mappings;
    const useRr = mapping.beatSource === "polar-rr";
    const beatAge = age(now, useRr ? this.rrAt : this.rpeakAt);
    const beatReady = mapping.beatSource === "off" || mapping.beatAction === "off" ||
      (beatAge < 3000 && (useRr || this.detector.ready));
    let ready = this.ecgReady && now - this.lastEcgAt < 500 && beatReady;
    const values = { altitude: 0, throttle: .5, traffic: .5 };
    for (const command of commands) {
      const binding = mapping[command];
      const target = command === "altitude" && mapping.beatAction === "lift"
        ? (beatReady ? (beatAge < 420 ? 1 - beatAge / 420 : -.18) : undefined)
        : binding.metric === "breathing_volume" && (!this.breathingReady || now - this.lastAccAt >= 500)
          ? undefined : commandValue(command, this.metrics, mapping, this.ranges);
      if (target === undefined) ready = false;
      values[command] = this.smoothers[command].update(target ?? this.smoothers[command].value, dt, binding.attackMs, binding.releaseMs);
    }
    this.status = ready ? "live" : "warming";
    return { ...base, status: this.status, frame: { sequence: ++this.sequence, ...values,
      beatCounter: mapping.beatSource === "off" || mapping.beatAction === "off" ? 0 : useRr ? this.rrCount : this.rpeakCount,
      beatAgeMs: beatAge, quality: useRr ? .75 : this.confidence,
      flags: FlightFlags.physicalPolar | (ready ? FlightFlags.controlReady : 0) | (this.detector.ready ? FlightFlags.beatDetectorReady : 0) } };
  }
}

/** Shared UI for the phone and the cockpit; device chooser stays directly in the button gesture. */
export class PolarSourceWidget {
  readonly processor = new PolarControlProcessor();
  readonly button = document.createElement("button");
  readonly status = document.createElement("p");
  private ownsConnection = false;
  private connecting = false;
  private generation = 0;
  private config?: RelayState;
  private readonly handleEvent = (event: any) => {
    if (!this.ownsConnection) return;
    this.processor.handle(event, performance.now());
    if (event.kind === "status" || event.kind === "error") this.status.textContent = event.message;
  };
  constructor(host: HTMLElement) {
    this.button.type = "button"; this.button.textContent = "Connect Polar H10"; this.button.className = "polar-source-button"; this.button.disabled = true;
    this.status.className = "polar-source-status"; this.status.setAttribute("role", "status");
    this.status.textContent = "";
    host.append(this.button, this.status);
    this.button.addEventListener("click", () => {
      if (this.ownsConnection) { this.stop(); return; }
      const support = polarWebBluetoothSupport();
      if (!support.supported) { this.processor.status = "unsupported"; this.status.textContent = "H10 is unavailable in this browser. Connect it on another device."; return; }
      const generation = ++this.generation;
      this.processor.reset(); this.processor.status = "connecting"; this.ownsConnection = true;
      this.connecting = true; this.button.disabled = true;
      this.button.textContent = "Disconnect H10"; this.status.textContent = "Choose your worn Polar H10…";
      void getPolarBrowserHub().connect(this.handleEvent).then(() => { if (generation !== this.generation) void getPolarBrowserHub().disconnect(); }, error => {
        if (generation !== this.generation) return;
        this.ownsConnection = false; this.processor.reset(); this.processor.status = "error";
        this.button.textContent = "Connect Polar H10"; this.status.textContent = error instanceof Error ? error.message : "H10 connection failed.";
      }).finally(() => { this.connecting = false; this.button.disabled = !this.config && !this.ownsConnection; });
    });
  }
  configure(config: RelayState | null) {
    this.config = config ?? undefined; this.button.disabled = this.connecting || (!config && !this.ownsConnection);
    if (config) this.processor.configure(config);
    else if (!this.ownsConnection) this.status.textContent = "";
  }
  offer(now: number) {
    const offer = this.processor.offer(now);
    if (this.ownsConnection && this.processor.status !== "connecting" && this.processor.status !== "error") {
      const copy = !this.config?.assignedSource ? "H10 connected. Select this device in Flight settings." :
        offer?.status === "live" ? "H10 ready" : "Calibrating H10…";
      if (this.status.textContent !== copy) this.status.textContent = copy;
    }
    return offer;
  }
  stop() {
    ++this.generation;
    if (this.ownsConnection) void getPolarBrowserHub().disconnect();
    this.ownsConnection = false; this.processor.reset(); this.button.textContent = "Connect Polar H10";
    this.status.textContent = "H10 disconnected.";
  }
}
