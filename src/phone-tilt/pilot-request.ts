import { PilotLobby, type PilotMessage, type Tower } from "./pilot-lobby";
import { randomToken } from "../vendor/brsp/src/brsp.js";
import type { TiltInvitation } from "./invitation";

export class PilotRequest {
  private lobby?: PilotLobby;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly status = document.createElement("p");
  private readonly choices = document.createElement("div");
  private readonly cancel = document.createElement("button");
  constructor(private form: HTMLFormElement, private hint: string, private accepted: (invitation: TiltInvitation, name: string) => void) {
    this.status.id = "pilot-request-status"; this.status.setAttribute("role", "status");
    this.choices.className = "pilot-tower-choices";
    this.cancel.type = "button"; this.cancel.textContent = "Cancel request"; this.cancel.hidden = true;
    this.cancel.addEventListener("click", () => this.stop("Request cancelled."));
    form.append(this.status, this.choices, this.cancel);
    form.querySelector("button[type=submit]")!.setAttribute("aria-label", "Request wheel");
    window.addEventListener("pagehide", () => this.stop(""));
  }
  start(name: string) {
    if (this.lobby) return;
    const lobby = this.lobby = new PilotLobby("pilot", this.hint), id = randomToken(12);
    this.lock(true); this.status.textContent = "Looking for Ground Control…";
    lobby.addEventListener("status", ((e: CustomEvent<string>) => { if (this.lobby === lobby) this.status.textContent = e.detail; }) as EventListener);
    lobby.addEventListener("towers", ((e: CustomEvent<Tower[]>) => {
      if (this.lobby !== lobby) return;
      this.choices.replaceChildren();
      this.status.textContent = e.detail.length ? "Choose your Ground Control" : "Waiting for Ground Control to open…";
      for (const tower of e.detail) {
        const button = document.createElement("button"); button.type = "button"; button.textContent = tower.label;
        button.addEventListener("click", () => { this.choices.replaceChildren(); void lobby.select(tower.id); });
        this.choices.append(button);
      }
    }) as EventListener);
    lobby.addEventListener("peer", ((e: CustomEvent<string>) => {
      if (this.lobby !== lobby) return;
      if (lobby.send(e.detail, { kind: "request", id, name })) this.status.textContent = "Waiting for Ground Control to let you fly…";
      else this.stop("Could not send your request. Try again.");
    }) as EventListener);
    lobby.addEventListener("message", ((e: CustomEvent<{ message: PilotMessage }>) => {
      if (this.lobby !== lobby || e.detail.message.id !== id) return;
      const message = e.detail.message;
      if (message.kind === "accepted") { this.stop(""); this.accepted(message.invitation, name); }
      else if (message.kind === "declined") this.stop("Ground Control declined your request.");
    }) as EventListener);
    lobby.addEventListener("closed", () => { if (this.lobby === lobby) this.stop("Connection closed. Try again."); });
    this.timer = setTimeout(() => { if (this.lobby === lobby) this.stop("No response yet. Try again."); }, 60_000);
    void lobby.start().catch(() => { if (this.lobby === lobby) this.stop("Could not reach Ground Control. Try again."); });
  }
  private lock(pending: boolean) {
    this.form.querySelector("input")!.disabled = pending;
    (this.form.querySelector("button[type=submit]") as HTMLButtonElement).disabled = pending;
    this.cancel.hidden = !pending;
  }
  stop(message: string) {
    clearTimeout(this.timer); const lobby = this.lobby; this.lobby = undefined; lobby?.stop();
    this.lock(false); this.choices.replaceChildren(); this.status.textContent = message;
  }
}
