import QRCode from "qrcode";
import { remotePilotUrl } from "../protocol/remote-pilot";
import type { AircraftId } from "../game/aircraft";
import type { BroadcasterSnapshot } from "../protocol/remote";
import "./remote-pilot.css";

/** Local tower controls own the broadcast. The phone only receives flight telemetry. */
export class RemotePilotDialog {
  private readonly dialog = document.createElement("dialog");
  private readonly canvas = document.createElement("canvas");
  private readonly status = document.createElement("p");
  private readonly link = document.createElement("a");
  private readonly stop = document.createElement("button");
  private readonly retry = document.createElement("button");
  private request = 0;
  private url = "";

  constructor(private readonly startBroadcast: () => Promise<void>, stopBroadcast: () => Promise<void>, private readonly snapshot: () => BroadcasterSnapshot, private readonly aircraft: () => AircraftId) {
    this.dialog.className = "remote-pilot-dialog";
    this.dialog.setAttribute("aria-labelledby", "remote-pilot-title");
    const title = document.createElement("h2");
    title.id = "remote-pilot-title";
    title.textContent = "Remote pilot";
    const copy = document.createElement("p");
    copy.textContent = "Scan with your phone, connect to this tower, then start flying. Your phone steers left and right; this browser controls the metrics, height and speed.";
    this.status.setAttribute("role", "status");
    this.canvas.setAttribute("aria-label", "Scan to open the phone flight view");
    this.link.textContent = "Open phone flight view";
    this.link.target = "_blank";
    this.link.rel = "noopener";
    const copyLink = document.createElement("button");
    copyLink.textContent = "Copy link";
    copyLink.type = "button";
    copyLink.addEventListener("click", () => {
      if (!this.url) return;
      void navigator.clipboard?.writeText(this.url).then(() => { copyLink.textContent = "Copied"; }, () => { copyLink.textContent = "Use the link above"; });
    });
    this.stop.type = "button";
    this.stop.textContent = "Stop remote pilot";
    this.stop.addEventListener("click", () => void stopBroadcast());
    this.retry.type = "button";
    this.retry.textContent = "Start remote pilot";
    this.retry.addEventListener("click", () => void this.start());
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Back to tower";
    close.addEventListener("click", () => this.dialog.close());
    const actions = document.createElement("div");
    actions.className = "remote-pilot-actions";
    actions.append(copyLink, this.retry, this.stop, close);
    const note = document.createElement("p");
    note.className = "remote-pilot-note";
    note.textContent = "Uses the existing public data broadcast and an Internet connection. Closing this popup keeps the tower running. Stop remote pilot ends the broadcast.";
    this.dialog.append(title, copy, this.canvas, this.status, this.link, actions, note);
    document.body.append(this.dialog);
  }

  async open() {
    if (!this.dialog.open) this.dialog.showModal();
    await this.start();
  }
  private async start() {
    this.status.textContent = "Preparing your tower…";
    this.retry.disabled = true;
    try { await this.startBroadcast(); }
    finally { this.retry.disabled = false; this.update(this.snapshot()); }
  }
  update(state: BroadcasterSnapshot) {
    const active = state.phase === "broadcasting";
    this.stop.hidden = !active;
    this.retry.hidden = active;
    this.canvas.hidden = this.link.hidden = !active;
    if (!active) {
      this.request++;
      this.url = "";
      this.link.removeAttribute("href");
      this.status.textContent = state.phase === "connecting" ? "Connecting the tower…" : (state.message || "Start a Direct Polar broadcast to create your QR code.");
      return;
    }
    this.status.textContent = state.listenerCount ? `${state.listenerCount} flight receiver${state.listenerCount === 1 ? "" : "s"} connected · ${state.route}` : "Tower ready. Waiting for your phone.";
    const url = remotePilotUrl(location.href, { streamId: state.streamId, sessionId: state.sessionId, aircraftId: this.aircraft() });
    if (url === this.url) return;
    this.url = url;
    this.link.href = url;
    const request = ++this.request;
    // Local QR generation: no link or physiology sent to a QR image service.
    void QRCode.toCanvas(this.canvas, url, { width: 272, margin: 4, errorCorrectionLevel: "M" }).catch(() => {
      if (request === this.request) { this.canvas.hidden = true; this.status.textContent = "QR could not be drawn. Open or copy the link below."; }
    });
    if (["localhost", "127.0.0.1"].includes(location.hostname))
      this.status.textContent = "Local preview: open the hosted website to create a link your phone can reach.";
  }
}
