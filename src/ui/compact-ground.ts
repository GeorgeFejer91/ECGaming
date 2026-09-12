import { AIRCRAFT_CATALOG } from "../game/aircraft";
import "./compact-ground.css";
const paths = {
  tower: '<circle cx="12" cy="6" r="2"/><path d="m12 8-5 13h10L12 8ZM5 11a8 8 0 0 1 0-10m14 0a8 8 0 0 1 0 10M9 15h6"/>',
  cockpit: '<path d="m12 2 2 8 8 5v2l-9-2v4l3 2H8l3-2v-4l-9 2v-2l8-5 2-8Z"/>',
  ventricle: '<path d="M12 21 9 17l-7 1v-3l7-5V7c0-4 6-4 6 0v3l7 5v3l-7-1-3 4Z"/><path d="M12 13s-4-3-4-5a2 2 0 0 1 4-1 2 2 0 0 1 4 1c0 2-4 5-4 5Z"/>',
  heart: '<path d="M12 21S3 15 3 8a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 7-9 13-9 13Z"/><path d="M5 11h4l2-4 3 8 2-4h3"/>',
};
const icon = (name: keyof typeof paths) => '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+paths[name]+'</svg>';
const el = (id: string) => document.getElementById(id)!;

/** Reuse the actual inputs and handlers in the aircraft and signal setup screen. */
export function setupCompactGround(openRemoteCockpit: () => void) {
  document.body.classList.add("compact-ground");
  const internals = document.createElement("div");
  internals.id = "setup-internals"; internals.hidden = true; document.body.append(internals);
  const sourceControls = el("polar-source-controls"), beaconControls = el("beacon-source-controls");
  internals.append(el("accordion"), document.querySelector(".public-warning")!);
  const left = document.querySelector(".control-panel")!;
  left.prepend(sourceControls); sourceControls.hidden = false;
  el("polar-connect-nudge").hidden = true;
  el("connect-polar").innerHTML = icon("heart")+'<span data-polar-label>Connect Polar H10</span>';
  el("connect-polar").classList.remove("needs-attention");
  el("flight-gate-title").textContent = "Flight";
  el("ground-view-toggle").querySelector("strong")!.textContent = "Control tower";
  const remoteBar = document.createElement("div");
  remoteBar.className = "remote-connection-bar"; remoteBar.setAttribute("role", "group");
  remoteBar.setAttribute("aria-label", "Connect a remote device");
  const tower = document.createElement("button");
  tower.id = "connect-remote-tower"; tower.type = "button";
  tower.innerHTML = icon("tower")+'<span>Remote tower</span>'; tower.setAttribute("aria-haspopup", "dialog");
  const cockpit = document.createElement("button");
  cockpit.id = "connect-remote-cockpit"; cockpit.type = "button";
  cockpit.innerHTML = icon("cockpit")+'<span>Remote cockpit</span>'; cockpit.setAttribute("aria-haspopup", "dialog");
  cockpit.addEventListener("click", openRemoteCockpit);
  const phone = el("connect-phone-controller");
  phone.querySelector("strong")!.textContent = "Phone steering"; phone.setAttribute("aria-label", "Phone steering wheel");
  remoteBar.append(tower, cockpit, phone); document.querySelector(".unified-header")!.append(remoteBar);
  internals.append(el("remote-pilot"));
  const dialog = document.createElement("dialog");
  dialog.className = "remote-tower-dialog"; dialog.setAttribute("aria-label", "Connect a remote tower");
  const heading = document.createElement("h2"); heading.textContent = "Remote control tower";
  const close = document.createElement("button"); close.type = "button"; close.textContent = "Done";
  close.addEventListener("click", () => dialog.close());
  const room = document.createElement("p"); room.className = "remote-room-note";
  room.textContent = "Choose a tower you recognize. This public connection shares derived flight metrics; raw ECG stays local.";
  dialog.append(heading, beaconControls, room, close); document.body.append(dialog);
  tower.addEventListener("click", () => {
    (el("signal-source-beacon") as HTMLInputElement).click();
    beaconControls.hidden = false; dialog.showModal();
  });
  const sourceObserver = new MutationObserver(() => { if (sourceControls.hidden) sourceControls.hidden = false; });
  sourceObserver.observe(sourceControls, { attributes: true, attributeFilter: ["hidden"] });
  addEventListener("pagehide", () => sourceObserver.disconnect(), { once: true });
  const choices = document.createElement("div"); choices.className = "cardiac-aircraft-choices";
  choices.setAttribute("role", "group"); choices.setAttribute("aria-label", "Choose your cardiac aircraft");
  const select = el("ground-aircraft") as HTMLSelectElement;
  for (const { id, label } of AIRCRAFT_CATALOG) {
    const button = document.createElement("button"); button.type = "button"; button.dataset.aircraftChoice = id;
    button.setAttribute("aria-pressed", String(select.value === id)); button.disabled = select.disabled;
    button.innerHTML = icon(id === "cardiac-ventricle" ? "ventricle" : "cockpit")+'<span>'+label+'</span>';
    button.addEventListener("click", () => { select.value = id; select.dispatchEvent(new Event("change", { bubbles: true })); });
    choices.append(button);
  }
  document.querySelector(".aircraft-carousel-controls")!.after(choices);
  const metrics = document.createElement("section"); metrics.className = "altitude-metric-panel";
  metrics.setAttribute("aria-labelledby", "altitude-metric-title");
  const metricTitle = document.createElement("h2"); metricTitle.id = "altitude-metric-title"; metricTitle.textContent = "Controls altitude";
  const copy = document.createElement("p"); copy.textContent = "Choose what moves the plane up and down.";
  const widgetPanel = document.querySelector(".metric-widget-panel")!;
  metrics.append(metricTitle, copy, widgetPanel);
  left.after(metrics);
  el("scope-metric-selector").setAttribute("aria-label", "Metric driving plane altitude");
  const labels: Record<string,string> = { excitement_score: "Excite-O-Meter", heart_rate: "Heart rate", rr_interval: "RR interval", breathing_volume: "Breathing", rmssd: "HRV", ecg_local_power: "ECG power" };
  widgetPanel.querySelectorAll<HTMLButtonElement>("[data-scope-metric]").forEach(button => {
    const label=labels[button.dataset.scopeMetric!]; button.querySelector("strong")!.textContent=label; button.setAttribute("aria-label", label);
  });
  const right = document.querySelector(".avionics-display")!;
  internals.append(document.querySelector(".beacon-instrument")!, document.querySelector(".command-console")!);
  right.prepend(metrics);
  right.append(document.querySelector(".ecg-instrument")!);
  document.querySelector(".avionics-board")!.remove();
  el("ecg-instrument-title").textContent = "Selected signal";
}
