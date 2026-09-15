import { loadTiltSdk } from "../phone-tilt/link";
import { cleanDisplayName } from "../phone-tilt/pilot-name";
import { readBreathInvitation, type BreathInvitation } from "./invitation";
import { randomToken } from "../vendor/brsp/src/brsp.js";

// Public rendezvous for the breath handshake only. No breathing data or private
// pairing material is broadcast here: an accepted phone receives a fresh
// invitation over its own reliable WebRTC channel, then connects over the usual
// private BRSP session.
const ROOM = "ecgaming_breath_requests_v1", PREFIX = "ecg_breath_", CHANNEL = "ecg_breath_request_v1";
const token = /^[A-Za-z0-9_-]{16}$/;
export const validHost = (value: string) => /^[A-Za-z0-9_]{8}$/.test(value);
export type BreathMessage = { kind: "request"; id: string; name: string } |
  { kind: "accepted"; id: string; invitation: BreathInvitation } |
  { kind: "declined" | "cancel" | "received"; id: string };
export function parseBreathMessage(data: unknown): BreathMessage | undefined {
  if (typeof data !== "string" || new TextEncoder().encode(data).length > 1024) return;
  try {
    const v = JSON.parse(data);
    if (!v || typeof v !== "object" || typeof v.id !== "string" || !token.test(v.id)) return;
    const keys = Object.keys(v).sort().join(",");
    if (v.kind === "request" && keys === "id,kind,name" && typeof v.name === "string" && v.name && v.name === cleanDisplayName(v.name)) return v;
    if (["declined", "cancel", "received"].includes(v.kind) && keys === "id,kind") return v;
    if (v.kind === "accepted" && keys === "id,invitation,kind" && v.invitation &&
      typeof v.invitation === "object" &&
      ["maker,room,secret", "room,secret"].includes(Object.keys(v.invitation).sort().join(",")) &&
      typeof v.invitation.room === "string" && typeof v.invitation.secret === "string" &&
      (!("maker" in v.invitation) || typeof v.invitation.maker === "string") &&
      readBreathInvitation(new URLSearchParams(v.invitation).toString())) return v;
  } catch { /* Invalid public request. */ }
}
export const cleanHostName = cleanDisplayName;
export interface BreathHost { id: string; label: string; stream: string }
const emit = (target: EventTarget, name: string, detail: unknown) => target.dispatchEvent(new CustomEvent(name, { detail }));
const encodedLabel = /^[A-Za-z0-9_-]{1,96}$/;
const encodeHostLabel = (value: string) => {
  const bytes = new TextEncoder().encode(cleanHostName(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};
const decodeHostLabel = (value: string) => {
  if (!encodedLabel.test(value)) return "";
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
    return cleanHostName(new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0))));
  } catch { return ""; }
};
const hostStream = (id: string, label = "") => {
  const encoded = encodeHostLabel(label);
  return `${PREFIX}${id}${encoded ? `_${encoded}` : ""}`;
};
const parseHostStream = (stream: string): BreathHost | undefined => {
  if (typeof stream !== "string" || !stream.startsWith(PREFIX)) return;
  const body = stream.slice(PREFIX.length), id = body.slice(0, 8);
  if (!validHost(id)) return;
  const label = body[8] === "_" ? decodeHostLabel(body.slice(9)) : "";
  return { id, label, stream };
};

