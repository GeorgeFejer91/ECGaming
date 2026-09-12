import "./controller.css";
import yokeUrl from "./yoke-surface.svg";
import { readTiltInvitation } from "./invitation";
import { TiltLink } from "./link";
import { neutralControls, orientationAngles, SENSOR_STALE_MS, TiltCalibration, type OrientationReading, type TiltState } from "./controls";
import { PolarSourceWidget } from "../flight-session/polar-source";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const centreButton = element<HTMLButtonElement>("centre");
const horizon = document.getElementById("attitude-horizon")!;
const connectionStatus = element("connection-status"), inputStatus = element("input-status"), pad = element("tilt-pad");
const yoke = element<HTMLImageElement>("steering-yoke"), confirmed = element("confirmed");
yoke.src = yokeUrl;
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
let listeningAt = -Infinity;
let centred = false;
let permissionPending = false;
let autoCentrePending = false;
let gyroCentre: ReturnType<typeof orientationAngles>;
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

function releaseInput(clearAutoCentre = true) {
  if (clearAutoCentre) autoCentrePending = false;
  input = neutralControls(); centred = false; calibration.reset(); heldKeys.clear();
  const id = pointerId; pointerId = undefined;
  if (id !== undefined && pad.hasPointerCapture(id)) pad.releasePointerCapture(id);
  link.send(input);
}
function stopSensors() {
  ++inputGeneration; sensorAbort?.abort(); sensorAbort = undefined;
  permissionPending = false;
  gyroCentre = undefined;
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
  centreButton.setAttribute("aria-label", permissionPending || mode === "touch" ? "Enable tilt" : "Centre");
  centreButton.disabled = !link.fresh;
  pad.dataset.touch = String(mode === "touch");
  pad.tabIndex = 0;
  pad.setAttribute("aria-label", "Airplane yoke: tilt or drag to steer. Arrow keys also steer; release to centre.");
  renderAttitude();
}
function renderAttitude() {
  const fresh = reading && performance.now() - readingAt < SENSOR_STALE_MS;
  const angles = fresh ? orientationAngles(reading!, screenAngle()) : undefined;
  const origin = gyroCentre ?? angles;
  const manual = mode === "touch" || pointerId !== undefined || heldKeys.size > 0;
  const wrap = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;
  const bank = manual ? input.x * 28 : angles && origin ? wrap(angles.bank - origin.bank) : 0;
  const pitch = manual ? input.y * 28 : angles && origin ? wrap(origin.pitch - angles.pitch) : 0;
  horizon.setAttribute("transform", `rotate(${(-bank).toFixed(2)} 80 80) translate(0 ${Math.max(-45, Math.min(45, pitch)).toFixed(2)})`);
  centreButton.dataset.state = !link.fresh ? "offline" : permissionPending ? "permission" : mode === "touch" ? "touch" : (centred && fresh) || manual ? "live" : "centre";
  centreButton.disabled = !link.fresh;
  polarSource.button.dataset.state = polarSource.processor.status;
  polarSource.button.dataset.connected = String(polarSource.button.textContent === "Disconnect H10");
}
function useTouch(message = "Drag to steer, or enable tilt.") {
  stopSensors(); mode = "touch"; renderMode();
  touchStatus = message; setInputStatus(touchStatus);
}

async function enableTilt(fromGesture = false) {
  stopSensors(); mode = "tilt";
  const generation = inputGeneration;
  const orientation = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> };
  if (!orientation) throw new Error("Tilt is unavailable in this browser. Use touch instead.");
  permissionPending = typeof orientation.requestPermission === "function" && !fromGesture;
  autoCentrePending = true; renderMode();
  // Subscribe immediately; only browsers requiring a gesture show the permission action.
  if (fromGesture && typeof orientation.requestPermission === "function") {
    const permission = await orientation.requestPermission();
    if (permission !== "granted") throw new Error("Motion permission was not granted. Enable it in browser settings or use touch.");
  }
  if (generation !== inputGeneration) return false;
  autoCentrePending = true;
  sensorAbort = new AbortController();
  listeningAt = performance.now();
  window.addEventListener("deviceorientation", (event) => {
    const next = { beta: event.beta, gamma: event.gamma };
    if (!orientationAngles(next, screenAngle())) return;
    reading = next; readingAt = performance.now();
    if (permissionPending) { permissionPending = false; renderMode(); }
    centreButton.disabled = !link.fresh;
    renderAttitude();
  }, { signal: sensorAbort.signal });
  setInputStatus(permissionPending ? "Tap Enable tilt to fly." : "Hold the phone steady…");
  return true;
}

function connect() {
  if (!invitation || link.active) return;
  void enableTilt().catch(error => { if (link.active) useTouch(error instanceof Error ? error.message : "Tilt unavailable. Use touch."); });
  element("setup").hidden = true; element("controls").hidden = false;
  // Opening the scanned invitation starts pairing. Sensor permissions remain separate tap actions.
  loop = setInterval(publishInput, 1000 / 30);
  void link.start(invitation);
  void keepAwake();
}

