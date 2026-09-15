import { PhoneBreathProcessor, type BreathSnapshot } from "./breathe-processor";
import { BreathPairHost } from "./host";
import type { BreathState } from "./link";
import "./styles.css";

const byId = <T extends Element>(id: string) =>
  document.getElementById(id) as unknown as T;

const startButton = byId<HTMLButtonElement>("start-sensor");
const statusText = byId("sensor-status");
const phaseText = byId("phase-text");
const sourceText = byId<HTMLElement>("source-text");
const breathCircle = byId<SVGCircleElement>("breath-circle");
const breathRing = byId<SVGCircleElement>("breath-ring");
const breathGlow = byId<SVGCircleElement>("breath-glow");
const breathDot = byId<SVGCircleElement>("breath-dot");
const telVolume = byId("tel-volume");
const telPhase = byId("tel-phase");
const telDerivative = byId("tel-derivative");
const telCalibration = byId("tel-calibration");
const telConfidence = byId("tel-confidence");
const telMotion = byId("tel-motion");

const MIN_RADIUS = 30;
const MAX_RADIUS = 130;

const processor = new PhoneBreathProcessor();
type SourceMode = "idle" | "local" | "remote";
let source: SourceMode = "idle";
let sensing = false;
let sensorAbort: AbortController | undefined;
let animFrame = 0;
let visualVolume = 0.5;
let targetVolume = 0.5;

const phaseLabels: Record<number, string> = { "-1": "exhale", 0: "hold", 1: "inhale" };

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function radiusForVolume(v: number) {
  return lerp(MIN_RADIUS, MAX_RADIUS, Math.max(0, Math.min(1, v)));
}

function animate() {
  visualVolume += (targetVolume - visualVolume) * 0.12;
  const r = radiusForVolume(visualVolume);
  breathCircle.setAttribute("r", r.toFixed(1));
  breathRing.setAttribute("r", (r + 12).toFixed(1));
  breathGlow.setAttribute("r", (r * 1.6).toFixed(1));
  breathGlow.setAttribute("opacity", (0.15 + visualVolume * 0.35).toFixed(2));
  breathDot.setAttribute("cx", "160");
  breathDot.setAttribute("cy", "160");
  animFrame = requestAnimationFrame(animate);
}

function renderSnapshot(snapshot: BreathSnapshot): void {
  const label = phaseLabels[snapshot.phase] ?? "hold";
  phaseText.textContent = label;
  document.body.dataset.phase = label;
  const live = snapshot.ready ? "live" : snapshot.calibrated ? "low signal" : `calibrating · ${Math.round(snapshot.calibration01 * 100)}%`;
  if (source === "remote") {
    sourceText.textContent = snapshot.ready
      ? `phone · remote · live`
      : snapshot.calibrated
        ? "phone · remote · low signal"
        : `phone · remote · ${live}`;
    sourceText.dataset.source = snapshot.ready ? "remote" : "calibrating";
  } else if (source === "local") {
    sourceText.textContent = snapshot.ready
      ? "phone acc · live"
      : `phone acc · ${live}`;
    sourceText.dataset.source = snapshot.ready ? "phone" : "calibrating";
  } else {
    sourceText.textContent = "waiting for sensor";
    sourceText.dataset.source = "idle";
  }
  telVolume.textContent = snapshot.volume01.toFixed(2);
  telPhase.textContent = phaseLabels[snapshot.phase] ?? "hold";
  telDerivative.textContent = snapshot.derivativePerSecond.toFixed(3);
  telCalibration.textContent = `${Math.round(snapshot.calibration01 * 100)}%`;
  telConfidence.textContent = `${Math.round(snapshot.confidence01 * 100)}%`;
  telMotion.textContent = source === "idle"
    ? "idle"
    : snapshot.ready
      ? "live"
      : snapshot.calibrated
        ? "low signal"
        : "calibrating";
}

function consumeSample(x: number, y: number, z: number, t: number): void {
  const snapshot = processor.pushSample({ x, y, z }, t);
  targetVolume = snapshot.volume01;
  renderSnapshot(snapshot);
}

