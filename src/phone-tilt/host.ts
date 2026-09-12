import QRCode from "qrcode";
import { createTiltInvitation, tiltControllerUrl } from "./invitation";
import type { TiltState } from "./controls";
import "./host.css";
import { decoratePhoneButton } from "./button";
import { getFlightSessionHub } from "../flight-session/hub";
import type { SourceId } from "../flight-session/contract";

export class PhoneTiltHost {
  private readonly hub = getFlightSessionHub();
  private readonly link = this.hub.phone;
  private readonly dialog = document.createElement("dialog");
  private readonly console = document.createElement("div");
  private readonly canvas = document.createElement("canvas");
  private readonly anchor = document.createElement("a");
  private readonly status = document.createElement("p");
  private readonly stopButton = document.createElement("button");
  private readonly newButton = document.createElement("button");
  private readonly copyButton = document.createElement("button");
  private readonly speed = document.createElement("input");
  private readonly abort = new AbortController();
  readonly button = document.createElement("button");
  private selected = false;
  private url = "";
  private qrRequest = 0;
  private monitor?: ReturnType<typeof setInterval>;
  private clearCockpitQr = () => {};
  private pairCockpit?: HTMLButtonElement;
  private readonly relayPanel = document.createElement("details");

  constructor(host: HTMLElement, private flying: () => boolean) {
    const buttonStatus = decoratePhoneButton(this.button);
    this.button.addEventListener("click", () => this.open());
    host.append(this.button);
    this.button.hidden = Boolean(this.hub.client);
    this.dialog.className = "phone-tilt-dialog";
    this.console.className = "phone-yoke-console";
    this.dialog.append(this.console);
    this.relayPanel.className = "flight-relay-panel";
    const settingsTitle = document.createElement("summary"); settingsTitle.textContent = "Flight settings";
    this.relayPanel.append(settingsTitle);
    this.dialog.setAttribute("aria-label", "Phone tilt controller");
    const title = document.createElement("h2"); title.textContent = "Phone steering";
    const copy = document.createElement("p");
    copy.textContent = "Scan to fly.";
    this.canvas.setAttribute("aria-label", "Scan to pair your phone as a tilt controller");
    this.canvas.hidden = true;
    this.anchor.textContent = "Open controller"; this.anchor.target = "_blank"; this.anchor.rel = "noopener noreferrer"; this.anchor.hidden = true;
    this.status.setAttribute("role", "status");
    this.status.textContent = "Create a code to pair one phone.";
    this.speed.type = "checkbox"; this.speed.checked = true;
    const speedLabel = document.createElement("label"); speedLabel.append(this.speed, " Forward/back tilt adjusts speed");
    speedLabel.className = "phone-only-option";
    this.copyButton.type = "button"; this.copyButton.textContent = "Copy link"; this.copyButton.hidden = true;
    this.copyButton.addEventListener("click", () => {
      if (this.url) void navigator.clipboard?.writeText(this.url).then(() => { this.copyButton.textContent = "Copied"; }, () => { this.status.textContent = "Use the Open controller link."; });
    });
    this.newButton.type = "button"; this.newButton.textContent = "New QR code";
    this.newButton.addEventListener("click", () => void this.pair());
    this.stopButton.type = "button"; this.stopButton.textContent = "Stop phone control"; this.stopButton.hidden = true;
    this.stopButton.addEventListener("click", () => this.stop());
    const close = document.createElement("button"); close.type = "button"; close.textContent = "Back to flight";
    close.addEventListener("click", () => this.dialog.close());
    const actions = document.createElement("div"); actions.className = "phone-tilt-actions";
    actions.append(close);
    const phoneActions = document.createElement("div"); phoneActions.className = "phone-tilt-actions phone-only-option";
    phoneActions.append(this.copyButton, this.newButton, this.stopButton);
    this.relayPanel.append(speedLabel, phoneActions);
    this.console.append(title, copy, this.canvas, this.status, this.anchor, actions, this.relayPanel);
    if (this.hub.coordinator) this.buildRelayPanel();
    document.body.append(this.dialog);
    this.link.addEventListener("status", (event: Event) => {
      const state = (event as CustomEvent).detail;
      this.status.textContent = state.message;
      this.stopButton.hidden = !this.selected;
      this.newButton.disabled = false;
      if (!state.active) this.clearQr();
      buttonStatus.textContent = this.selected ? (state.active ? "Pairing…" : "Disconnected · pair again") : "Scan QR · tilt to fly";
    });
    this.link.addEventListener("ready", () => {
      this.clearQr();
      this.status.textContent = "Phone connected. Ready to steer.";
      buttonStatus.textContent = "Connected";
    });
    this.link.addEventListener("state", (event: Event) => {
      const state = (event as CustomEvent<TiltState>).detail;
      if (this.link.ready) buttonStatus.textContent = state.active ? "Steering" : "Connected";
      if (this.link.ready && this.link.pilotName) this.status.textContent = `${this.link.pilotName} · Ready to steer`;
    });
    window.addEventListener("pagehide", () => { this.stop(); this.clearCockpitQr(); this.hub.stop("cockpit"); }, { signal: this.abort.signal });
  }
  open() {
    if (this.hub.client) return;
    this.dialog.classList.remove("cockpit-pairing-only");
    this.dialog.setAttribute("aria-label", "Phone tilt controller");
    if (!this.dialog.open) this.dialog.showModal();
    if (!this.selected) void this.pair();
  }
  openCockpit() {
    if (this.hub.client || !this.pairCockpit) return;
    this.dialog.classList.add("cockpit-pairing-only");
    this.dialog.setAttribute("aria-label", "Remote cockpit");
    this.relayPanel.open = true;
    if (!this.dialog.open) this.dialog.showModal();
    if (!this.hub.cockpit.active) this.pairCockpit.click();
  }
  read(): TiltState | undefined {
    if (!this.hub.client) { this.hub.speedEnabled = this.speed.checked; this.hub.flying = this.flying(); }
    return this.hub.readTilt();
  }
  private buildRelayPanel() {
    const section = document.createElement("section"); section.className = "flight-source-options";
    const source = document.createElement("select"); source.id = "flight-session-source";
    for (const [value, label] of [["ground", "Ground Control · current signal"], ["phone", "Phone controller · Polar H10"], ["cockpit", "Separate cockpit · Polar H10"]]) {
      const option = document.createElement("option"); option.value = value; option.textContent = label; source.append(option);
    }
    source.value = this.hub.signal.source;
    const label = document.createElement("label"); label.htmlFor = source.id; label.textContent = "ECG source";
    const info = document.createElement("p"); info.setAttribute("role", "status");
    const update = () => {
      const selected = this.hub.signal.source;
      const peer = selected === "ground" ? null : this.hub[selected];
      info.textContent = selected === "ground" ? "" :
        peer?.ready ? "Connect Polar H10 on that device." : "Waiting for device…";
    };
    source.addEventListener("change", () => { this.hub.selectSource(source.value as SourceId); update(); });
    for (const link of [this.hub.phone, this.hub.cockpit]) link.addEventListener("status", update, { signal: this.abort.signal });
    update();
    const pair = document.createElement("button"); pair.type = "button"; pair.textContent = "Pair separate cockpit";
    this.pairCockpit = pair;
    const stop = document.createElement("button"); stop.type = "button"; stop.textContent = "Disconnect cockpit"; stop.hidden = true;
    const canvas = document.createElement("canvas"); canvas.hidden = true; canvas.setAttribute("aria-label", "Scan to join the separate cockpit");
    const anchor = document.createElement("a"); anchor.textContent = "Open cockpit"; anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; anchor.hidden = true;
    const status = document.createElement("p"); status.setAttribute("role", "status");
    let request = 0;
    this.clearCockpitQr = () => { ++request; canvas.hidden = anchor.hidden = true; anchor.removeAttribute("href"); canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height); };
    pair.addEventListener("click", async () => {
      this.hub.stop("cockpit");
      this.clearCockpitQr();
      const generation = ++request;
      const invitation = createTiltInvitation();
      const url = new URL(tiltControllerUrl(location.href, invitation));
      url.pathname = url.pathname.replace(/controller\/$/, "session-cockpit/");
      pair.disabled = true; stop.hidden = false;
      await this.hub.pair("cockpit", invitation);
      if (generation !== request || !this.hub.cockpit.active) { pair.disabled = false; return; }
      anchor.href = url.href; anchor.hidden = false;
      try { await QRCode.toCanvas(canvas, url.href, { width: 272, margin: 4 }); if (generation === request) canvas.hidden = false; }
      catch { status.textContent = "Use the Open cockpit link."; }
      pair.disabled = false;
    });
    stop.addEventListener("click", () => { this.clearCockpitQr(); this.hub.stop("cockpit"); stop.hidden = true; });
    this.hub.cockpit.addEventListener("status", (event: Event) => {
      const detail = (event as CustomEvent).detail; status.textContent = detail.message;
      if (detail.ready || !detail.active) this.clearCockpitQr();
    }, { signal: this.abort.signal });
    section.append(label, source, info, pair, stop, canvas, anchor, status); this.relayPanel.append(section);
  }
  private clearQr() {
    ++this.qrRequest; this.url = "";
    this.canvas.hidden = this.anchor.hidden = this.copyButton.hidden = true;
    this.anchor.removeAttribute("href");
    this.canvas.getContext("2d")?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
  private async pair() {
    this.stop();
    if (!isSecureContext) { this.status.textContent = "Open the HTTPS website to pair a phone."; return; }
    this.selected = true; this.stopButton.hidden = false;
    this.newButton.disabled = true; this.copyButton.textContent = "Copy link";
    const invitation = createTiltInvitation();
    const url = tiltControllerUrl(location.href, invitation);
    this.url = url;
    const request = ++this.qrRequest;
    this.monitor = setInterval(() => this.read(), 100);
    await this.hub.pair("phone", invitation);
    if (request !== this.qrRequest || !this.link.active) return;
    this.anchor.href = url; this.anchor.hidden = this.copyButton.hidden = false;
    try {
      await QRCode.toCanvas(this.canvas, url, { width: 272, margin: 4, errorCorrectionLevel: "M" });
      if (request === this.qrRequest) this.canvas.hidden = false;
    } catch { if (request === this.qrRequest) this.status.textContent = "QR could not be drawn. Use Open controller or Copy link."; }
    this.newButton.disabled = false;
    if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname))
      this.status.textContent = "Local preview: use the hosted website for a QR code your phone can reach.";
  }
  stop() {
    this.selected = false;
    if (this.monitor !== undefined) clearInterval(this.monitor);
    this.monitor = undefined; this.clearQr(); this.hub.stop("phone");
  }
  dispose() { this.stop(); this.clearCockpitQr(); this.hub.stop("cockpit"); this.abort.abort(); this.dialog.remove(); this.button.remove(); }
}
