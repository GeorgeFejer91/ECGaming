import "./styles.css";
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

class PhoneBreathLock {
  private latest?: BreathFrame;
  private calibrationData: number[] = [];
  private calibrated = false;
  private baseline = 0;
  private minZ = Infinity;
  private maxZ = -Infinity;
  private readonly calibrationSamples = 240;
  private readonly staleAfterMs = 800;
  private readonly fullFlowPerSecond = 0.5;
  private lastTimestamp = 0;
  private lastFilteredZ = 0;

  constructor(
    private readonly smoothing = 0.15,
    private readonly sensitivity = 1.0
  ) {}

  setSmoothing(value: number) {
    this.smoothing = clamp01(value);
  }

  setSensitivity(value: number) {
    this.sensitivity = Math.max(0.1, Math.min(5, value));
  }

  startCalibration() {
    this.calibrationData = [];
    this.calibrated = false;
    this.baseline = 0;
    this.minZ = Infinity;
    this.maxZ = -Infinity;
  }

  private updateCalibration(z: number) {
    this.calibrationData.push(z);
    this.minZ = Math.min(this.minZ, z);
    this.maxZ = Math.max(this.maxZ, z);

    if (this.calibrationData.length >= this.calibrationSamples) {
      this.baseline = this.calibrationData.reduce((a, b) => a + b, 0) / this.calibrationData.length;
      this.calibrated = true;
    }
  }

  accept(reading: AccelerometerReading): BreathFrame {
    const now = reading.timestamp;
    const rawZ = reading.z * this.sensitivity;

    if (!this.calibrated) {
      this.updateCalibration(rawZ);
    }

    const dt = Math.max(1, Math.min(100, now - this.lastTimestamp)) / 1000;
    this.lastTimestamp = now;

    const filteredZ = this.lastFilteredZ + (rawZ - this.lastFilteredZ) * this.smoothing;
    this.lastFilteredZ = filteredZ;

    const centeredZ = this.calibrated ? filteredZ - this.baseline : 0;
    const derivative = (centeredZ - (this.latest ? 0 : centeredZ)) / Math.max(0.001, dt);

    const range = this.maxZ - this.minZ;
    const normalizedVolume = this.calibrated && range > 0.1
      ? clamp01((filteredZ - this.minZ) / range)
      : 0.5;

    const flow01 = clamp01(
      Math.abs(derivative) / Math.max(0.001, this.fullFlowPerSecond)
    );

    const phaseVal = phaseValue(derivative);
    const phase = phaseName(this.calibrated ? phaseVal : 0);

    const confidence01 = this.calibrated
      ? clamp01(Math.min(1, this.calibrationData.length / this.calibrationSamples))
      : 0;

    const frame: BreathFrame = {
      phase,
      phaseValue: this.calibrated ? phaseVal : 0,
      volume01: normalizedVolume,
      flow01,
      confidence01,
      ready: this.calibrated,
      timestamp: now,
    };

    this.latest = frame;
    return { ...frame };
  }

  read(now: number): BreathFrame | undefined {
    if (!this.latest) return undefined;
    if (now - this.latest.timestamp <= this.staleAfterMs) return { ...this.latest };
    return {
      ...this.latest,
      confidence01: 0,
      flow01: 0,
      phase: "hold",
      phaseValue: 0,
      ready: false,
    };
  }

  reset() {
    this.latest = undefined;
    this.calibrationData = [];
    this.calibrated = false;
    this.baseline = 0;
    this.minZ = Infinity;
    this.maxZ = -Infinity;
    this.lastTimestamp = 0;
    this.lastFilteredZ = 0;
  }

  getCalibrationProgress(): number {
    return clamp01(this.calibrationData.length / this.calibrationSamples);
  }

  isCalibrated(): boolean {
    return this.calibrated;
  }

  getBaseline(): number {
    return this.baseline;
  }

  getRange(): { min: number; max: number } {
    return { min: this.minZ, max: this.maxZ };
  }
}

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

    if (frame.flow01 > 0.1) {
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

class SimulatedBreath {
  private running = false;
  private startTime = 0;
  private rate = 6;

  setRate(bpm: number) {
    this.rate = Math.max(3, Math.min(20, bpm));
  }

  start() {
    this.running = true;
    this.startTime = performance.now();
  }

  stop() {
    this.running = false;
  }

  getReading(): AccelerometerReading | null {
    if (!this.running) return null;
    const elapsed = (performance.now() - this.startTime) / 1000;
    const cycle = (elapsed * this.rate / 60) % 1;
    const z = Math.sin(cycle * Math.PI * 2) * 0.5;
    return { x: 0, y: 0, z, timestamp: performance.now() };
  }
}

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id)! as T;

const breathLock = new PhoneBreathLock();
const visualizer = new BreathVisualizer();
const simulated = new SimulatedBreath();

