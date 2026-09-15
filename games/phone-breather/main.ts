import "./styles.css";
import { BreathAnalyzer, type BreathAnalysisFrame } from "../../src/breath";
import { BreathPairHost } from "../../src/phone-breather/host";
import type { BreathState } from "../../src/phone-breather/link";

type BreathPhase = "inhale" | "exhale" | "hold";

interface BreathFrame {
  phase: BreathPhase;
  phaseValue: -1 | 0 | 1;
  volume01: number;
  flow01: number;
  confidence01: number;
  ready: boolean;
  timestamp: number;
  bpm?: number;
}

interface AccelerometerReading {
  x: number;
  y: number;
  z: number;
  timestamp: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const finite = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const phaseValue = (value: number): -1 | 0 | 1 =>
  value > 0 ? 1 : value < 0 ? -1 : 0;

const phaseName = (value: -1 | 0 | 1): BreathPhase =>
  value > 0 ? "inhale" : value < 0 ? "exhale" : "hold";

class BreathVisualizer {
  private breathCircle!: SVGCircleElement;
  private breathRingOuter!: SVGCircleElement;
  private breathRingInner!: SVGCircleElement;
  private breathCenter!: SVGCircleElement;
  private phaseLabel!: HTMLElement;
  private bpmLabel!: HTMLElement;
  private statusDot!: HTMLElement;
  private statusText!: HTMLElement;
  private statusHint!: HTMLElement;
  private waveformCanvas!: HTMLCanvasElement;
  private waveformCtx!: CanvasRenderingContext2D;
  private waveformBuffer: number[] = [];
  private readonly waveformMaxLen = 300;

  private minRadius = 40;
  private maxRadius = 180;
  private currentRadius = 120;
  private targetRadius = 120;
  private animationFrame = 0;

  private metricZ!: HTMLElement;
  private metricFiltered!: HTMLElement;
  private metricDerivative!: HTMLElement;
  private metricVolume!: HTMLElement;
  private metricPhase!: HTMLElement;
  private metricConfidence!: HTMLElement;

  private logEnabled = false;
  private logData: Array<{ t: number; z: number; filtered: number; deriv: number; vol: number; phase: string }> = [];

  constructor() {
    this.breathCircle = document.getElementById("breath-circle") as SVGCircleElement;
    this.breathRingOuter = document.getElementById("breath-ring-outer") as SVGCircleElement;
    this.breathRingInner = document.getElementById("breath-ring-inner") as SVGCircleElement;
    this.breathCenter = document.getElementById("breath-center") as SVGCircleElement;
    this.phaseLabel = document.getElementById("phase-label")!;
    this.bpmLabel = document.getElementById("bpm-label")!;
    this.statusDot = document.getElementById("status-dot")!;
    this.statusText = document.getElementById("status-text")!;
    this.statusHint = document.getElementById("status-hint")!;
    this.waveformCanvas = document.getElementById("waveform") as HTMLCanvasElement;
    this.waveformCtx = this.waveformCanvas.getContext("2d")!;

    this.metricZ = document.getElementById("metric-z")!;
    this.metricFiltered = document.getElementById("metric-filtered")!;
    this.metricDerivative = document.getElementById("metric-derivative")!;
    this.metricVolume = document.getElementById("metric-volume")!;
    this.metricPhase = document.getElementById("metric-phase")!;
    this.metricConfidence = document.getElementById("metric-confidence")!;

    this.resizeWaveform();
    window.addEventListener("resize", () => this.resizeWaveform());
  }

  private resizeWaveform() {
    const rect = this.waveformCanvas.parentElement!.getBoundingClientRect();
    this.waveformCanvas.width = Math.floor(rect.width * devicePixelRatio);
    this.waveformCanvas.height = 120 * devicePixelRatio;
    this.waveformCtx.scale(devicePixelRatio, devicePixelRatio);
    this.waveformCanvas.style.width = `${rect.width}px`;
    this.waveformCanvas.style.height = "120px";
  }

