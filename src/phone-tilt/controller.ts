import "./controller.css";
import yokeUrl from "./yoke-surface.svg";
import { readTiltInvitation } from "./invitation";
import { CONTROL_RELAY_MS, TiltLink } from "./link";
import { neutralControls, orientationAngles, SENSOR_STALE_MS, TiltCalibration, type OrientationReading, type TiltState } from "./controls";
import { PolarSourceWidget } from "../flight-session/polar-source";
import { cleanPilotName } from "./pilot-name";
import { PracticeHeartbeat } from "./practice-heartbeat";
import { PolarRrHaptics } from "./rr-haptics";
import { PilotRequest } from "./pilot-request";
import { cleanTowerName, validTower } from "./pilot-lobby";
import { ReconnectBackoff } from "./reconnect";
import { ScreenWakeLock } from "./screen-wake-lock";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const pilotEntry = element<HTMLFormElement>("pilot-entry");
let pilotEntered = false;
const centreButton = element<HTMLButtonElement>("centre");
const horizon = document.getElementById("attitude-horizon")!;
const connectionStatus = element("connection-status"), inputStatus = element("input-status"), pad = element("tilt-pad");
const yoke = element<HTMLImageElement>("steering-yoke"), confirmed = element("confirmed");
const liftMeter = element("lift-meter"), liftMeterFill = element("lift-meter-fill"), liftMeterValue = element("lift-meter-value");
const entryFeedback = element("pilot-entry-feedback");
const exitPilot = element<HTMLButtonElement>("exit-pilot");
yoke.src = yokeUrl;
const directVisit = !location.hash;
let invitation = readTiltInvitation(location.hash);
// The fragment is bearer pairing material. Keep it out of history and all subsequent navigation.
if (location.hash) history.replaceState(null, "", location.pathname + location.search);
const link = new TiltLink("controller");
let pilotName = "";
let endingSession = false;
const reconnect = new ReconnectBackoff();
const wakeLock = new ScreenWakeLock(() => link.active && !endingSession);
let heartbeatAt = -Infinity;
let practiceHeartbeatActive = false;
const heartbeatOutput = (duration: number) => {
  if (duration > 0) heartbeatAt = performance.now();
  else heartbeatAt = -Infinity;
  try { navigator.vibrate?.(duration); } catch { /* Keep the visual beat when haptics are unavailable. */ }
};
const practiceHeartbeat = new PracticeHeartbeat(heartbeatOutput);
const rrHaptics = new PolarRrHaptics(heartbeatOutput, () => !document.hidden && link.active && !practiceHeartbeatActive);
const polarSource = new PolarSourceWidget(element("yoke-polar"), event => rrHaptics.handle(event));
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
let inputGeneration = 0;
let pointerId: number | undefined;
const heldKeys = new Set<string>();
const fixedWheelAngle = () => 90;
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
  element("wake-status").textContent = "";
  await wakeLock.request();
}
function renderMode() {
  centreButton.setAttribute("aria-label", permissionPending || mode === "touch" ? "Enable tilt" : "Centre");
  centreButton.disabled = !invitation;
  pad.dataset.touch = String(mode === "touch");
  pad.tabIndex = 0;
  pad.setAttribute("aria-label", "Airplane yoke: tilt or drag to steer. Arrow keys also steer; release to centre.");
  renderAttitude();
}
function renderAttitude() {
  const fresh = reading && performance.now() - readingAt < SENSOR_STALE_MS;
  const angles = fresh ? orientationAngles(reading!, fixedWheelAngle()) : undefined;
  const origin = gyroCentre ?? angles;
  const wrap = (value: number) => ((value + 180) % 360 + 360) % 360 - 180;
  // This instrument represents physical attitude, including when touch steering is available.
  const bank = angles && origin ? wrap(angles.bank - origin.bank) : 0;
  const pitch = angles && origin ? wrap(origin.pitch - angles.pitch) : 0;
  horizon.setAttribute("transform", `rotate(${(-bank).toFixed(2)} 80 80) translate(0 ${Math.max(-45, Math.min(45, pitch)).toFixed(2)})`);
  centreButton.dataset.state = !invitation ? "offline" : permissionPending ? "permission" : mode === "touch" ? "touch" : centred && fresh ? "live" : "centre";
  centreButton.disabled = !invitation;
  polarSource.button.dataset.state = polarSource.processor.status;
  polarSource.button.dataset.heartbeat = practiceHeartbeatActive ? "practice" : "local";
  polarSource.button.dataset.pulse = String(performance.now() - heartbeatAt < 150);
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
    if (!orientationAngles(next, fixedWheelAngle())) return;
    reading = next; readingAt = performance.now();
    // Some browsers start supplying readings only after a settings change or a long startup.
    if (mode === "touch" && pointerId === undefined && heldKeys.size === 0) {
      mode = "tilt"; autoCentrePending = true; renderMode();
    }
    if (permissionPending) { permissionPending = false; renderMode(); }
    centreButton.disabled = !invitation;
    renderAttitude();
  }, { signal: sensorAbort.signal });
  setInputStatus(permissionPending ? "Tap Enable tilt to fly." : "Hold the phone steady…");
  return true;
}