let sensorActive = false;
let motionPermissionGranted = false;
let lastReading: AccelerometerReading | null = null;
let simulateMode = false;
let remoteActive = false;
const phaseValueMap: Record<number, -1 | 0 | 1> = { "-1": -1, 0: 0, 1: 1 };

const minRadiusInput = byId<HTMLInputElement>("min-radius");
const maxRadiusInput = byId<HTMLInputElement>("max-radius");
const smoothingInput = byId<HTMLInputElement>("smoothing");
const sensitivityInput = byId<HTMLInputElement>("sensitivity");
const calibrateBtn = byId<HTMLButtonElement>("calibrate-btn");
const simulateCheckbox = byId<HTMLInputElement>("simulate");
const simRateInput = byId<HTMLInputElement>("sim-rate");
const logEnabledCheckbox = byId<HTMLInputElement>("log-enabled");
const logExportBtn = byId<HTMLButtonElement>("log-export");
const fullscreenBtn = byId<HTMLButtonElement>("fullscreen-btn");

const minRadiusOutput = byId("min-radius-output");
const maxRadiusOutput = byId("max-radius-output");
const smoothingOutput = byId("smoothing-output");
const sensitivityOutput = byId("sensitivity-output");
const simRateOutput = byId("sim-rate-output");

function updateOutputs() {
  minRadiusOutput.textContent = minRadiusInput.value;
  maxRadiusOutput.textContent = maxRadiusInput.value;
  smoothingOutput.textContent = Number(smoothingInput.value).toFixed(2);
  sensitivityOutput.textContent = Number(sensitivityInput.value).toFixed(1);
  simRateOutput.textContent = `${simRateInput.value} BPM`;
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
  breathLock.setSmoothing(Number(smoothingInput.value));
});
sensitivityInput.addEventListener("input", () => {
  updateOutputs();
  breathLock.setSensitivity(Number(sensitivityInput.value));
});

calibrateBtn.addEventListener("click", () => {
  breathLock.startCalibration();
  visualizer.statusText.textContent = "Calibrating… breathe normally";
  visualizer.statusHint.textContent = "Keep phone still on belly for ~2 seconds";
  visualizer.statusDot.dataset.state = "calibrating";
});

simulateCheckbox.addEventListener("change", () => {
  simulateMode = simulateCheckbox.checked;
  if (simulateMode) {
    simulated.setRate(Number(simRateInput.value));
    simulated.start();
    sensorActive = true;
    visualizer.statusDot.dataset.state = "live";
    visualizer.statusText.textContent = "Simulated breathing active";
    visualizer.statusHint.textContent = "Adjust rate slider to change breathing speed";
  } else {
    simulated.stop();
    sensorActive = false;
    visualizer.statusDot.dataset.state = "waiting";
    visualizer.statusText.textContent = "Requesting motion access…";
    visualizer.statusHint.textContent = "Hold phone against your belly, screen facing up";
    requestMotionPermission();
  }
});

simRateInput.addEventListener("input", () => {
  updateOutputs();
  simulated.setRate(Number(simRateInput.value));
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
        visualizer.statusHint.textContent = "Enable in browser settings or use Simulate mode";
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
  window.addEventListener("devicemotion", handleMotion, { passive: true });
  visualizer.statusText.textContent = "Motion sensor active";
  visualizer.statusHint.textContent = "Place phone on belly, screen facing up";
  visualizer.statusDot.dataset.state = "calibrating";
  breathLock.startCalibration();
}

function handleMotion(event: DeviceMotionEvent) {
  if (simulateMode || remoteActive) return;
  const accel = event.accelerationIncludingGravity;
  if (!accel) return;

  const reading: AccelerometerReading = {
    x: finite(accel.x),
    y: finite(accel.y),
    z: finite(accel.z),
    timestamp: performance.now(),
  };
  lastReading = reading;
  processReading(reading);
}

function processReading(reading: AccelerometerReading) {
  const frame = breathLock.accept(reading);
  const filteredZ = breathLock["lastFilteredZ"];
  const derivative = frame.volume01 > 0.5
    ? (reading.z * breathLock["sensitivity"] - breathLock["baseline"]) * 10
    : -(reading.z * breathLock["sensitivity"] - breathLock["baseline"]) * 10;

  visualizer.update(frame, reading.z, filteredZ, derivative);
}

function simulationLoop() {
  if (simulateMode) {
    const reading = simulated.getReading();
    if (reading) processReading(reading);
  }
  requestAnimationFrame(simulationLoop);
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
        simulateMode = false;
        simulateCheckbox.checked = false;
      } else if (!active && !simulateMode) {
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
simulationLoop();
updateOutputs();
visualizer.setRadiusRange(Number(minRadiusInput.value), Number(maxRadiusInput.value));

if (!simulateMode) {
  requestMotionPermission();
}

window.addEventListener("pagehide", () => {
  visualizer.stop();
  window.removeEventListener("devicemotion", handleMotion);
});