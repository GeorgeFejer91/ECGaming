import { PhoneBreathProcessor, type BreathSnapshot } from "./breathe-processor";
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

function renderTelemetry(snapshot: BreathSnapshot): void {
  telVolume.textContent = snapshot.volume01.toFixed(2);
  telPhase.textContent = phaseLabels[snapshot.phase] ?? "hold";
  telDerivative.textContent = snapshot.derivativePerSecond.toFixed(3);
  telCalibration.textContent = `${Math.round(snapshot.calibration01 * 100)}%`;
  telConfidence.textContent = `${Math.round(snapshot.confidence01 * 100)}%`;
  telMotion.textContent = !sensing
    ? "idle"
    : snapshot.ready
      ? "live"
      : snapshot.calibrated
        ? "low signal"
        : "calibrating";
}

function handleMotion(event: DeviceMotionEvent): void {
  const acc = event.accelerationIncludingGravity;
  if (!acc || acc.x === null || acc.y === null || acc.z === null) return;
  const snapshot = processor.pushSample(
    { x: acc.x, y: acc.y, z: acc.z },
    performance.now(),
  );
  targetVolume = snapshot.volume01;
  const label = phaseLabels[snapshot.phase] ?? "hold";
  phaseText.textContent = label;
  document.body.dataset.phase = label;
  sourceText.textContent = snapshot.ready
    ? "phone acc · live"
    : snapshot.calibrated
      ? "phone acc · low signal"
      : `calibrating · ${Math.round(snapshot.calibration01 * 100)}%`;
  sourceText.dataset.source = snapshot.ready ? "phone" : "calibrating";
  renderTelemetry(snapshot);
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
  processor.reset();
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
  startButton.textContent = "Start sensing";
  startButton.setAttribute("aria-pressed", "false");
  statusText.textContent = "Sensor stopped. Tap to restart.";
  phaseText.textContent = "hold";
  sourceText.textContent = "waiting for sensor";
  sourceText.dataset.source = "idle";
  renderTelemetry(processor.snapshot(performance.now()));
}

startButton.addEventListener("click", () => {
  if (sensing) stopSensing();
  else void startSensing();
});

renderTelemetry(processor.snapshot(performance.now()));
animFrame = requestAnimationFrame(animate);

window.addEventListener("pagehide", () => {
  cancelAnimationFrame(animFrame);
  stopSensing();
});