function connect(sensorsReady = false) {
  if (!invitation || link.active) return;
  endingSession = false;
  entryFeedback.textContent = "Pairing with the flight screen while you enter your name.";
  if (!sensorsReady) void enableTilt().catch(error => { if (link.active) useTouch(error instanceof Error ? error.message : "Tilt unavailable. Use touch."); });
  element("setup").hidden = true; pilotEntry.hidden = pilotEntered;
  // Opening the scanned invitation starts pairing. Sensor permissions remain separate tap actions.
  if (loop === undefined) loop = setInterval(publishInput, CONTROL_RELAY_MS);
  link.pilotName = pilotName;
  void link.start(invitation);
  void keepAwake();
}
function scheduleReconnect() {
  if (!invitation || endingSession || loop === undefined) return false;
  connectionStatus.textContent = "Reconnecting…";
  if (!pilotEntered) entryFeedback.textContent = "Reconnecting…";
  return reconnect.schedule(() => {
    if (!invitation || endingSession || link.active) return;
    if (document.hidden) return;
    link.pilotName = pilotName;
    void link.start(invitation);
    void keepAwake();
  });
}

function publishInput() {
  refreshHeartbeatFeedback();
  renderAttitude();
  const now = performance.now();
  polarSource.configure(link.ready ? link.relay : null);
  link.sourceOffer = document.hidden || !link.fresh ? null : polarSource.offer(now);
  if (document.hidden || !pilotEntered) {
    input = neutralControls(); link.send(input);
    return;
  }
  if (mode === "touch") setInputStatus(touchStatus);
  if (mode === "tilt" && pointerId === undefined && heldKeys.size === 0) {
    if (permissionPending) {
      releaseInput(false); setInputStatus("Tap Enable tilt to fly.");
    } else if (!reading || now - readingAt >= SENSOR_STALE_MS) {
      // Neutralize stale commands without discarding the grip calibration. Browsers may
      // pause orientation events while still; the next fresh reading must resume steering.
      input = neutralControls();
      if (!reading && now - listeningAt > 2500) {
        mode = "touch"; touchStatus = "Allow Motion sensors in browser site settings, then tap the instrument. Drag to steer meanwhile.";
        renderMode();
      } else setInputStatus("Waiting for motion readings. Move the phone to resume steering.");
    } else if (autoCentrePending) {
      centreTilt();
    } else if (centred) {
      input = calibration.read(reading, fixedWheelAngle(), now);
      if (!input.active) { centred = false; setInputStatus("Hold the phone sideways and tap Centre again."); }
    }
  }
  // The local gyro starts immediately; only fresh authenticated sessions receive steering.
  if (link.fresh) link.send(input);
  else {
    link.send(neutralControls()); pad.dataset.steering = "centre";
    confirmed.textContent = "Waiting for flight confirmation · controls released.";
  }
}
function refreshHeartbeatFeedback() {
  practiceHeartbeatActive = practiceHeartbeat.update(link.relay, link.fresh && pilotEntered, !document.hidden);
  renderLiftMeter();
}
function renderLiftMeter() {
  const frame = link.fresh && pilotEntered ? link.relay?.frame : null;
  const lift = frame ? Math.max(0, Math.min(1, (frame.altitude + 1) / 2)) : .5;
  const value = lift.toFixed(2);
  liftMeter.style.setProperty("--lift", `${Math.round(lift * 100)}%`);
  liftMeter.dataset.state = frame ? "live" : "stale";
  liftMeter.setAttribute("aria-valuenow", value);
  liftMeterValue.textContent = value;
  liftMeterFill.style.height = `${lift * 100}%`;
}
function displayState(state: TiltState) {
  pad.dataset.steering = Math.abs(state.x) < .03 ? "centre" : state.x < 0 ? "left" : "right";
  const steering = Math.abs(state.x) < .03 ? "Centred" : `${state.x < 0 ? "Left" : "Right"} ${Math.round(Math.abs(state.x) * 100)}%`;
  const speed = state.speedEnabled ? `Speed trim ${Math.round(state.y * 50)}%` : "Speed set by Ground Control";
  confirmed.textContent = `${steering} · ${speed}`;
}
function endSession() {
  endingSession = true; reconnect.clear(); pilotName = "";
  pilotEntry.hidden = true; element<HTMLInputElement>("controller-pilot-name").value = "";
  pilotEntered = false;
  element("controls").hidden = true;
  practiceHeartbeat.pause(); practiceHeartbeatActive = false;
  polarSource.stop();
  polarSource.configure(null);
  if (loop !== undefined) clearInterval(loop);
  loop = undefined; stopSensors(); link.stop(); invitation = undefined;
  void wakeLock.release();
  centreButton.disabled = true;
  pad.dataset.steering = "centre";
  confirmed.textContent = "Controls released.";
  renderAttitude();
  setInputStatus("Create a new QR code on the flight screen to pair again.");
}