  setRadiusRange(min: number, max: number) {
    this.minRadius = min;
    this.maxRadius = max;
    this.currentRadius = this.lerp(this.minRadius, this.maxRadius, 0.5);
    this.targetRadius = this.currentRadius;
  }

  update(frame: BreathFrame, rawZ: number, filteredZ: number, derivative: number) {
    this.targetRadius = this.lerp(this.minRadius, this.maxRadius, frame.volume01);
    this.currentRadius += (this.targetRadius - this.currentRadius) * 0.2;

    this.breathCircle.setAttribute("r", this.currentRadius.toFixed(1));
    this.breathRingOuter.setAttribute("r", (this.currentRadius + 40).toFixed(1));
    this.breathRingInner.setAttribute("r", (this.currentRadius * 0.6).toFixed(1));

    const phaseText = frame.phase.charAt(0).toUpperCase() + frame.phase.slice(1);
    this.phaseLabel.textContent = phaseText;
    this.phaseLabel.dataset.phase = frame.phase;

    if (Number.isFinite(frame.bpm) && frame.bpm > 0) {
      this.bpmLabel.textContent = `${Math.round(frame.bpm)} BPM`;
    } else if (frame.flow01 > 0.1) {
      const cycleEstimate = 60 / (frame.flow01 * 10 + 2);
      this.bpmLabel.textContent = `${Math.round(cycleEstimate)} BPM`;
    }

    this.statusDot.dataset.state = frame.ready ? "live" : frame.confidence01 > 0.3 ? "calibrating" : "waiting";
    this.statusText.textContent = frame.ready
      ? `Breathing detected · ${phaseText}`
      : frame.confidence01 > 0.3
        ? `Calibrating… ${Math.round(frame.confidence01 * 100)}%`
        : "Waiting for motion data";
    this.statusHint.textContent = frame.ready
      ? "Breathe naturally — circle follows your belly"
      : "Hold phone against belly, screen facing up";

    this.metricZ.textContent = rawZ.toFixed(3);
    this.metricFiltered.textContent = filteredZ.toFixed(3);
    this.metricDerivative.textContent = derivative.toFixed(3);
    this.metricVolume.textContent = frame.volume01.toFixed(3);
    this.metricPhase.textContent = frame.phase;
    this.metricConfidence.textContent = `${Math.round(frame.confidence01 * 100)}%`;

    this.waveformBuffer.push(frame.volume01);
    if (this.waveformBuffer.length > this.waveformMaxLen) this.waveformBuffer.shift();
    this.drawWaveform();

    if (this.logEnabled) {
      this.logData.push({
        t: frame.timestamp,
        z: rawZ,
        filtered: filteredZ,
        deriv: derivative,
        vol: frame.volume01,
        phase: frame.phase,
      });
    }
  }

