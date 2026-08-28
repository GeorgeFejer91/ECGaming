import { PolarMetricProcessor } from "./polar-stream.js";

export const POLAR_REPLAY_SAMPLE_RATE_HZ = 130;
export const POLAR_REPLAY_QUERY = "mock-polar";

function gaussian(value, center, width) {
  const distance = Math.min(
    Math.abs(value - center),
    1 - Math.abs(value - center),
  );
  return Math.exp(-0.5 * (distance / width) ** 2);
}

export function syntheticEcgMicrovolts(phase, elapsedSeconds) {
  const baseline = 55 * Math.sin(elapsedSeconds * Math.PI * 2 * 0.28);
  const deterministicNoise =
    11 * Math.sin(elapsedSeconds * Math.PI * 2 * 17.3) +
    7 * Math.sin(elapsedSeconds * Math.PI * 2 * 31.7);
  const pWave = 90 * gaussian(phase, 0.18, 0.028);
  const qWave = -160 * gaussian(phase, 0.385, 0.012);
  const rWave = 1_150 * gaussian(phase, 0.405, 0.01);
  const sWave = -280 * gaussian(phase, 0.435, 0.016);
  const tWave = 260 * gaussian(phase, 0.68, 0.065);
  return Math.round(
    baseline + deterministicNoise + pWave + qWave + rWave + sWave + tWave,
  );
}

export class PolarH10ReplaySession {
  constructor({
    timer = globalThis,
    now = () => globalThis.performance?.now?.() ?? Date.now(),
    sampleRateHz = POLAR_REPLAY_SAMPLE_RATE_HZ,
    tickMs = 20,
  } = {}) {
    this.timer = timer;
    this.now = now;
    this.sampleRateHz = sampleRateHz;
    this.tickMs = tickMs;
    this.processor = new PolarMetricProcessor();
    this.connected = false;
    this.intervalId = undefined;
    this.onEvent = undefined;
    this.generatedSamples = 0;
    this.phase = 0;
    this.startedAtMs = 0;
    this.lastTickAtMs = 0;
    this.maximumGapMs = 0;
    this.lastHeartRateSecond = -1;
  }

  diagnosticSnapshot() {
    return {
      mock: true,
      secureContext: true,
      apiAvailable: true,
      adapterAvailability: "not-used",
      userActivationAtRequest: this.connected ? true : "unknown",
      chooser: "not used",
      stage: this.connected ? "live" : "idle",
      gattAttempt: 0,
      gattAttemptsTotal: 0,
      pmdResponse: "synthetic fixture",
      firstEcgFrame: this.generatedSamples > 0,
      lastErrorCode: "",
      lastErrorMessage: "",
    };
  }

  async connect(onEvent) {
    if (this.connected)
      throw new Error(
        "Stop the current synthetic ECG replay before starting another.",
      );
    this.onEvent = onEvent;
    this.processor.reset();
    this.generatedSamples = 0;
    this.phase = 0;
    this.startedAtMs = this.now();
    this.lastTickAtMs = this.startedAtMs;
    this.maximumGapMs = 0;
    this.lastHeartRateSecond = -1;
    this.connected = true;
    this.emit({
      kind: "status",
      message: "Starting deterministic 130 Hz synthetic ECG replay…",
    });
    this.emit({
      kind: "connection",
      connected: true,
      batteryPercent: 100,
      mock: true,
      streamHealth: this.streamHealth(),
      message: "Synthetic Polar replay is live at 130 Hz",
    });
    this.tick({ ensureSample: true });
    this.emit({
      kind: "diagnostic",
      snapshot: this.diagnosticSnapshot(),
      mock: true,
    });
    this.intervalId = this.timer.setInterval(() => this.tick(), this.tickMs);
  }