function centreTilt() {
  if (!reading || performance.now() - readingAt >= SENSOR_STALE_MS) return;
  autoCentrePending = false;
  centred = calibration.calibrate(reading, fixedWheelAngle(), performance.now());
  gyroCentre = orientationAngles(reading, fixedWheelAngle());
  input = { x: 0, y: 0, active: centred };
  if (link.fresh) link.send(input);
  setInputStatus("Tilt left/right to steer. Tip away to speed up, pull toward you to slow down.");
  void keepAwake();
  renderAttitude();
}
async function requestTilt() {
  centreButton.disabled = true;
  try { await enableTilt(true); }
  catch (error) { if (link.active) useTouch(error instanceof Error ? error.message : "Tilt unavailable. Use touch."); }
  finally { renderMode(); }
}
pilotEntry.addEventListener("submit", event => {
  event.preventDefault();
  if (pilotEntered) return;
  const field = element<HTMLInputElement>("controller-pilot-name");
  const name = cleanPilotName(field.value);
  if (!name) { field.value = ""; field.reportValidity(); return; }
  if (!invitation) {
    if (!pilotRequest) return;
    pilotName = name;
    void enableTilt(true).catch(error => useTouch(error instanceof Error ? error.message : "Tilt unavailable."));
    if (navigator.maxTouchPoints > 0 && !document.fullscreenElement)
      void document.documentElement.requestFullscreen?.().catch(() => {});
    pilotRequest.start(name); return;
  }
  pilotName = name; link.pilotName = pilotName; pilotEntered = true;
  field.blur(); pilotEntry.hidden = true; element("controls").hidden = false;
  void requestTilt();
  if (navigator.maxTouchPoints > 0 && !document.fullscreenElement)
    void document.documentElement.requestFullscreen?.().catch(() => {});
  void keepAwake();
});
centreButton.addEventListener("click", () => {
  if (permissionPending || mode === "touch") void requestTilt();
  else centreTilt();
});
exitPilot.addEventListener("click", () => {
  endSession();
  void document.exitFullscreen?.().catch(() => {});
});
link.addEventListener("status", (event: Event) => {
  const status = (event as CustomEvent<{ message: string; active: boolean; ready: boolean; reconnectable?: boolean }>).detail;
  connectionStatus.textContent = status.message;
  if (!pilotEntered && invitation) entryFeedback.textContent = status.message;
  if (!status.active && loop !== undefined) {
    if (status.reconnectable && scheduleReconnect()) {
      practiceHeartbeat.pause(); practiceHeartbeatActive = false; rrHaptics.pause();
      pad.dataset.steering = "centre";
      confirmed.textContent = "Waiting for flight confirmation · controls released.";
      renderAttitude();
      void wakeLock.release();
      return;
    }
    endingSession = true; reconnect.clear(); pilotName = "";
    pilotEntry.hidden = true; element<HTMLInputElement>("controller-pilot-name").value = "";
    pilotEntered = false;
    element("controls").hidden = true;
    practiceHeartbeat.pause(); practiceHeartbeatActive = false;
    polarSource.stop();
    polarSource.configure(null);
    // Do not call link.stop recursively from its own status event.
    clearInterval(loop); loop = undefined; stopSensors(); invitation = undefined;
    centreButton.disabled = true;
    void wakeLock.release();
    pad.dataset.steering = "centre"; confirmed.textContent = "Controls released.";
    renderAttitude();
    setInputStatus("Create a new QR code on the flight screen to pair again.");
  }
});
link.addEventListener("ready", () => { reconnect.clear(); if (!centred) autoCentrePending = mode === "tilt"; renderMode(); void keepAwake(); });
link.addEventListener("state", (event: Event) => { refreshHeartbeatFeedback(); displayState((event as CustomEvent<TiltState>).detail); });

