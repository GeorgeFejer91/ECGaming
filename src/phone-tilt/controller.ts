import "./controller.css";
import yokeUrl from "./yoke-surface.svg";
import { installPretextFit } from "../ui/pretext-fit";
import { readTiltInvitation } from "./invitation";
import { TiltLink } from "./link";
import { neutralControls, orientationAngles, SENSOR_STALE_MS, TiltCalibration, type OrientationReading, type TiltState } from "./controls";
import { PolarSourceWidget } from "../flight-session/polar-source";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const centreButton = element<HTMLButtonElement>("centre"), modeButton = element<HTMLButtonElement>("input-mode");
const disconnectButton = element<HTMLButtonElement>("disconnect");
const fullscreenButton = element<HTMLButtonElement>("fullscreen");
const connectionStatus = element("connection-status"), inputStatus = element("input-status"), pad = element("tilt-pad");
const yoke = element<HTMLImageElement>("steering-yoke"), confirmed = element("confirmed");
yoke.src = yokeUrl;
const disposeTextFit = installPretextFit();
let invitation = readTiltInvitation(location.hash);
// The fragment is bearer pairing material. Keep it out of history and all subsequent navigation.
if (location.hash) history.replaceState(null, "", location.pathname + location.search);
const link = new TiltLink("controller");
const polarSource = new PolarSourceWidget(element("yoke-polar"));
element("polar-status").append(polarSource.status);
polarSource.button.addEventListener("pointerdown", event => event.stopPropagation());
const calibration = new TiltCalibration();
let mode: "tilt" | "touch" = "tilt";
let touchStatus = "Drag to steer, or enable tilt.";
let reading: OrientationReading | undefined;
let readingAt = -Infinity;
let centred = false;
let input = neutralControls();
let sensorAbort: AbortController | undefined;
let loop: ReturnType<typeof setInterval> | undefined;
let wakeLock: WakeLockSentinel | undefined;
let inputGeneration = 0;
let pointerId: number | undefined;
const heldKeys = new Set<string>();
const screenAngle = () => screen.orientation?.angle ?? (window as Window & { orientation?: number }).orientation ?? 0;
const setInputStatus = (text: string) => { if (inputStatus.textContent !== text) inputStatus.textContent = text; };

if (!isSecureContext) connectionStatus.textContent = "Open the HTTPS controller link from your flight screen.";
else if (window.top !== window.self) connectionStatus.textContent = "Open this controller in its own browser tab.";

function releaseInput() {
  input = neutralControls(); centred = false; calibration.reset(); heldKeys.clear();
  const id = pointerId; pointerId = undefined;
  if (id !== undefined && pad.hasPointerCapture(id)) pad.releasePointerCapture(id);
  link.send(input);
}
function stopSensors() {
  ++inputGeneration; sensorAbort?.abort(); sensorAbort = undefined;
  reading = undefined; readingAt = -Infinity;
  releaseInput(); centreButton.disabled = true;
}
async function keepAwake() {
  if (!link.active || document.hidden || wakeLock) return;
  const generation = inputGeneration;
  try {
    const lock = await navigator.wakeLock?.request("screen");
    if (!lock) { element("wake-status").textContent = "Keep the phone awake while flying."; return; }
    if (!link.active || document.hidden || generation !== inputGeneration) { await lock.release(); return; }
    wakeLock = lock;
    element("wake-status").textContent = "";
    lock.addEventListener("release", () => {
      if (wakeLock === lock) wakeLock = undefined;
      element("wake-status").textContent = "Keep the phone awake while flying.";
    });
  } catch { element("wake-status").textContent = "Keep the phone awake while flying."; }
}
function renderMode() {
  modeButton.textContent = mode === "tilt" ? "Use touch" : "Enable tilt";
  centreButton.hidden = mode === "touch";
  pad.dataset.touch = String(mode === "touch");
  pad.tabIndex = mode === "touch" ? 0 : -1;
  pad.setAttribute("aria-label", mode === "touch" ? "Airplane yoke: drag to steer and change speed, or use arrow keys. Release to centre." : "Airplane yoke responding to your tilt");
}
function useTouch(message = "Drag to steer, or enable tilt.") {
  stopSensors(); mode = "touch"; renderMode();
  touchStatus = message; setInputStatus(touchStatus);
}

