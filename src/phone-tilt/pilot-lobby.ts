import { loadTiltSdk } from "./link";
import { cleanPilotName } from "./pilot-name";
import { readTiltInvitation, type TiltInvitation } from "./invitation";
import { randomToken } from "../vendor/brsp/src/brsp.js";

// Public rendezvous only. No flight commands, ECG or private pairing material
// are broadcast here. An accepted request receives a fresh invitation over its
// own reliable WebRTC channel, then establishes the usual private BRSP session.
const ROOM = "ecgaming_pilot_requests_v1", PREFIX = "ecg_pilot_", CHANNEL = "ecg_pilot_request_v1";
const token = /^[A-Za-z0-9_-]{16}$/;
export const validTower = (value: string) => /^[A-Za-z0-9_]{8}$/.test(value);
export type PilotRequestMode = "pilot" | "cockpit";
export type PilotMessage = { kind: "request"; id: string; name: string; mode: PilotRequestMode } |
  { kind: "accepted"; id: string; invitation: TiltInvitation } |
  { kind: "declined" | "cancel"; id: string };
export function parsePilotMessage(data: unknown): PilotMessage | undefined {
  if (typeof data !== "string" || new TextEncoder().encode(data).length > 1024) return;
  try {
    const v = JSON.parse(data);
    if (!v || typeof v !== "object" || typeof v.id !== "string" || !token.test(v.id)) return;
    const keys = Object.keys(v).sort().join(",");
    if (v.kind === "request" && keys === "id,kind,mode,name" && typeof v.name === "string" && v.name && v.name === cleanPilotName(v.name) &&
      ["pilot", "cockpit"].includes(String(v.mode))) return v;
    if (["declined", "cancel"].includes(v.kind) && keys === "id,kind") return v;
    if (v.kind === "accepted" && keys === "id,invitation,kind" && v.invitation &&
      Object.keys(v.invitation).sort().join(",") === "room,secret" &&
      typeof v.invitation.room === "string" && typeof v.invitation.secret === "string" &&
      readTiltInvitation(new URLSearchParams(v.invitation).toString())) return v;
  } catch { /* Invalid public request. */ }
}
export interface Tower { id: string; label: string }
const emit = (target: EventTarget, name: string, detail: unknown) => target.dispatchEvent(new CustomEvent(name, { detail }));