function consumeState(state: BreathState): void {
  const snapshot: BreathSnapshot = {
    calibrated: true,
    ready: true,
    lost: false,
    phase: state.phase,
    volume01: state.volume01,
    derivativePerSecond: state.flow01,
    confidence01: state.confidence01,
    calibration01: 1,
    values: {
      acc_breathing_magnitude: state.flow01,
      breathing_volume: state.volume01,
      breathing_axis_range: 0,
      breathing_signal_ready: state.confidence01,
      breathing_signal_confidence: state.confidence01,
      breathing_calibration: 1,
      breathing_phase: state.phase,
    },
  };
  targetVolume = state.volume01;
  renderSnapshot(snapshot);
}

function handleMotion(event: DeviceMotionEvent): void {
  if (source !== "local") return;
  const acc = event.accelerationIncludingGravity;
  if (!acc || acc.x === null || acc.y === null || acc.z === null) return;
  consumeSample(acc.x, acc.y, acc.z, performance.now());
}

function stopLocalSensors(): void {
  sensing = false;
  sensorAbort?.abort();
  sensorAbort = undefined;
  startButton.textContent = "Start sensing";
  startButton.setAttribute("aria-pressed", "false");
}

async function startSensing(): Promise<void> {
  if (sensing) {
    stopSensing();
    return;
  }
  const DeviceMotionEventCtor = window.DeviceMotionEvent as typeof DeviceMotionEvent & {
    requestPermission?: () => Promise<string>;
  };
  if (typeof DeviceMotionEventCtor.requestPermission === "function") {
    try {
      const permission = await DeviceMotionEventCtor.requestPermission();
      if (permission !== "granted") {
        statusText.textContent = "Motion permission denied. Enable it in browser settings.";
        return;
      }
    } catch {
      statusText.textContent = "Motion permission request failed.";
      return;
    }
  }
  if (source === "remote") pairHost.stop();
  processor.reset();
  source = "local";
  sensing = true;
  startButton.textContent = "Stop sensing";
  startButton.setAttribute("aria-pressed", "true");
  statusText.textContent = "Breathe normally — calibrating (~10 s)…";
  sourceText.textContent = "calibrating";
  sourceText.dataset.source = "calibrating";
  sensorAbort = new AbortController();
  window.addEventListener("devicemotion", handleMotion, { signal: sensorAbort.signal });
}

function stopSensing(): void {
  sensing = false;
  sensorAbort?.abort();
  sensorAbort = undefined;
  processor.reset();
  targetVolume = 0.5;
  source = "idle";
  startButton.textContent = "Start sensing";
  startButton.setAttribute("aria-pressed", "false");
  statusText.textContent = "Sensor stopped. Tap to restart.";
  sourceText.textContent = "waiting for sensor";
  sourceText.dataset.source = "idle";
  renderSnapshot(processor.snapshot(performance.now()));
}

const pairHost = new BreathPairHost(byId("breath-pair-host"), {
  root: "..",
  onState: (state: BreathState) => {
    if (source !== "remote") return;
    consumeState(state);
  },
  onStatus: (active, ready) => {
    if (ready) {
      if (sensing) stopLocalSensors();
      processor.reset();
      source = "remote";
      statusText.textContent = "Phone connected. Breathe normally — calibrating (~10 s)…";
      sourceText.textContent = "calibrating";
      sourceText.dataset.source = "calibrating";
    } else if (!active && source === "remote") {
      processor.reset();
      targetVolume = 0.5;
      source = "idle";
      statusText.textContent = "Phone disconnected. Tap Start sensing to use this device.";
      renderSnapshot(processor.snapshot(performance.now()));
    }
  },
});

startButton.addEventListener("click", () => {
  if (sensing) stopSensing();
  else void startSensing();
});

renderSnapshot(processor.snapshot(performance.now()));
animFrame = requestAnimationFrame(animate);

window.addEventListener("pagehide", () => {
  cancelAnimationFrame(animFrame);
  pairHost.stop();
  stopSensing();
});