async function enableTilt() {
  stopSensors(); mode = "tilt"; renderMode();
  const generation = inputGeneration;
  const orientation = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> };
  if (!orientation) throw new Error("Tilt is unavailable in this browser. Use touch instead.");
  // Called directly by the tap handler, before networking or another awaited operation.
  if (typeof orientation.requestPermission === "function") {
    const permission = await orientation.requestPermission();
    if (permission !== "granted") throw new Error("Motion permission was not granted. Enable it in browser settings or use touch.");
  }
  if (generation !== inputGeneration) return false;
  sensorAbort = new AbortController();
  window.addEventListener("deviceorientation", (event) => {
    const next = { beta: event.beta, gamma: event.gamma };
    if (!orientationAngles(next, screenAngle())) return;
    reading = next; readingAt = performance.now();
    centreButton.disabled = !link.fresh;
  }, { signal: sensorAbort.signal });
  setInputStatus("Hold the phone comfortably, then tap Centre.");
  return true;
}

function connect() {
  if (!invitation || link.active) return;
  useTouch();
  element("setup").hidden = true; element("controls").hidden = false; disconnectButton.hidden = false;
  // Opening the scanned invitation starts pairing. Sensor permissions remain separate tap actions.
  loop = setInterval(publishInput, 1000 / 30);
  void link.start(invitation);
  void keepAwake();
}

function publishInput() {
  if (!link.ready) return;
  const now = performance.now();
  polarSource.configure(link.relay);
  link.sourceOffer = document.hidden || !link.fresh ? null : polarSource.offer(now);
  if (document.hidden || !link.fresh) {
    releaseInput(); setInputStatus(document.hidden ? "Return to this page to control the plane." : "Waiting for the flight screen. Controls are centred.");
    pad.dataset.steering = "centre"; confirmed.textContent = "Waiting for flight confirmation · controls released.";
    return;
  }
  if (mode === "touch") setInputStatus(touchStatus);
  if (mode === "tilt") {
    if (!reading || now - readingAt >= SENSOR_STALE_MS) {
      releaseInput(); centreButton.disabled = true;
      setInputStatus("Waiting for motion readings. Move the phone, then tap Centre, or use touch.");
    } else if (centred) {
      input = calibration.read(reading, screenAngle(), now);
      if (!input.active) { centred = false; setInputStatus("Phone rotated. Hold it comfortably and tap Centre again."); }
    }
  }
  link.send(input);
}
function displayState(state: TiltState) {
  pad.dataset.steering = Math.abs(state.x) < .03 ? "centre" : state.x < 0 ? "left" : "right";
  const steering = Math.abs(state.x) < .03 ? "Centred" : `${state.x < 0 ? "Left" : "Right"} ${Math.round(Math.abs(state.x) * 100)}%`;
  const speed = state.speedEnabled ? `Speed trim ${Math.round(state.y * 50)}%` : "Speed set by Ground Control";
  confirmed.textContent = `${steering} · ${speed}`;
}
function endSession() {
  polarSource.stop();
  polarSource.configure(null);
  if (loop !== undefined) clearInterval(loop);
  loop = undefined; stopSensors(); link.stop(); invitation = undefined;
  void wakeLock?.release(); wakeLock = undefined;
  disconnectButton.hidden = true; centreButton.disabled = modeButton.disabled = true;
  pad.dataset.steering = "centre";
  confirmed.textContent = "Controls released.";
  setInputStatus("Create a new QR code on the flight screen to pair again.");
}