function publishInput() {
  renderAttitude();
  if (!link.ready) return;
  const now = performance.now();
  polarSource.configure(link.relay);
  link.sourceOffer = document.hidden || !link.fresh ? null : polarSource.offer(now);
  if (document.hidden || !link.fresh) {
    releaseInput(document.hidden); setInputStatus(document.hidden ? "Return to this page to control the plane." : "Waiting for the flight screen. Controls are centred.");
    pad.dataset.steering = "centre"; confirmed.textContent = "Waiting for flight confirmation · controls released.";
    return;
  }
  if (mode === "touch") setInputStatus(touchStatus);
  if (mode === "tilt" && pointerId === undefined && heldKeys.size === 0) {
    if (permissionPending) {
      releaseInput(false); setInputStatus("Tap Enable tilt to fly.");
    } else if (!reading || now - readingAt >= SENSOR_STALE_MS) {
      releaseInput(false); centreButton.disabled = true;
      if (!reading && now - listeningAt > 2500) useTouch("Drag the yoke to steer. Tap the instrument to try tilt again.");
      else setInputStatus("Waiting for motion readings. Move the phone, then tap Centre, or use touch.");
    } else if (autoCentrePending) {
      centreTilt();
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
  centreButton.disabled = true;
  pad.dataset.steering = "centre";
  confirmed.textContent = "Controls released.";
  renderAttitude();
  setInputStatus("Create a new QR code on the flight screen to pair again.");
}

function centreTilt() {
  if (!reading || performance.now() - readingAt >= SENSOR_STALE_MS || !link.fresh) return;
  autoCentrePending = false;
  centred = calibration.calibrate(reading, screenAngle(), performance.now());
  gyroCentre = orientationAngles(reading, screenAngle());
  input = { x: 0, y: 0, active: centred };
  link.send(input); setInputStatus("Tilt left/right to steer. Tip away to speed up, pull toward you to slow down.");
  void keepAwake();
  renderAttitude();
}
async function requestTilt() {
  centreButton.disabled = true;
  try { await enableTilt(true); }
  catch (error) { if (link.active) useTouch(error instanceof Error ? error.message : "Tilt unavailable. Use touch."); }
  finally { renderMode(); }
}
centreButton.addEventListener("click", () => {
  if (permissionPending || mode === "touch") void requestTilt();
  else centreTilt();
});
link.addEventListener("status", (event: Event) => {
  const status = (event as CustomEvent).detail;
  connectionStatus.textContent = status.message;
  if (!status.active && loop !== undefined) {
    polarSource.stop();
    polarSource.configure(null);
    // Do not call link.stop recursively from its own status event.
    clearInterval(loop); loop = undefined; stopSensors(); invitation = undefined;
    centreButton.disabled = true;
    void wakeLock?.release(); wakeLock = undefined;
    pad.dataset.steering = "centre"; confirmed.textContent = "Controls released.";
    renderAttitude();
    setInputStatus("Create a new QR code on the flight screen to pair again.");
  }
});
link.addEventListener("ready", () => { autoCentrePending = mode === "tilt"; renderMode(); void keepAwake(); });
link.addEventListener("state", (event: Event) => displayState((event as CustomEvent<TiltState>).detail));

const moveTouch = (event: PointerEvent) => {
  const rect = pad.getBoundingClientRect();
  input = {
    x: Math.max(-1, Math.min(1, (event.clientX - rect.left - rect.width / 2) / (rect.width * .34))),
    y: Math.max(-1, Math.min(1, -(event.clientY - rect.top - rect.height / 2) / (rect.height * .34))), active: true,
  };
};
pad.addEventListener("pointerdown", event => {
  if (!link.fresh || pointerId !== undefined || mode !== "touch") return;
  event.preventDefault(); heldKeys.clear(); pointerId = event.pointerId; pad.setPointerCapture(event.pointerId); moveTouch(event);
});
pad.addEventListener("pointermove", event => { if (event.pointerId === pointerId) moveTouch(event); });
for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
  pad.addEventListener(type, event => { if ((event as PointerEvent).pointerId === pointerId) releaseInput(); });
for (const type of ["keydown", "keyup"]) pad.addEventListener(type, event => {
  const key = (event as KeyboardEvent).key;
  if (!link.fresh || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) return;
  event.preventDefault();
  if (type === "keydown") heldKeys.add(key); else heldKeys.delete(key);
  input = { x: Number(heldKeys.has("ArrowRight")) - Number(heldKeys.has("ArrowLeft")), y: Number(heldKeys.has("ArrowUp")) - Number(heldKeys.has("ArrowDown")), active: heldKeys.size > 0 };
});
pad.addEventListener("blur", () => releaseInput());
window.addEventListener("blur", () => releaseInput());
window.addEventListener("pagehide", endSession);
const rotated = () => { releaseInput(); if (mode === "tilt") setInputStatus("Phone rotated. Hold it comfortably and tap Centre again."); };
screen.orientation?.addEventListener("change", rotated);
window.addEventListener("orientationchange", rotated);
document.addEventListener("visibilitychange", () => {
  releaseInput();
  if (document.hidden) { void wakeLock?.release(); wakeLock = undefined; }
  else { if (mode === "tilt") setInputStatus("Welcome back. Hold the phone comfortably and tap Centre."); void keepAwake(); }
});

if (invitation && isSecureContext && window.top === window.self) connect();
