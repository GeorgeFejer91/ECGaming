import { PilotLobby, type PilotMessage, type PilotRequestMode, type Tower } from "./pilot-lobby";
import { randomToken } from "../vendor/brsp/src/brsp.js";
import type { TiltInvitation } from "./invitation";

export class PilotRequest {
  private lobby?: PilotLobby;
  private timer?: ReturnType<typeof setTimeout>;
  private discoveryTimer?: ReturnType<typeof setTimeout>;
  private readonly status = document.createElement("p");
  private readonly choices = document.createElement("div");
  private readonly diagnostics = document.createElement("dl");
  private readonly diagnosticValues = new Map<string, HTMLElement>();
  private readonly cancel = document.createElement("button");
  constructor(private form: HTMLFormElement, private hint: string, private accepted: (invitation: TiltInvitation, name: string) => void,
    private mode: PilotRequestMode = "pilot") {
    this.status.id = "pilot-request-status"; this.status.setAttribute("role", "status");
    this.choices.className = "pilot-tower-choices";
    this.diagnostics.className = "pilot-request-debug";
    this.diagnostics.setAttribute("aria-label", "Connection diagnostics");
    this.cancel.type = "button"; this.cancel.textContent = "Cancel request"; this.cancel.hidden = true;
    this.cancel.addEventListener("click", () => this.stop("Request cancelled."));
    form.append(this.status, this.choices, this.diagnostics, this.cancel);
    this.setDiagnostic("Site", location.host || "unknown");
    this.setDiagnostic("Target", this.hint ? `Ground Control ${this.hint}` : "Any open Ground Control");
    this.setDiagnostic("Security", isSecureContext ? "HTTPS ready" : "HTTPS required");
    this.setDiagnostic("Discovery", "Enter pilot name");
    this.setDiagnostic("Channel", "Not started");
    this.setDiagnostic("Request", "Not sent");
    form.querySelector("button[type=submit]")!.setAttribute("aria-label", this.mode === "cockpit" ? "Request cockpit" : "Request wheel");
    window.addEventListener("pagehide", () => this.stop(""));
  }
  start(name: string) {
    if (this.lobby) return;
    const lobby = this.lobby = new PilotLobby("pilot", this.hint), id = randomToken(12);
    let requestSent = false;
    this.lock(true); this.status.textContent = "Looking for Ground Control…";
    this.setDiagnostic("Discovery", this.hint ? `Scanning for ${this.hint}` : "Scanning this site");
    this.setDiagnostic("Channel", "Waiting for tower");
    this.setDiagnostic("Request", "Ready to send");
    this.discoveryTimer = setTimeout(() => {
      if (this.lobby !== lobby) return;
      const site = location.host || "this site";
      this.status.textContent = `Still looking for Ground Control on ${site}…`;
      this.setDiagnostic("Discovery", this.hint ? `No tower ${this.hint} found on ${site}` : `No tower found on ${site}`);
      this.setDiagnostic("Channel", "Open Ground Control in this same site");
      this.setDiagnostic("Request", "Not sent");
    }, 4_000);
    lobby.addEventListener("status", ((e: CustomEvent<string>) => {
      if (this.lobby !== lobby) return;
      this.status.textContent = e.detail;
      if (e.detail.startsWith("Connecting to Ground Control")) {
        this.clearDiscoveryTimer();
        this.setDiagnostic("Discovery", this.hint ? `Ground Control ${this.hint} found` : "Ground Control selected");
        this.setDiagnostic("Channel", e.detail);
      }
      else if (e.detail.startsWith("Could not")) this.setDiagnostic("Channel", e.detail);
      else if (e.detail.includes("Looking for Ground Control")) this.setDiagnostic("Discovery", this.hint ? `Scanning for ${this.hint}` : "Scanning this site");
    }) as EventListener);
    lobby.addEventListener("towers", ((e: CustomEvent<Tower[]>) => {
      if (this.lobby !== lobby) return;
      this.choices.replaceChildren();
      this.status.textContent = e.detail.length ? "Choose your Ground Control" : "Waiting for Ground Control to open…";
      if (e.detail.length) this.clearDiscoveryTimer();
      this.setDiagnostic("Discovery", e.detail.length ? `${e.detail.length} Ground Control window${e.detail.length === 1 ? "" : "s"} found` :
        this.hint ? `Target ${this.hint} not found yet` : "No Ground Control found yet");
      this.setDiagnostic("Channel", e.detail.length ? "Choose a tower" : "Waiting");
      for (const tower of e.detail) {
        const button = document.createElement("button"); button.type = "button"; button.textContent = tower.label;
        button.addEventListener("click", () => { this.choices.replaceChildren(); void lobby.select(tower.id); });
        this.choices.append(button);
      }
    }) as EventListener);
    lobby.addEventListener("peer", ((e: CustomEvent<string>) => {
      if (this.lobby !== lobby) return;
      this.clearDiscoveryTimer();
      this.setDiagnostic("Discovery", this.hint ? `Ground Control ${this.hint} found` : "Ground Control selected");
      this.setDiagnostic("Channel", "Request channel open");
      this.setDiagnostic("Request", "Sending");
      if (lobby.send(e.detail, { kind: "request", id, name, mode: this.mode })) {
        requestSent = true;
        this.status.textContent = this.mode === "cockpit" ? "Waiting for Ground Control to open the cockpit…" : "Waiting for Ground Control to let you fly…";
        this.setDiagnostic("Request", "Sent; check Ground Control");
      } else {
        this.setDiagnostic("Request", "Send failed");
        this.stop("Could not send your request. Try again.");
      }
    }) as EventListener);
    lobby.addEventListener("message", ((e: CustomEvent<{ message: PilotMessage }>) => {
      if (this.lobby !== lobby || e.detail.message.id !== id) return;
      const message = e.detail.message;
      if (message.kind === "accepted") {
        this.setDiagnostic("Request", "Accepted");
        this.stop(""); this.accepted(message.invitation, name);
      }
      else if (message.kind === "declined") {
        this.setDiagnostic("Request", "Declined");
        this.stop("Ground Control declined your request.");
      }
    }) as EventListener);
    lobby.addEventListener("closed", () => {
      if (this.lobby !== lobby) return;
      this.setDiagnostic("Channel", "Closed");
      if (requestSent) this.setDiagnostic("Request", "Connection closed before answer");
      this.stop("Connection closed. Try again.");
    });
    this.timer = setTimeout(() => {
      if (this.lobby !== lobby) return;
      this.setDiagnostic("Request", "No answer after 60 seconds");
      this.stop("No response yet. Try again.");
    }, 60_000);
    void lobby.start().catch(() => {
      if (this.lobby !== lobby) return;
      this.setDiagnostic("Discovery", "Connection failed");
      this.stop("Could not reach Ground Control. Try again.");
    });
  }
  private setDiagnostic(label: string, value: string) {
    let cell = this.diagnosticValues.get(label);
    if (!cell) {
      const row = document.createElement("div"), term = document.createElement("dt"), description = document.createElement("dd");
      term.textContent = label; row.append(term, description); this.diagnostics.append(row);
      cell = description; this.diagnosticValues.set(label, cell);
    }
    cell.textContent = value;
  }
  private lock(pending: boolean) {
    this.form.querySelector("input")!.disabled = pending;
    (this.form.querySelector("button[type=submit]") as HTMLButtonElement).disabled = pending;
    this.cancel.hidden = !pending;
  }
  private clearDiscoveryTimer() {
    clearTimeout(this.discoveryTimer);
    this.discoveryTimer = undefined;
  }
  stop(message: string) {
    clearTimeout(this.timer); this.clearDiscoveryTimer();
    const lobby = this.lobby; this.lobby = undefined; lobby?.stop();
    this.lock(false); this.choices.replaceChildren(); this.status.textContent = message;
  }
}