export class PilotLobby extends EventTarget {
  readonly towerId = randomToken(8).slice(0, 8).replace(/-/g, "_");
  private sdk?: InstanceType<NonNullable<typeof globalThis.VDONinjaSDK>>;
  private abort?: AbortController;
  private peers = new Map<string, RTCDataChannel | null>();
  private sources = new Map<string, Tower>();
  private generation = 0;
  private selected = "";
  private selectedPeer = "";
  private settle?: ReturnType<typeof setTimeout>;
  private expiry?: ReturnType<typeof setInterval>;
  private advertise?: ReturnType<typeof setInterval>;
  private reconnect?: ReturnType<typeof setInterval>;
  private deadlines = new Map<string, number>();
  constructor(readonly role: "tower" | "pilot", private hint = "") { super(); }
  async start() {
    this.stop(); const generation = this.generation;
    await loadTiltSdk(); if (generation !== this.generation) return;
    const sdk = this.sdk = new globalThis.VDONinjaSDK!({ password: false, salt: ROOM });
    const abort = this.abort = new AbortController();
    const current = () => generation === this.generation && this.sdk === sdk;
    const listen = (name: string, callback: (detail: any) => void) => sdk.addEventListener(name, ((e: CustomEvent) => {
      if (current()) callback(e.detail);
    }) as EventListener, { signal: abort.signal });
    const source = (item: any) => {
      const stream = item?.streamID ?? item?.streamId ?? "";
      if (typeof stream !== "string" || !stream.startsWith(PREFIX) || !validTower(stream.slice(PREFIX.length)) || this.sources.size >= 32) return;
      const id = stream.slice(PREFIX.length);
      const fresh = !this.sources.has(id);
      this.sources.set(id, { id, label: `Ground Control ${id}` });
      if (this.role !== "pilot" || this.selected || !fresh) return;
      clearTimeout(this.settle);
      this.settle = setTimeout(() => {
        if (!current() || this.selected) return;
        const choices = [...this.sources.values()].filter(t => !this.hint || t.id === this.hint);
        if (choices.length === 1) void this.select(choices[0]!.id);
        else emit(this, "towers", choices);
      }, 350);
    };
    listen("listing", d => { for (const item of (Array.isArray(d?.list) ? d.list.slice(0, 64) : [d])) source(item); });
    listen("videoaddedtoroom", source);
    listen("dataChannelOpen", d => {
      if (this.role !== "tower" || typeof d?.uuid !== "string" || this.peers.has(d.uuid) || this.peers.size >= 8) return;
      const peer = d.uuid; this.peers.set(peer, null); this.deadlines.set(peer, performance.now() + 60_000);
      void sdk.openChannel(peer, CHANNEL, { ordered: true }).then(channel => {
        if (!current() || !this.peers.has(peer)) { channel.close(); return; }
        this.bind(peer, channel);
      }).catch(() => { if (current()) this.closePeer(peer); });
    });
    listen("channelOpen", d => {
      if (this.role !== "pilot" || !this.selected || ![CHANNEL, `x-${CHANNEL}`].includes(d?.label) ||
        (d.streamID && d.streamID !== PREFIX + this.selected) || typeof d.uuid !== "string" ||
        (this.selectedPeer && this.selectedPeer !== d.uuid) || this.peers.size) return;
      this.selectedPeer = d.uuid; this.bind(d.uuid, d.channel);
    });
    listen("dataChannelClose", d => this.closePeer(d?.uuid));
    listen("error", () => emit(this, "status", "Could not reach Ground Control. Try again."));
    this.expiry = setInterval(() => {
      for (const [peer, until] of this.deadlines) if (performance.now() >= until) this.closePeer(peer);
    }, 1000);
    try {
      await sdk.connect(); if (!current()) return;
      const room = `${ROOM}_${location.host.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 48)}`;
      await sdk.joinRoom({ room, password: false }); if (!current()) return;
      if (this.role === "tower") {
        const announce = () => void sdk.announce({ streamID: PREFIX + this.towerId, label: `Ground Control ${this.towerId}` }).catch(() => {});
        announce();
        this.advertise = setInterval(() => { if (current()) announce(); }, 2500);
      }
      if (current()) emit(this, "status", this.role === "tower" ? "ready" : "Looking for Ground Control…");
    } catch (error) { if (current()) { this.stop(); throw error; } }
  }
  async select(id: string) {
    if (!this.sdk || this.selected || !this.sources.has(id) || (this.hint && id !== this.hint)) return;
    this.selected = id;
    emit(this, "status", `Connecting to Ground Control ${id}…`);
    const sdk = this.sdk;
    const view = () => sdk.view(PREFIX + id, { audio: false, video: false, downloads: false, allowresources: false });
    clearInterval(this.reconnect);
    this.reconnect = setInterval(() => {
      if (!this.sdk || this.peers.size || this.selected !== id) { clearInterval(this.reconnect); return; }
      void view().catch(() => {});
    }, 1500);
    try { await view(); }
    catch { if (this.sdk === sdk) emit(this, "status", "Could not reach this tower. Try again."); }
  }
  private bind(peer: string, channel: RTCDataChannel) {
    if (!channel || typeof channel.addEventListener !== "function") { this.closePeer(peer); return; }
    this.peers.set(peer, channel);
    const open = () => { if (this.peers.get(peer) === channel) emit(this, "peer", peer); };
    channel.addEventListener("message", (event: MessageEvent) => {
      if (this.peers.get(peer) !== channel) return;
      const message = parsePilotMessage(event.data);
      if (!message) { this.closePeer(peer); return; }
      emit(this, "message", { peer, message });
    }, { signal: this.abort!.signal });
    channel.addEventListener("close", () => { if (this.peers.get(peer) === channel) this.closePeer(peer); }, { signal: this.abort!.signal });
    if (channel.readyState === "open") open(); else channel.addEventListener("open", open, { once: true, signal: this.abort!.signal });
  }
  send(peer: string, message: PilotMessage) {
    const channel = this.peers.get(peer), data = JSON.stringify(message);
    if (!channel || channel.readyState !== "open" || channel.bufferedAmount > 4096 || !parsePilotMessage(data)) return false;
    try { channel.send(data); return true; } catch { return false; }
  }
  closePeer(peer: string) {
    if (!this.peers.has(peer)) return;
    const channel = this.peers.get(peer); this.peers.delete(peer); this.deadlines.delete(peer);
    if (this.selectedPeer === peer) this.selectedPeer = "";
    channel?.close(); emit(this, "closed", peer);
  }
  stop() {
    ++this.generation; this.abort?.abort(); this.abort = undefined;
    clearTimeout(this.settle); clearInterval(this.expiry); clearInterval(this.advertise); clearInterval(this.reconnect);
    for (const peer of [...this.peers.keys()]) this.closePeer(peer);
    const sdk = this.sdk; this.sdk = undefined;
    this.sources.clear(); this.selected = this.selectedPeer = "";
    void sdk?.disconnect?.().catch(() => {});
  }
}
