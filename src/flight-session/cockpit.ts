import "./cockpit.css";
import { CONTROL_RELAY_MS, TiltLink } from "../phone-tilt/link";
import { readTiltInvitation } from "../phone-tilt/invitation";
import { neutralControls } from "../phone-tilt/controls";
import { getFlightSessionHub } from "./hub";
import { PolarSourceWidget } from "./polar-source";
import { createFlightScene } from "../game/flight-scene";
import { CockpitRecoveryGate } from "../game/ground-cockpit";
import { installFlightSteering } from "../ui/flight-steering";
import { FlightFlags } from "../protocol/flight-frame";
import { AIRCRAFT_CATALOG } from "../game/aircraft";
import { PilotRequest } from "../phone-tilt/pilot-request";
import { cleanPilotName } from "../phone-tilt/pilot-name";
import { cleanTowerName, validTower } from "../phone-tilt/pilot-lobby";
import { ReconnectBackoff } from "../phone-tilt/reconnect";
import { ScreenWakeLock } from "../phone-tilt/screen-wake-lock";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const directVisit = !location.hash;
let invitation = readTiltInvitation(location.hash);
if (location.hash) history.replaceState(null, "", location.pathname + location.search);
const link = new TiltLink("controller");
getFlightSessionHub().client = link;
const game = createFlightScene(element("session-canvas"));
const source = new PolarSourceWidget(element("session-polar"));
const releaseSteering = installFlightSteering(element("session-flight"), game);
const recovery = new CockpitRecoveryGate();
const start = element<HTMLButtonElement>("session-start");
const xr = element<HTMLButtonElement>("session-xr");
let started = false, ready = false, aircraftReady = false, beat = -1, configKey = "";
let loop: ReturnType<typeof setInterval> | undefined;
let cockpitRequest: PilotRequest | undefined;
let cockpitName = "";
let endingSession = false;
const reconnect = new ReconnectBackoff();
const wakeLock = new ScreenWakeLock(() => link.active && !endingSession);
const select = document.createElement("select"); select.setAttribute("aria-label", "Aircraft");
for (const aircraft of AIRCRAFT_CATALOG) { const option = document.createElement("option"); option.value = aircraft.id; option.textContent = aircraft.label; select.append(option); }
select.value = game.snapshot().aircraftId;
select.addEventListener("change", () => { aircraftReady = false; select.disabled = true; void game.setAircraft(select.value as typeof AIRCRAFT_CATALOG[number]["id"]).then(() => { aircraftReady = true; }, () => { element("session-signal").textContent = "Aircraft could not load."; }).finally(() => { select.disabled = false; }); });
element("session-flight-status").append(select);
void game.setAircraft(game.snapshot().aircraftId).then(() => { aircraftReady = true; }, () => { element("session-link").textContent = "Aircraft could not load. Reload to retry."; });