disconnectButton.addEventListener("click", endSession);
fullscreenButton.hidden = !document.fullscreenEnabled;
fullscreenButton.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { /* Keep the yoke usable when fullscreen is unavailable. */ }
});
document.addEventListener("fullscreenchange", () => {
  const label = document.fullscreenElement ? "Exit full screen" : "Full screen";
  fullscreenButton.setAttribute("aria-label", label); fullscreenButton.title = label;
});
centreButton.addEventListener("click", () => {
  if (!reading || performance.now() - readingAt >= SENSOR_STALE_MS || !link.fresh) return;
  centred = calibration.calibrate(reading, screenAngle(), performance.now());
  input = { x: 0, y: 0, active: centred };
  link.send(input); setInputStatus("Tilt left/right to steer. Tip away to speed up, pull toward you to slow down.");
  void keepAwake();
});
modeButton.addEventListener("click", async () => {
  if (mode === "tilt") useTouch();
  else {
    modeButton.disabled = true;
    try { await enableTilt(); }
    catch (error) { if (link.active) useTouch(error instanceof Error ? error.message : "Tilt unavailable. Use touch."); }
    finally { modeButton.disabled = !link.active; }
  }
});
link.addEventListener("status", (event: Event) => {
  const status = (event as CustomEvent).detail;
  connectionStatus.textContent = status.message;
  if (!status.active && loop !== undefined) {
    polarSource.stop();
    polarSource.configure(null);
    // Do not call link.stop recursively from its own status event.
    clearInterval(loop); loop = undefined; stopSensors(); invitation = undefined;
    disconnectButton.hidden = true; modeButton.disabled = true;
    void wakeLock?.release(); wakeLock = undefined;
    pad.dataset.steering = "centre"; confirmed.textContent = "Controls released.";
    setInputStatus("Create a new QR code on the flight screen to pair again.");
  }
});
link.addEventListener("ready", () => { modeButton.disabled = false; centreButton.disabled = !reading || !link.fresh; void keepAwake(); });
link.addEventListener("state", (event: Event) => displayState((event as CustomEvent<TiltState>).detail));

const moveTouch = (event: PointerEvent) => {
  const rect = pad.getBoundingClientRect();
  input = {
    x: Math.max(-1, Math.min(1, (event.clientX - rect.left - rect.width / 2) / (rect.width * .34))),
    y: Math.max(-1, Math.min(1, -(event.clientY - rect.top - rect.height / 2) / (rect.height * .34))), active: true,
  };
};
pad.addEventListener("pointerdown", event => {
  if (mode !== "touch" || !link.fresh || pointerId !== undefined) return;
  event.preventDefault(); heldKeys.clear(); pointerId = event.pointerId; pad.setPointerCapture(event.pointerId); moveTouch(event);
});
pad.addEventListener("pointermove", event => { if (event.pointerId === pointerId) moveTouch(event); });
for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
  pad.addEventListener(type, event => { if ((event as PointerEvent).pointerId === pointerId) releaseInput(); });
for (const type of ["keydown", "keyup"]) pad.addEventListener(type, event => {
  const key = (event as KeyboardEvent).key;
  if (mode !== "touch" || !link.fresh || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) return;
  event.preventDefault();
  if (type === "keydown") heldKeys.add(key); else heldKeys.delete(key);
  input = { x: Number(heldKeys.has("ArrowRight")) - Number(heldKeys.has("ArrowLeft")), y: Number(heldKeys.has("ArrowUp")) - Number(heldKeys.has("ArrowDown")), active: heldKeys.size > 0 };
});
pad.addEventListener("blur", () => { if (mode === "touch") releaseInput(); });
window.addEventListener("blur", releaseInput);
window.addEventListener("pagehide", () => { endSession(); disposeTextFit(); });
const rotated = () => { releaseInput(); if (mode === "tilt") setInputStatus("Phone rotated. Hold it comfortably and tap Centre again."); };
screen.orientation?.addEventListener("change", rotated);
window.addEventListener("orientationchange", rotated);
document.addEventListener("visibilitychange", () => {
  releaseInput();
  if (document.hidden) { void wakeLock?.release(); wakeLock = undefined; }
  else { if (mode === "tilt") setInputStatus("Welcome back. Hold the phone comfortably and tap Centre."); void keepAwake(); }
});

if (invitation && isSecureContext && window.top === window.self) connect();