const moveTouch = (event: PointerEvent) => {
  const rect = pad.getBoundingClientRect();
  input = {
    x: Math.max(-1, Math.min(1, (event.clientX - rect.left - rect.width / 2) / (rect.width * .34))),
    y: Math.max(-1, Math.min(1, -(event.clientY - rect.top - rect.height / 2) / (rect.height * .34))), active: true,
  };
};
pad.addEventListener("pointerdown", event => {
  if (!pilotEntered || !link.fresh || pointerId !== undefined || mode !== "touch") return;
  event.preventDefault(); heldKeys.clear(); pointerId = event.pointerId; pad.setPointerCapture(event.pointerId); moveTouch(event);
});
pad.addEventListener("pointermove", event => { if (event.pointerId === pointerId) moveTouch(event); });
for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
  pad.addEventListener(type, event => { if ((event as PointerEvent).pointerId === pointerId) releaseInput(); });
for (const type of ["keydown", "keyup"]) pad.addEventListener(type, event => {
  const key = (event as KeyboardEvent).key;
  if (!pilotEntered || !link.fresh || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) return;
  event.preventDefault();
  if (type === "keydown") heldKeys.add(key); else heldKeys.delete(key);
  input = { x: Number(heldKeys.has("ArrowRight")) - Number(heldKeys.has("ArrowLeft")), y: Number(heldKeys.has("ArrowUp")) - Number(heldKeys.has("ArrowDown")), active: heldKeys.size > 0 };
});
function rearmTilt() {
  releaseInput();
  if (mode === "tilt") {
    reading = undefined; readingAt = -Infinity; listeningAt = performance.now(); gyroCentre = undefined;
    autoCentrePending = true;
  }
}
pad.addEventListener("blur", rearmTilt);
window.addEventListener("blur", rearmTilt);
window.addEventListener("pagehide", endSession);
// Fullscreen needs a user gesture. Bubble after the gyro's motion-permission handler,
// and avoid competing with the Polar device chooser in the heart button's gesture.
document.addEventListener("click", event => {
  if (!pilotEntered || !invitation || navigator.maxTouchPoints === 0 || (event.target as Element).closest(".yoke-polar") || document.fullscreenElement) return;
  void document.documentElement.requestFullscreen?.().catch(() => {});
});
document.addEventListener("visibilitychange", () => {
  rearmTilt();
  if (document.hidden) { practiceHeartbeat.pause(); practiceHeartbeatActive = false; rrHaptics.pause(); void wakeLock.release(); }
  else {
    if (mode === "tilt") setInputStatus("Hold the phone steady…");
    if (invitation && !link.active && loop !== undefined) scheduleReconnect();
    else void keepAwake();
  }
});
window.addEventListener("focus", () => {
  if (invitation && !link.active && loop !== undefined) scheduleReconnect();
  else void keepAwake();
});
window.addEventListener("pageshow", () => {
  if (invitation && !link.active && loop !== undefined) scheduleReconnect();
  else void keepAwake();
});

let pilotRequest: PilotRequest | undefined;
if (invitation && isSecureContext && window.top === window.self) connect();
else if (directVisit && isSecureContext && window.top === window.self) {
  const params = new URLSearchParams(location.search);
  const hint = params.get("tower") ?? "";
  const towerName = cleanTowerName(params.get("towerName") ?? "");
  if (!hint || validTower(hint)) {
    entryFeedback.textContent = hint
      ? `Enter your name to ask ${towerName || "the selected Ground Control"} for wheel access.`
      : "Enter your name to search for Ground Control.";
    element("setup").hidden = true; pilotEntry.hidden = false;
    pilotRequest = new PilotRequest(pilotEntry, hint, towerName, (accepted, name) => {
      entryFeedback.textContent = "Ground Control accepted. Opening the yoke.";
      invitation = accepted; pilotName = name; link.pilotName = pilotName; pilotEntered = true;
      pilotEntry.hidden = true; element("controls").hidden = false; connect(true);
    });
  }
}