export class BreathLobby extends EventTarget {
  readonly hostId = randomToken(8).slice(0, 8).replace(/-/g, "_");
  private sdk?: InstanceType<NonNullable<typeof globalThis.VDONinjaSDK>>;
  private abort?: AbortController;
  private peers = new Map<string, RTCDataChannel | null>();
  private sources = new Map<string, BreathHost>();
  private generation = 0;
  private selected = "";
  private selectedPeer = "";
  private settle?: ReturnType<typeof setTimeout>;
  private expiry?: ReturnType<typeof setInterval>;
  private advertise?: ReturnType<typeof setInterval>;
  private reconnect?: ReturnType<typeof setInterval>;
  private deadlines = new Map<string, number>();
  private hostName = "";
  constructor(readonly role: "host" | "phone", private hint = "") { super(); }
  get label() { return this.hostName || `Breath Host ${this.hostId}`; }
  setHostName(value: string) {
    const next = cleanHostName(value);
    if (!next || next === this.hostName) return next;
    this.hostName = next;
    void this.announce();
    return next;
  }
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
      const host = parseHostStream(stream);
      if (!host || (!this.sources.has(host.id) && this.sources.size >= 32)) return;
      const id = host.id;
      const advertised = cleanHostName(typeof item?.label === "string" ? item.label : "");
      const legacyLabel = `Breath Host ${id}`;
      const label = host.label || (advertised !== legacyLabel ? advertised : "");
      if (!label) return;
      const fresh = !this.sources.has(id);
      this.sources.set(id, { id, label, stream: host.stream });
      if (this.role !== "phone" || this.selected || !fresh) return;
      clearTimeout(this.settle);
      this.settle = setTimeout(() => {
        if (!current() || this.selected) return;
        const choices = [...this.sources.values()].filter(t => !this.hint || t.id === this.hint || t.label === this.hint);
        if (choices.length === 1) void this.select(choices[0]!.id);
        else emit(this, "hosts", choices);
      }, 350);
    };
    listen("listing", d => { for (const item of (Array.isArray(d?.list) ? d.list.slice(0, 64) : [d])) source(item); });
    listen("videoaddedtoroom", source);
    listen("dataChannelOpen", d => {
      if (this.role !== "host" || typeof d?.uuid !== "string" || this.peers.has(d.uuid) || this.peers.size >= 8) return;
      const peer = d.uuid; this.peers.set(peer, null); this.deadlines.set(peer, performance.now() + 60_000);
      void sdk.openChannel(peer, CHANNEL, { ordered: true }).then(channel => {
        if (!current() || !this.peers.has(peer)) { channel.close(); return; }
        this.bind(peer, channel);
      }).catch(() => { if (current()) this.closePeer(peer); });
    });
    listen("channelOpen", d => {
      const stream = typeof d?.streamID === "string" ? d.streamID : typeof d?.streamId === "string" ? d.streamId : "";
      if (this.role !== "phone" || !this.selected || ![CHANNEL, `x-${CHANNEL}`].includes(d?.label) ||
        (stream && parseHostStream(stream)?.id !== this.selected) || typeof d.uuid !== "string" ||
        (this.selectedPeer && this.selectedPeer !== d.uuid) || this.peers.size) return;
      this.selectedPeer = d.uuid; this.bind(d.uuid, d.channel);
    });
    listen("dataChannelClose", d => this.closePeer(d?.uuid));
    listen("error", () => emit(this, "status", "Could not reach the breath screen. Try again."));
    this.expiry = setInterval(() => {
      for (const [peer, until] of this.deadlines) if (performance.now() >= until) this.closePeer(peer);
    }, 1000);
    try {
      await sdk.connect(); if (!current()) return;
      const room = `${ROOM}_${location.host.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 48)}`;
      await sdk.joinRoom({ room, password: false }); if (!current()) return;
      if (this.role === "host") {
        void this.announce();
        this.advertise = setInterval(() => { if (current()) void this.announce(); }, 2500);
      }
      if (current()) emit(this, "status", this.role === "host" ? "ready" : "Looking for the breath screen…");
    } catch (error) { if (current()) { this.stop(); throw error; } }
  }
  async select(id: string) {
    if (!this.sdk || this.selected || !this.sources.has(id) || (this.hint && id !== this.hint && this.sources.get(id)!.label !== this.hint)) return;
    const source = this.sources.get(id)!;
    this.selected = id;
    emit(this, "status", `Connecting to ${source.label}…`);
    const sdk = this.sdk;
    const view = () => sdk.view(source.stream, { audio: false, video: false, downloads: false, allowresources: false });
    clearInterval(this.reconnect);
    this.reconnect = setInterval(() => {
      if (!this.sdk || this.peers.size || this.selected !== id) { clearInterval(this.reconnect); return; }
      void view().catch(() => {});
    }, 1500);
    try { await view(); }
    catch { if (this.sdk === sdk) emit(this, "status", "Could not reach this breath screen. Try again."); }
  }
  private bind(peer: string, channel: RTCDataChannel) {
    if (!channel || typeof channel.addEventListener !== "function") { this.closePeer(peer); return; }
    this.peers.set(peer, channel);
    const open = () => { if (this.peers.get(peer) === channel) emit(this, "peer", peer); };
    channel.addEventListener("message", (event: MessageEvent) => {
      if (this.peers.get(peer) !== channel) return;
      const message = parseBreathMessage(event.data);
      if (!message) { this.closePeer(peer); return; }
      emit(this, "message", { peer, message });
    }, { signal: this.abort!.signal });
    channel.addEventListener("close", () => { if (this.peers.get(peer) === channel) this.closePeer(peer); }, { signal: this.abort!.signal });
    if (channel.readyState === "open") open(); else channel.addEventListener("open", open, { once: true, signal: this.abort!.signal });
  }
  send(peer: string, message: BreathMessage) {
    const channel = this.peers.get(peer), data = JSON.stringify(message);
    if (!channel || channel.readyState !== "open" || channel.bufferedAmount > 4096 || !parseBreathMessage(data)) return false;
    try { channel.send(data); return true; } catch { return false; }
  }
  private async announce() {
    if (this.role !== "host" || !this.sdk || !this.hostName) return;
    await this.sdk.announce({ streamID: hostStream(this.hostId, this.hostName), label: this.hostName }).catch(() => {});
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