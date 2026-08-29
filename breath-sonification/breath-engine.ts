import {
  DEFAULT_BREATH_TIMING,
  normalizeBreathTiming,
  type BreathPhase,
  type BreathTiming,
} from "./breath-model";

export interface BreathTimbre {
  intensity01: number;
  brightness01: number;
  naturalness01: number;
}

export interface BreathObservation {
  volume01: number;
  flow01?: number;
  phase?: "inhale" | "exhale" | "hold" | -1 | 0 | 1;
  confidence01?: number;
  ready?: boolean;
  timestampMs?: number;
}

export interface SonifierFrame {
  phase: BreathPhase;
  phase01: number;
  volume01: number;
  flow01: number;
  openness01: number;
  source: "cycle" | "physiology";
  breathNumber: number;
}

type FrameListener = (frame: SonifierFrame) => void;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const DEFAULT_TIMBRE: BreathTimbre = {
  intensity01: 0.68,
  brightness01: 0.56,
  naturalness01: 0.72,
};

function normalizeTimbre(value: Partial<BreathTimbre>): BreathTimbre {
  return {
    intensity01: clamp01(value.intensity01 ?? DEFAULT_TIMBRE.intensity01),
    brightness01: clamp01(value.brightness01 ?? DEFAULT_TIMBRE.brightness01),
    naturalness01: clamp01(
      value.naturalness01 ?? DEFAULT_TIMBRE.naturalness01,
    ),
  };
}

function phaseName(value: BreathObservation["phase"], derivative: number) {
  if (value === "inhale" || value === 1) return "inhale";
  if (value === "exhale" || value === -1) return "exhale";
  if (value === "hold" || value === 0) return "hold";
  if (derivative > 0.015) return "inhale";
  if (derivative < -0.015) return "exhale";
  return "hold";
}

export class BreathSonifier {
  private context?: AudioContext;
  private node?: AudioWorkletNode;
  private output?: GainNode;
  private timing: BreathTiming = { ...DEFAULT_BREATH_TIMING };
  private timbre: BreathTimbre = { ...DEFAULT_TIMBRE };
  private master01 = 0.72;
  private active = false;
  private physiologyLocked = false;
  private listeners = new Set<FrameListener>();
  private lastObservation?: { volume01: number; timestampMs: number };
  private flowPeak = 0.08;

  async initialize(): Promise<void> {
    if (this.context) return;
    if (!("AudioContext" in window) || !("AudioWorkletNode" in window)) {
      throw new Error("This browser does not support Web Audio AudioWorklets.");
    }

    const context = new AudioContext({ latencyHint: "interactive" });
    await context.audioWorklet.addModule(
      new URL("./breath-processor.js", import.meta.url),
    );
    const node = new AudioWorkletNode(context, "ecgaming-breath-generator", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.knee.value = 10;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.12;
    const output = context.createGain();
    output.gain.value = this.master01;
    node.connect(compressor).connect(output).connect(context.destination);
    node.port.onmessage = (event: MessageEvent<SonifierFrame>) => {
      for (const listener of this.listeners) listener(event.data);
    };

    this.context = context;
    this.node = node;
    this.output = output;
    this.post({ type: "timing", value: this.timing });
    this.post({ type: "timbre", value: this.timbre });
    this.post({ type: "active", value: this.active });
    this.post({ type: "physiology-lock", value: this.physiologyLocked });
  }

  async start(): Promise<void> {
    await this.initialize();
    if (this.context?.state === "suspended") await this.context.resume();
    this.active = true;
    this.post({ type: "active", value: true });
  }

  stop(): void {
    this.active = false;
    this.post({ type: "active", value: false });
  }

  setTiming(value: Partial<BreathTiming>): BreathTiming {
    this.timing = normalizeBreathTiming({ ...this.timing, ...value });
    this.post({ type: "timing", value: this.timing });
    return { ...this.timing };
  }

  setTimbre(value: Partial<BreathTimbre>): BreathTimbre {
    this.timbre = normalizeTimbre({ ...this.timbre, ...value });
    this.post({ type: "timbre", value: this.timbre });
    return { ...this.timbre };
  }

  setMaster(value01: number): void {
    this.master01 = clamp01(value01);
    if (!this.context || !this.output) return;
    const now = this.context.currentTime;
    this.output.gain.cancelScheduledValues(now);
    this.output.gain.setTargetAtTime(this.master01, now, 0.025);
  }

  setPhysiologyLock(locked: boolean): void {
    this.physiologyLocked = locked;
    this.post({ type: "physiology-lock", value: locked });
  }

  pushPhysiology(observation: BreathObservation): void {
    const timestampMs = observation.timestampMs ?? performance.now();
    const volume01 = clamp01(observation.volume01);
    const elapsedSeconds = this.lastObservation
      ? Math.max(0.001, (timestampMs - this.lastObservation.timestampMs) / 1000)
      : 1 / 30;
    const derivative = this.lastObservation
      ? (volume01 - this.lastObservation.volume01) / elapsedSeconds
      : 0;
    this.flowPeak = Math.max(
      0.08,
      Math.abs(derivative),
      this.flowPeak * Math.exp(-elapsedSeconds / 6),
    );
    const derivedFlow = clamp01(Math.abs(derivative) / this.flowPeak);
    const confidence01 = clamp01(observation.confidence01 ?? 1);
    this.lastObservation = { volume01, timestampMs };
    this.post({
      type: "physiology",
      value: {
        volume01,
        flow01: clamp01(observation.flow01 ?? derivedFlow),
        phase: phaseName(observation.phase, derivative),
        confidence01,
        ready: observation.ready ?? confidence01 > 0.45,
      },
    });
  }

  releasePhysiology(): void {
    this.lastObservation = undefined;
    this.post({ type: "release-physiology" });
  }

  onFrame(listener: FrameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async destroy(): Promise<void> {
    this.node?.disconnect();
    await this.context?.close();
    this.node = undefined;
    this.output = undefined;
    this.context = undefined;
    this.listeners.clear();
  }

  private post(message: unknown): void {
    this.node?.port.postMessage(message);
  }
}
