import QRCode from "qrcode";
import { BreathLink, type BreathState } from "./link";
import { createBreathInvitation, breathControllerUrl, type BreathInvitation } from "./invitation";
import { BreathLobby, type BreathMessage } from "./breath-lobby";
import { cleanHostName } from "./breath-lobby";

export interface BreathPairHostOptions {
  root?: string;
  onSample?: (sample: { x: number; y: number; z: number; t: number }) => void;
  onState?: (state: BreathState) => void;
  onStatus?: (active: boolean, ready: boolean) => void;
}

/** Self-contained breath-screen pairing: name prompt, QR invitation, lobby announce and accept dialog. */
export class BreathPairHost {
  private readonly link = new BreathLink("target");
  private readonly lobby = new BreathLobby("host");
  private invitation: BreathInvitation | null = null;
  private name = "";
  private started = false;
  private starting = false;
  private busy = false;
  private accepting = "";
  private readonly requests = new Map<string, { id: string; row: HTMLElement }>();
  private nameDialog: HTMLDialogElement;
  private nameInput!: HTMLInputElement;
  private pairDialog: HTMLDialogElement;
  private qrCanvas!: HTMLCanvasElement;
  private pairLink!: HTMLAnchorElement;
  private requestDialog: HTMLDialogElement;
  private gateResolving = false;
  constructor(container: HTMLElement, private readonly options: BreathPairHostOptions) {
    this.name = this.storedName();
    this.nameDialog = this.buildNameDialog();
    this.pairDialog = this.buildPairDialog();
    this.requestDialog = this.buildRequestDialog();
    this.lobby.addEventListener("message", ((event: CustomEvent<{ peer: string; message: BreathMessage }>) => {
      this.handleLobbyMessage(event);
    }) as EventListener);
    this.lobby.addEventListener("closed", ((event: CustomEvent<string>) => {
      this.accepting = this.accepting === event.detail ? "" : this.accepting;
      if (this.requests.has(event.detail)) this.remove(event.detail);
    }) as EventListener);
    this.link.addEventListener("status", ((event: CustomEvent<{ active: boolean; ready: boolean }>) => {
      this.options.onStatus?.(event.detail.active, event.detail.ready);
    }) as EventListener);
    this.link.addEventListener("ready", () => this.options.onStatus?.(true, true));
    this.link.addEventListener("state", ((event: CustomEvent<BreathState>) => {
      if (!this.link.ready) return;
      this.options.onState?.(event.detail);
    }) as EventListener);
    container.append(this.nameDialog, this.pairDialog, this.requestDialog);
    requestAnimationFrame(() => {
      if (this.nameDialog.open) return;
      try { this.nameDialog.showModal(); } catch { this.nameDialog.open = true; }
      this.nameInput.focus();
    });
  }
  start() {
    if (this.started || this.starting) return;
    this.starting = true;
    void this.lobby.start().then(() => {
      this.started = true;
      this.lobby.setHostName(this.name);
    }).catch(() => {
      this.started = false;
    }).finally(() => {
      this.starting = false;
    });
  }
  stop() {
    this.link.stop({ emitStatus: false });
    this.lobby.stop();
  }
  pairUrl() {
    return this.invitation ? breathControllerUrl(location.href, this.invitation) : "";
  }
  private beginPairing() {
    const invitation = this.invitation ??= createBreathInvitation(this.name);
    if (!this.link.active) {
      this.link.pilotName = "Phone";
      void this.link.start(invitation);
    }
    this.showPairing(invitation);
  }
  private async handleLobbyMessage(event: CustomEvent<{ peer: string; message: BreathMessage }>) {
    const { peer, message } = event.detail;
    if (message.kind === "cancel") { if (this.requests.get(peer)?.id === message.id) this.lobby.closePeer(peer); return; }
    if (message.kind !== "request") { this.lobby.closePeer(peer); return; }
    if (this.requests.has(peer)) {
      if (this.requests.get(peer)!.id !== message.id) this.lobby.closePeer(peer);
      else this.lobby.send(peer, { kind: "received", id: message.id });
      return;
    }
    if (this.requests.size >= 8) { this.lobby.closePeer(peer); return; }
    const row = document.createElement("section"), text = document.createElement("p");
    text.textContent = `${message.name} wants to connect their breathing.`;
    const accept = document.createElement("button"), decline = document.createElement("button");
    accept.type = decline.type = "button"; accept.textContent = "Let them connect"; decline.textContent = "Decline";
    const controls = document.createElement("div"); controls.append(accept, decline);
    row.prepend(text); row.append(controls);
    this.requests.set(peer, { id: message.id, row }); this.requestDialog.append(row);
    this.lobby.send(peer, { kind: "received", id: message.id });
    accept.addEventListener("click", () => void this.accept(peer, message.id));
    decline.addEventListener("click", () => { if (!this.busy) this.decline(peer, message.id); });
    if (!this.requestDialog.open) this.requestDialog.showModal();
  }
  private async accept(peer: string, id: string) {
    if (this.busy || this.requests.get(peer)?.id !== id) return;
    this.busy = true; this.accepting = peer;
    await this.link.stop({ emitStatus: false });
    const invitation = this.invitation ??= createBreathInvitation(this.name);
    await this.link.start(invitation);
    if (!this.lobby.send(peer, { kind: "accepted", id, invitation })) return;
    this.showPairing(invitation);
    this.remove(peer);
    this.busy = false;
    this.accepting = "";
  }
  private decline(peer: string, id: string) {
    this.lobby.send(peer, { kind: "declined", id }); this.remove(peer);
    setTimeout(() => this.lobby.closePeer(peer), 1000);
  }
  private remove(peer: string) {
    this.requests.get(peer)?.row.remove(); this.requests.delete(peer);
    if (!this.requests.size && this.requestDialog.open) this.requestDialog.close();
  }
  private storedName() {
    try { return cleanHostName(localStorage.getItem("ecgaming-breath-host-name-v1") ?? ""); }
    catch { return ""; }
  }
  private buildNameDialog() {
    const dialog = document.createElement("dialog");
    dialog.className = "name-dialog";
    dialog.setAttribute("aria-label", "Who is your maker");
    const form = document.createElement("form"); form.method = "dialog";
    const title = document.createElement("h2"); title.textContent = "Who is your maker?";
    const copy = document.createElement("p"); copy.textContent = "This screen is the god a phone will approach. Name the maker whose breath the person keeps.";
    const label = document.createElement("label");
    const labelText = document.createElement("span"); labelText.textContent = "Your maker's name";
    this.nameInput = document.createElement("input");
    this.nameInput.type = "text"; this.nameInput.maxLength = 40; this.nameInput.required = true;
    this.nameInput.autocomplete = "off"; this.nameInput.placeholder = "Yahweh"; this.nameInput.value = this.name;
    const status = document.createElement("p"); status.className = "name-status"; status.setAttribute("role", "status");
    const save = document.createElement("button"); save.type = "submit"; save.className = "button primary"; save.textContent = "ANSWER";
    label.append(labelText, this.nameInput);
    form.append(title, copy, label, save, status);
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (this.gateResolving) return;
      const next = cleanHostName(this.nameInput.value);
      if (!next) { this.nameInput.value = ""; this.nameInput.reportValidity(); return; }
      this.name = next; this.nameInput.value = next; this.gateResolving = true;
      this.nameInput.disabled = save.disabled = true;
      status.textContent = "It's Yahweh or No Way!";
      status.classList.add("maker-verdict");
      try { localStorage.setItem("ecgaming-breath-host-name-v1", next); } catch { /* Persistence is helpful, not required. */ }
      window.setTimeout(() => {
        this.gateResolving = false;
        this.nameInput.disabled = save.disabled = false;
        status.classList.remove("maker-verdict");
        this.lobby.setHostName(next);
        this.start();
        this.beginPairing();
        if (dialog.open) dialog.close();
      }, 2600);
    });
    dialog.append(form);
    return dialog;
  }
  private buildPairDialog() {
    const dialog = document.createElement("dialog");
    dialog.className = "pair-dialog";
    dialog.setAttribute("aria-label", "Phone pairing");
    const content = document.createElement("div"); content.className = "pair-dialog-content";
    const header = document.createElement("header"); header.className = "pair-dialog-header";
    const title = document.createElement("h2"); title.textContent = "Pair Your Phone";
    const close = document.createElement("button"); close.type = "button"; close.textContent = "\u00D7"; close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => dialog.close());
    header.append(title, close);
    const body = document.createElement("div"); body.className = "pair-dialog-body";
    const instruction = document.createElement("p"); instruction.textContent = "Scan this QR code with your phone, or tap \u201COpen on Phone\u201D below.";
    this.qrCanvas = document.createElement("canvas");
    this.qrCanvas.width = 280; this.qrCanvas.height = 280;
    const containerEl = document.createElement("div"); containerEl.className = "qr-container";
    containerEl.append(this.qrCanvas);
    this.pairLink = document.createElement("a");
    this.pairLink.className = "button primary"; this.pairLink.href = "#"; this.pairLink.target = "_blank"; this.pairLink.rel = "noopener";
    this.pairLink.textContent = "Open on Phone";
    body.append(instruction, containerEl, this.pairLink);
    content.append(header, body);
    dialog.append(content);
    return dialog;
  }
  private buildRequestDialog() {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", "Breath requests");
    const title = document.createElement("h2"); title.textContent = "Phone requests";
    dialog.append(title);
    dialog.addEventListener("cancel", event => {
      event.preventDefault();
      if (!this.busy) for (const [peer, request] of this.requests) this.decline(peer, request.id);
    });
    return dialog;
  }
  private showPairing(invitation: BreathInvitation) {
    const url = breathControllerUrl(location.href, invitation);
    this.pairLink.href = url;
    void QRCode.toCanvas(this.qrCanvas, url, { width: 280, margin: 4, errorCorrectionLevel: "M" }).catch(() => {
      this.pairLink.textContent = "QR failed \u2014 open the link instead.";
    });
    if (!this.pairDialog.open) this.pairDialog.showModal();
  }
}