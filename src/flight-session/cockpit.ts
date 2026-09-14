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
let wakeLock: WakeLockSentinel | undefined;
let cockpitRequest: PilotRequest | undefined;
const select = document.createElement("select"); select.setAttribute("aria-label", "Aircraft");
for (const aircraft of AIRCRAFT_CATALOG) { const option = document.createElement("option"); option.value = aircraft.id; option.textContent = aircraft.label; select.append(option); }
select.value = game.snapshot().aircraftId;
select.addEventListener("change", () => { aircraftReady = false; select.disabled = true; void game.setAircraft(select.value as typeof AIRCRAFT_CATALOG[number]["id"]).then(() => { aircraftReady = true; }, () => { element("session-signal").textContent = "Aircraft could not load."; }).finally(() => { select.disabled = false; }); });
element("session-flight-status").append(select);
void game.setAircraft(game.snapshot().aircraftId).then(() => { aircraftReady = true; }, () => { element("session-link").textContent = "Aircraft could not load. Reload to retry."; });

async function keepAwake() {
  if (document.hidden || !link.active || wakeLock) return;
  try {
    const lock = await navigator.wakeLock?.request("screen");
    if (!lock) return;
    if (document.hidden || !link.active) { await lock.release(); return; }
    wakeLock = lock; lock.addEventListener("release", () => { if (wakeLock === lock) wakeLock = undefined; });
  } catch { /* Signal leases also protect browsers without a wake lock. */ }
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
  if (loop !== undefined) clearInterval(loop); loop = undefined;
  source.stop(); source.configure(null); ready = started = false; game.setPaused(true); link.stop(); invitation = undefined;
  void wakeLock?.release(); wakeLock = undefined;
  element("session-disconnect").hidden = true; start.disabled = true;
  element("session-signal").textContent = "Disconnected. Create a new cockpit QR code on Ground Control.";
}
function connect() {
  if (!invitation || link.active) return;
  element("session-entry").hidden = true;
  element("session-flight-status").hidden = element("session-sensor").hidden = element("session-disconnect").hidden = false;
  loop = setInterval(tick, CONTROL_RELAY_MS); void link.start(invitation); void keepAwake();
}
start.addEventListener("click", () => { tick(); if (!ready) return; started = true; game.restart(); start.hidden = true; });
element("session-disconnect").addEventListener("click", stop);
link.addEventListener("status", (event: Event) => {
  const detail = (event as CustomEvent).detail; element("session-link").textContent = detail.message;
  if (!detail.active && loop !== undefined) stop();
});
void game.immersiveSupported().then(supported => { xr.hidden = !supported; }, () => {});
xr.addEventListener("click", () => { void game.enterImmersive().catch(() => { element("session-link").textContent = "Immersive mode could not start."; }); });
document.addEventListener("visibilitychange", () => { tick(); if (document.hidden) void wakeLock?.release(); else void keepAwake(); });
window.addEventListener("pagehide", () => { stop(); releaseSteering(); game.dispose(); });

if (invitation && isSecureContext && window.top === window.self) connect();
else if (directVisit && isSecureContext && window.top === window.self) {
  const params = new URLSearchParams(location.search);
  const hint = params.get("tower") ?? "";
  const towerName = cleanTowerName(params.get("towerName") ?? "");
  if (!hint || validTower(hint)) {
    const form = element<HTMLFormElement>("cockpit-entry");
    form.hidden = false;
    cockpitRequest = new PilotRequest(form, hint, towerName, accepted => {
      invitation = accepted; form.hidden = true; connect();
    }, "cockpit");
    form.addEventListener("submit", event => {
      event.preventDefault();
      const field = element<HTMLInputElement>("cockpit-pilot-name");
      const name = cleanPilotName(field.value);
      if (!name) { field.value = ""; field.reportValidity(); return; }
      cockpitRequest?.start(name);
    });
  }
}
