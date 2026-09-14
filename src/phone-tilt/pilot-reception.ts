import { getFlightSessionHub } from "../flight-session/hub";
import { createTiltInvitation } from "./invitation";
import type { TiltLink } from "./link";
import { cleanTowerName, PilotLobby, type PilotMessage } from "./pilot-lobby";
import "./host.css";

/** One reception desk per Ground Control page, independent of the 3D cockpit. */
class PilotReception extends EventTarget {
  readonly lobby = new PilotLobby("tower");
  private readonly hub = getFlightSessionHub();
  private readonly dialog = document.createElement("dialog");
  private readonly towerDialog = document.createElement("dialog");
  private readonly towerInput = document.createElement("input");
  private readonly towerSuggestions = document.createElement("datalist");
  private readonly towerStatus = document.createElement("p");
  private readonly requests = new Map<string, { id: string; row: HTMLElement }>();
  private readonly requested = new Set<string>();
  private readonly cockpitViewers = new Map<string, TiltLink>();
  private started = false;
  private starting = false;
  private monitor?: ReturnType<typeof setInterval>;
  private busy = false;
  private accepting = "";
  private name = "";
  private nameConfirmed = false;
  constructor() {
    super();
    this.name = this.storedTowerName();
    this.buildTowerNamePrompt();
    this.dialog.className = "pilot-request-dialog";
    this.dialog.setAttribute("aria-label", "Pilot requests");
    const title = document.createElement("h2"); title.textContent = "Take the wheel";
    this.dialog.append(title); document.body.append(this.dialog);
    this.dialog.addEventListener("cancel", event => {
      event.preventDefault();
      if (!this.busy) for (const [peer, request] of this.requests) this.decline(peer, request.id);
    });
    this.lobby.addEventListener("message", ((event: CustomEvent<{ peer: string; message: PilotMessage }>) => {
      const { peer, message } = event.detail;
      if (message.kind === "cancel") { if (this.requests.get(peer)?.id === message.id) this.lobby.closePeer(peer); return; }
      if (message.kind !== "request") { this.lobby.closePeer(peer); return; }
      if (this.requests.has(peer)) {
        if (this.requests.get(peer)!.id !== message.id) this.lobby.closePeer(peer);
        else this.lobby.send(peer, { kind: "received", id: message.id });
        return;
      }
      if (this.requested.has(peer)) { this.lobby.closePeer(peer); return; }
      if (this.requests.size >= 8) { this.lobby.closePeer(peer); return; }
      this.requested.add(peer);
      const row = document.createElement("section"), text = document.createElement("p");
      text.textContent = message.mode === "cockpit" ? `${message.name} wants to join the cockpit view.` : `${message.name} wants to take the wheel.`;
      const accept = document.createElement("button"), decline = document.createElement("button");
      accept.type = decline.type = "button"; accept.textContent = message.mode === "cockpit" ? "Open cockpit view" : "Let pilot fly"; decline.textContent = "Decline";
      const controls = document.createElement("div"); controls.append(accept, decline);
      if (message.mode === "pilot" && this.hub.phone.ready) {
        const replacement = document.createElement("p"); replacement.className = "pilot-replacement";
        replacement.textContent = `This hands over from ${this.hub.phone.pilotName || "the current pilot"}.`; row.append(replacement);
      }
      row.prepend(text); row.append(controls);
      this.requests.set(peer, { id: message.id, row }); this.dialog.append(row);
      this.lobby.send(peer, { kind: "received", id: message.id });
      accept.addEventListener("click", () => void this.accept(peer, message.id, message.mode));
      decline.addEventListener("click", () => { if (!this.busy) this.decline(peer, message.id); });
      this.setBusy(this.busy);
      if (!this.dialog.open) this.dialog.showModal();
    }) as EventListener);
    this.lobby.addEventListener("closed", ((event: CustomEvent<string>) => {
      this.requested.delete(event.detail);
      if (this.accepting === event.detail) { this.accepting = ""; this.hub.stop("phone"); }
      const viewer = this.cockpitViewers.get(event.detail);
      if (viewer && this.requests.has(event.detail)) { this.cockpitViewers.delete(event.detail); this.hub.stopCockpitViewer(viewer); }
      this.remove(event.detail);
    }) as EventListener);
    window.addEventListener("pagehide", () => {
      clearInterval(this.monitor); this.monitor = undefined;
      for (const viewer of this.cockpitViewers.values()) this.hub.stopCockpitViewer(viewer);
      this.cockpitViewers.clear();
      this.started = false; this.accepting = ""; this.lobby.stop(); this.hub.stop("phone");
    });
  }
  start() {
    if (!isSecureContext || window.top !== window.self) return;
    this.showTowerNamePrompt();
    if (!this.nameConfirmed) return;
    if (!this.monitor) this.monitor = setInterval(() => this.ensureStarted(), 2500);
    this.ensureStarted();
  }
  private ensureStarted() {
    if (this.started || this.starting || !this.hub.coordinator) return;
    this.starting = true;
    void this.lobby.start().then(() => {
      this.started = true;
    }).catch(() => {
      this.started = false;
    }).finally(() => {
      this.starting = false;
    });
  }
  url() {
    const url = new URL("../controller/", location.href);
    url.searchParams.set("tower", this.lobby.towerId);
    if (this.nameConfirmed) url.searchParams.set("towerName", this.name);
    return url.href;
  }
  cockpitUrl() {
    const url = new URL("../session-cockpit/", location.href);
    url.searchParams.set("tower", this.lobby.towerId);
    if (this.nameConfirmed) url.searchParams.set("towerName", this.name);
    return url.href;
  }
  get towerName() { return this.nameConfirmed ? this.name : ""; }
  private storedTowerName() {
    try { return cleanTowerName(localStorage.getItem("ecgaming-control-tower-name-v1") ?? ""); }
    catch { return ""; }
  }
  private buildTowerNamePrompt() {
    this.towerDialog.className = "tower-name-dialog";
    this.towerDialog.setAttribute("aria-label", "Name this Ground Control");
    const form = document.createElement("form"); form.method = "dialog";
    const title = document.createElement("h2"); title.textContent = "Name this Ground Control";
    const copy = document.createElement("p"); copy.textContent = "Pilots will choose this callsign from the steering wheel screen.";
    const label = document.createElement("label");
    const labelText = document.createElement("span"); labelText.textContent = "Ground Control callsign";
    this.towerInput.type = "text"; this.towerInput.maxLength = 32; this.towerInput.required = true;
    this.towerInput.autocomplete = "organization"; this.towerInput.placeholder = "Major Tom"; this.towerInput.value = this.name;
    this.towerInput.setAttribute("list", "tower-callsign-suggestions");
    this.towerSuggestions.id = "tower-callsign-suggestions";
    for (const value of ["Major Tom", "Starman", "Ziggy Station", "Blackstar Control", "Low Orbit"]) {
      const option = document.createElement("option"); option.value = value; this.towerSuggestions.append(option);
    }
    const save = document.createElement("button"); save.type = "submit"; save.textContent = "Transmit callsign";
    this.towerStatus.setAttribute("role", "status");
    if (this.name) this.towerStatus.textContent = "Confirm this callsign to broadcast this Ground Control.";
    label.append(labelText, this.towerInput);
    form.append(title, copy, label, this.towerSuggestions, save, this.towerStatus);
    form.addEventListener("submit", event => {
      event.preventDefault();
      const next = cleanTowerName(this.towerInput.value);
      if (!next) { this.towerInput.value = ""; this.towerInput.reportValidity(); return; }
      this.name = next; this.nameConfirmed = true; this.towerInput.value = next; this.towerStatus.textContent = `${next} is broadcasting to steering wheels.`;
      try { localStorage.setItem("ecgaming-control-tower-name-v1", next); } catch { /* Persistence is helpful, not required. */ }
      this.lobby.setTowerName(next);
      this.dispatchEvent(new CustomEvent("tower-name", { detail: next }));
      if (this.towerDialog.open) this.towerDialog.close();
      this.start();
    });
    this.towerDialog.append(form);
    document.body.append(this.towerDialog);
  }
  private showTowerNamePrompt() {
    if (this.nameConfirmed || this.towerDialog.open) return;
    try { this.towerDialog.show(); }
    catch { this.towerDialog.open = true; }
    this.towerInput.focus();
  }
  private setBusy(value: boolean) {
    this.busy = value;
    this.dialog.querySelectorAll("button").forEach(button => { button.disabled = value; });
  }
  private remove(peer: string) {
    this.requests.get(peer)?.row.remove(); this.requests.delete(peer);
    if (!this.requests.size && this.dialog.open) this.dialog.close();
  }
  private decline(peer: string, id: string) {
    this.lobby.send(peer, { kind: "declined", id }); this.remove(peer);
    // Allow the reliable response to reach the phone before dropping this peer.
    setTimeout(() => this.lobby.closePeer(peer), 1000);
  }
  private async accept(peer: string, id: string, mode: "pilot" | "cockpit") {
    if (this.busy || this.requests.get(peer)?.id !== id) return;
    this.setBusy(true); this.accepting = peer;
    const invitation = createTiltInvitation();
    try {
      const viewer = mode === "cockpit" ? await this.hub.pairCockpitViewer(invitation) : undefined;
      if (viewer) this.cockpitViewers.set(peer, viewer);
      else await this.hub.pair("phone", invitation);
      if (this.accepting !== peer || !this.requests.has(peer) || (mode === "pilot" && !this.hub.phone.active)) {
        if (viewer) this.hub.stopCockpitViewer(viewer);
        return;
      }
      if (!this.lobby.send(peer, { kind: "accepted", id, invitation })) {
        if (viewer) this.hub.stopCockpitViewer(viewer);
        else this.hub.stop("phone");
        return;
      }
      if (viewer) this.cockpitViewers.delete(peer);
      this.accepting = ""; this.remove(peer);
    } finally { this.accepting = ""; this.setBusy(false); }
  }
}
const receptionKey = "__ecgamingPilotReception";
export const getPilotReception = () => {
  const global = globalThis as typeof globalThis & { [receptionKey]?: PilotReception };
  return global[receptionKey] ??= new PilotReception();
};