  tick({ ensureSample = false } = {}) {
    if (!this.connected) return;
    const nowMs = this.now();
    this.maximumGapMs = Math.max(this.maximumGapMs, nowMs - this.lastTickAtMs);
    this.lastTickAtMs = nowMs;
    const elapsedMs = Math.max(0, nowMs - this.startedAtMs);
    const targetSamples = Math.max(
      ensureSample ? this.generatedSamples + 1 : this.generatedSamples,
      Math.floor((elapsedMs * this.sampleRateHz) / 1_000),
    );
    const sampleCount = Math.min(
      this.sampleRateHz * 2,
      targetSamples - this.generatedSamples,
    );
    if (sampleCount <= 0) return;
    const microvolts = [];
    for (let offset = 0; offset < sampleCount; offset += 1) {
      const sampleIndex = this.generatedSamples + offset;
      const elapsedSeconds = sampleIndex / this.sampleRateHz;
      const heartRate =
        76 +
        14 * Math.sin((elapsedSeconds * Math.PI * 2) / 24) +
        4 * Math.sin((elapsedSeconds * Math.PI * 2) / 5);
      this.phase = (this.phase + heartRate / 60 / this.sampleRateHz) % 1;
      microvolts.push(syntheticEcgMicrovolts(this.phase, elapsedSeconds));
    }
    this.generatedSamples += sampleCount;
    const snapshot = this.processor.pushEcg(microvolts);
    const streamHealth = this.streamHealth();
    this.emit({
      kind: "ecg",
      sensorTimestampNs: String(
        Math.round((this.generatedSamples * 1_000_000_000) / this.sampleRateHz),
      ),
      microvolts,
      snapshot,
      streamHealth,
      mock: true,
    });
    this.emit({ kind: "metrics", snapshot, mock: true });

    const wholeSecond = Math.floor(elapsedMs / 1_000);
    if (wholeSecond !== this.lastHeartRateSecond) {
      this.lastHeartRateSecond = wholeSecond;
      const elapsedSeconds = this.generatedSamples / this.sampleRateHz;
      const beatsPerMinute = Math.round(
        76 +
          14 * Math.sin((elapsedSeconds * Math.PI * 2) / 24) +
          4 * Math.sin((elapsedSeconds * Math.PI * 2) / 5),
      );
      const rrIntervalsMs = [60_000 / beatsPerMinute];
      this.emit({
        kind: "metrics",
        snapshot: this.processor.pushHeartRate({
          beatsPerMinute,
          rrIntervalsMs,
        }),
        mock: true,
      });
    }
  }

  streamHealth() {
    const elapsedMs = Math.max(0, this.lastTickAtMs - this.startedAtMs);
    return {
      frameCount: Math.ceil(elapsedMs / this.tickMs),
      sampleCount: this.generatedSamples,
      observedSampleRateHz:
        elapsedMs > 0
          ? (this.generatedSamples * 1_000) / elapsedMs
          : this.sampleRateHz,
      maximumGapMs: this.maximumGapMs,
      elapsedMs,
      mock: true,
    };
  }

  async disconnect({ emit = true } = {}) {
    const wasConnected = this.connected;
    this.connected = false;
    if (this.intervalId !== undefined)
      this.timer.clearInterval(this.intervalId);
    this.intervalId = undefined;
    if (emit && (wasConnected || this.onEvent)) {
      this.emit({
        kind: "connection",
        connected: false,
        mock: true,
        message: "Synthetic Polar replay stopped",
      });
      this.emit({
        kind: "diagnostic",
        snapshot: this.diagnosticSnapshot(),
        mock: true,
      });
    }
    if (emit) this.onEvent = undefined;
  }

  emit(event) {
    if (typeof this.onEvent === "function") this.onEvent(event);
  }
}

export function createPolarH10ReplaySession(options) {
  return new PolarH10ReplaySession(options);
}

export function polarReplayEnabled(locationObject = globalThis.location) {
  try {
    return (
      new URL(locationObject.href).searchParams.get(POLAR_REPLAY_QUERY) === "1"
    );
  } catch {
    return false;
  }
}