async function keepAwake() {
  await wakeLock.request();
}
function tick() {
  const now = performance.now(), relay = link.relay;
  source.configure(relay);
  link.sourceOffer = document.hidden || !link.fresh ? null : source.offer(now);
  link.send(neutralControls());
  const frame = link.fresh && !document.hidden ? relay?.frame : null;
  const nextConfig = relay ? `${relay.sourceEpoch}:${relay.configRevision}` : "";
  if (configKey !== nextConfig) { beat = -1; configKey = nextConfig; if (started) recovery.update(false, now); }
  ready = Boolean(aircraftReady && frame && (frame.flags & FlightFlags.controlReady) && (frame.flags & FlightFlags.physicalPolar) && !(frame.flags & FlightFlags.simulation));
  start.disabled = !ready;
  const gate = started ? recovery.update(ready, now) : { ready: false, countdownSeconds: undefined };
  if (started) game.setPaused(!gate.ready);
  if (frame) {
    game.setControls(frame);
    if (gate.ready && frame.beatCounter !== beat && frame.beatAgeMs < 250 && relay?.mappings.beatAction !== "off") game.heartbeat();
    beat = frame.beatCounter;
  }
  const text = !link.ready ? "Connecting…" : !ready ? "Waiting for H10…" :
    gate.countdownSeconds ? `Signal recovered · resuming in ${gate.countdownSeconds}…` :
    started ? "Flying" : "Ready to fly";
  const status = element("session-signal"); if (status.textContent !== text) status.textContent = text;
  status.dataset.ready = String(ready); status.dataset.source = relay?.source ?? "";
}
function stop() {
  endingSession = true; reconnect.clear();
  if (loop !== undefined) clearInterval(loop); loop = undefined;
  source.stop(); source.configure(null); ready = started = false; game.setPaused(true); link.stop(); invitation = undefined;
  void wakeLock.release();
  element("session-disconnect").hidden = true; start.disabled = true;
  element("session-signal").textContent = "Disconnected. Create a new cockpit QR code on Ground Control.";
}
function connect() {
  if (!invitation || link.active) return;
  endingSession = false;
  element("session-entry").hidden = true;
  element("session-flight-status").hidden = element("session-sensor").hidden = element("session-disconnect").hidden = false;
  if (loop === undefined) loop = setInterval(tick, CONTROL_RELAY_MS);
  link.pilotName = cockpitName;
  void link.start(invitation); void keepAwake();
}
function scheduleReconnect() {
  if (!invitation || endingSession || loop === undefined) return false;
  return reconnect.schedule(() => {
    if (!invitation || endingSession || link.active || document.hidden) return;
    link.pilotName = cockpitName;
    void link.start(invitation);
    void keepAwake();
  });
}
start.addEventListener("click", () => { tick(); if (!ready) return; started = true; game.restart(); start.hidden = true; });
element("session-disconnect").addEventListener("click", stop);
link.addEventListener("status", (event: Event) => {
  const detail = (event as CustomEvent<{ message: string; active: boolean; ready: boolean; reconnectable?: boolean }>).detail;
  element("session-link").textContent = detail.message;
  if (!detail.active && loop !== undefined) {
    if (detail.reconnectable && scheduleReconnect()) {
      element("session-link").textContent = "Reconnecting…";
      ready = false; start.disabled = true; game.setPaused(true); void wakeLock.release();
      return;
    }
    stop();
  }
});
link.addEventListener("ready", () => { reconnect.clear(); void keepAwake(); });
void game.immersiveSupported().then(supported => { xr.hidden = !supported; }, () => {});
xr.addEventListener("click", () => { void game.enterImmersive().catch(() => { element("session-link").textContent = "Immersive mode could not start."; }); });
document.addEventListener("visibilitychange", () => {
  tick();
  if (document.hidden) void wakeLock.release();
  else if (invitation && !link.active && loop !== undefined) scheduleReconnect();
  else void keepAwake();
});
window.addEventListener("focus", () => {
  if (invitation && !link.active && loop !== undefined) scheduleReconnect();
  else void keepAwake();
});
window.addEventListener("pageshow", () => {
  if (invitation && !link.active && loop !== undefined) scheduleReconnect();
  else void keepAwake();
});
window.addEventListener("pagehide", () => { stop(); releaseSteering(); game.dispose(); });

if (invitation && isSecureContext && window.top === window.self) connect();
else if (directVisit && isSecureContext && window.top === window.self) {
  const params = new URLSearchParams(location.search);
  const hint = params.get("tower") ?? "";
  const towerName = cleanTowerName(params.get("towerName") ?? "");
  if (!hint || validTower(hint)) {
    const form = element<HTMLFormElement>("cockpit-entry");
    form.hidden = false;
    cockpitRequest = new PilotRequest(form, hint, towerName, (accepted, name) => {
      invitation = accepted; cockpitName = name; link.pilotName = cockpitName; form.hidden = true; connect();
    }, "cockpit");
    form.addEventListener("submit", event => {
      event.preventDefault();
      const field = element<HTMLInputElement>("cockpit-pilot-name");
      const name = cleanPilotName(field.value);
      if (!name) { field.value = ""; field.reportValidity(); return; }
      cockpitName = name; cockpitRequest?.start(name);
    });
  }
}