  private drawWaveform() {
    const ctx = this.waveformCtx;
    const w = this.waveformCanvas.width / devicePixelRatio;
    const h = this.waveformCanvas.height / devicePixelRatio;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = "#14b8a6";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    for (let i = 0; i < this.waveformBuffer.length; i++) {
      const x = (i / this.waveformMaxLen) * w;
      const y = h - this.waveformBuffer[i] * h * 0.8 - h * 0.1;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
  }

  setLogEnabled(enabled: boolean) {
    this.logEnabled = enabled;
    if (!enabled) this.logData = [];
  }

  exportCSV(): string {
    const header = "timestamp,rawZ,filteredZ,derivative,volume01,phase\n";
    const rows = this.logData.map(d => `${d.t},${d.z},${d.filtered},${d.deriv},${d.vol},${d.phase}`).join("\n");
    return header + rows;
  }

  animate() {
    this.animationFrame = requestAnimationFrame(() => this.animate());
  }

  stop() {
    cancelAnimationFrame(this.animationFrame);
  }
}

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id)! as T;

const breath = new BreathAnalyzer();
const visualizer = new BreathVisualizer();

let sensorActive = false;
let motionPermissionGranted = false;
let remoteActive = false;
let gain = 1;
let lastRawZ = 0;
let lastProjection = 0;
let lastFrame: BreathFrame | null = null;
const phaseValueMap: Record<number, -1 | 0 | 1> = { "-1": -1, 0: 0, 1: 1 };

const minRadiusInput = byId<HTMLInputElement>("min-radius");
const maxRadiusInput = byId<HTMLInputElement>("max-radius");
const smoothingInput = byId<HTMLInputElement>("smoothing");
const sensitivityInput = byId<HTMLInputElement>("sensitivity");
const calibrateBtn = byId<HTMLButtonElement>("calibrate-btn");
const logEnabledCheckbox = byId<HTMLInputElement>("log-enabled");
const logExportBtn = byId<HTMLButtonElement>("log-export");
const fullscreenBtn = byId<HTMLButtonElement>("fullscreen-btn");

const minRadiusOutput = byId("min-radius-output");
const maxRadiusOutput = byId("max-radius-output");
const smoothingOutput = byId("smoothing-output");
const sensitivityOutput = byId("sensitivity-output");

function updateOutputs() {
  minRadiusOutput.textContent = minRadiusInput.value;
  maxRadiusOutput.textContent = maxRadiusInput.value;
  smoothingOutput.textContent = Number(smoothingInput.value).toFixed(2);
  sensitivityOutput.textContent = Number(sensitivityInput.value).toFixed(1);
}

function applyTuning() {
  breath.settings.signalTauMs = Number(smoothingInput.value) * 1200;
  gain = Number(sensitivityInput.value);
}

function frameFromSnapshot(snapshot: BreathAnalysisFrame, timeMs: number): BreathFrame {
  return {
    phase: phaseName(snapshot.phase),
    phaseValue: snapshot.phase,
    volume01: snapshot.volume01,
    flow01: snapshot.derivativePerSecond,
    confidence01: snapshot.calibrated ? snapshot.confidence01 : snapshot.calibration01,
    ready: snapshot.ready,
    timestamp: timeMs,
    bpm: snapshot.bpm || undefined,
  };
}

function processReading(reading: AccelerometerReading) {
  const analysis = breath.ingest(
    {
      x: reading.x * gain,
      y: reading.y * gain,
      z: reading.z * gain,
      timeMs: reading.timestamp,
    },
  );
  lastRawZ = reading.z;
  lastProjection = analysis.values.acc_breathing_magnitude ?? 0;
  lastFrame = frameFromSnapshot(analysis, reading.timestamp);
  visualizer.update(lastFrame, reading.z, lastProjection, analysis.derivativePerSecond);
}

minRadiusInput.addEventListener("input", () => {
  updateOutputs();
  visualizer.setRadiusRange(Number(minRadiusInput.value), Number(maxRadiusInput.value));
});
maxRadiusInput.addEventListener("input", () => {
  updateOutputs();
  visualizer.setRadiusRange(Number(minRadiusInput.value), Number(maxRadiusInput.value));
});
smoothingInput.addEventListener("input", () => {
  updateOutputs();
  applyTuning();
});
sensitivityInput.addEventListener("input", () => {
  updateOutputs();
  applyTuning();
});

calibrateBtn.addEventListener("click", () => {
  breath.reset();
  visualizer.statusText.textContent = "Calibrating… breathe normally";
  visualizer.statusHint.textContent = "Keep phone on belly and breathe normally for ~2 seconds";
  visualizer.statusDot.dataset.state = "calibrating";
});

logEnabledCheckbox.addEventListener("change", () => {
  visualizer.setLogEnabled(logEnabledCheckbox.checked);
  logExportBtn.disabled = !logEnabledCheckbox.checked || visualizer["logData"].length === 0;
});

logExportBtn.addEventListener("click", () => {
  const csv = visualizer.exportCSV();
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `phone-breather-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

fullscreenBtn.addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      fullscreenBtn.textContent = "EXIT FULLSCREEN";
    } else {
      await document.exitFullscreen();
      fullscreenBtn.textContent = "FULLSCREEN";
    }
  } catch {
    // ignore
  }
});

document.addEventListener("fullscreenchange", () => {
  fullscreenBtn.textContent = document.fullscreenElement ? "EXIT FULLSCREEN" : "FULLSCREEN";
});

async function requestMotionPermission() {
  if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
    try {
      const permission = await DeviceMotionEvent.requestPermission();
      motionPermissionGranted = permission === "granted";
      if (motionPermissionGranted) {
        startMotionListener();
      } else {
        visualizer.statusText.textContent = "Motion permission denied";
        visualizer.statusHint.textContent = "Enable in browser settings";
        visualizer.statusDot.dataset.state = "error";
      }
    } catch {
      visualizer.statusText.textContent = "Motion permission error";
      visualizer.statusDot.dataset.state = "error";
    }
  } else {
    motionPermissionGranted = true;
    startMotionListener();
  }
}

function startMotionListener() {
  if (sensorActive || remoteActive) return;
  sensorActive = true;
  breath.reset();
  window.addEventListener("devicemotion", handleMotion, { passive: true });
  visualizer.statusText.textContent = "Motion sensor active";
  visualizer.statusHint.textContent = "Place phone on belly and breathe normally — calibrating (~2 s)";
  visualizer.statusDot.dataset.state = "calibrating";
}

function handleMotion(event: DeviceMotionEvent) {
  if (remoteActive) return;
  const accel = event.accelerationIncludingGravity;
  if (!accel) return;

  const reading: AccelerometerReading = {
    x: finite(accel.x),
    y: finite(accel.y),
    z: finite(accel.z),
    timestamp: performance.now(),
  };
  processReading(reading);
}

function loop() {
  if (!remoteActive && lastFrame) {
    const now = performance.now();
    if (now - lastFrame.timestamp > 900) {
      const stale: BreathFrame = {
        ...lastFrame,
        confidence01: 0,
        flow01: 0,
        phase: "hold",
        phaseValue: 0,
        ready: false,
        timestamp: now,
      };
      visualizer.update(stale, lastRawZ, lastProjection, 0);
    }
  }
  requestAnimationFrame(loop);
}

const pairHostEl = document.getElementById("breath-pair-host");
if (pairHostEl) {
  const pairHost = new BreathPairHost(pairHostEl as HTMLDivElement, {
    onState: (state: BreathState) => {
      if (!remoteActive) return;
      const frame: BreathFrame = {
        phase: phaseName(phaseValueMap[state.phase] ?? 0),
        phaseValue: phaseValueMap[state.phase] ?? 0,
        volume01: state.volume01,
        flow01: state.flow01,
        confidence01: state.confidence01,
        ready: true,
        timestamp: state.timestamp,
        bpm: state.bpm || undefined,
      };
      visualizer.update(frame, 0, 0, state.flow01);
      visualizer.statusDot.dataset.state = "live";
      visualizer.statusText.textContent = `Phone \u00B7 ${state.pilotName || "connected"}`;
      visualizer.statusHint.textContent = "Breathing streamed from your phone";
    },
    onStatus: (active, ready) => {
      remoteActive = ready;
      if (ready) {
        stopSensing();
      } else if (!active) {
        remoteActive = false;
        requestMotionPermission();
      }
    },
  });
}

function stopSensing() {
  sensorActive = false;
  window.removeEventListener("devicemotion", handleMotion);
}

visualizer.animate();
loop();
updateOutputs();
applyTuning();
visualizer.setRadiusRange(Number(minRadiusInput.value), Number(maxRadiusInput.value));

requestMotionPermission();

window.addEventListener("pagehide", () => {
  visualizer.stop();
  stopSensing();
});