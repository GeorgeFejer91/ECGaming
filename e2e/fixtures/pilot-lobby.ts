/** Addressed multi-peer public rendezvous; private pairing uses the existing BRSP fixture. */
export function installPilotLobbyFixture() {
  const PrivateSDK = (window as any).VDONinjaSDK;
  const emit = (target: EventTarget, name: string, detail: unknown) => target.dispatchEvent(new CustomEvent(name, { detail }));
  class Channel extends EventTarget {
    readyState = "open"; bufferedAmount = 0;
    constructor(readonly sdk: SDK, readonly peer: string, readonly label: string) { super(); }
    send(data: string) { this.sdk.post({ kind: "data", to: this.peer, label: this.label, data }); }
    close() {
      if (this.readyState === "closed") return;
      this.readyState = "closed"; this.sdk.post({ kind: "close", to: this.peer, label: this.label }); emit(this, "close", {});
    }
  }
  class SDK extends EventTarget {
    id = crypto.randomUUID(); stream = ""; bus?: BroadcastChannel;
    sources = new Map<string, string>(); channels = new Map<string, Channel>();
    async connect() { (window as any).testSdkStarts++; }
    post(message: Record<string, unknown>) { this.bus?.postMessage({ ...message, from: this.id }); }
    async joinRoom({ room }: { room: string }) {
      this.bus = new BroadcastChannel(`pilot-test-${room}`);
      this.bus.onmessage = ({ data: d }) => {
        if (d.to && d.to !== this.id) return;
        if (d.kind === "find" && this.stream) this.post({ kind: "listing", stream: this.stream, to: d.from });
        if (d.kind === "listing") { this.sources.set(d.stream, d.from); emit(this, "listing", { list: [{ streamID: d.stream, UUID: d.from }] }); }
        if (d.kind === "view") emit(this, "dataChannelOpen", { uuid: d.from });
        if (d.kind === "channel") {
          const channel = new Channel(this, d.from, d.label); this.channels.set(d.from, channel);
          emit(this, "channelOpen", { uuid: d.from, streamID: d.stream, label: d.label, channel });
        }
        if (d.kind === "data") this.channels.get(d.from)?.dispatchEvent(new MessageEvent("message", { data: d.data }));
        if (d.kind === "close" || d.kind === "gone") {
          this.channels.get(d.from)?.close(); this.channels.delete(d.from); emit(this, "dataChannelClose", { uuid: d.from });
        }
      };
      this.post({ kind: "find" });
    }
    async announce({ streamID }: { streamID: string }) { this.stream = streamID; this.post({ kind: "listing", stream: this.stream }); }
    async view(stream: string) { this.post({ kind: "view", to: this.sources.get(stream) }); }
    async openChannel(peer: string, label: string) {
      const channel = new Channel(this, peer, `x-${label}`); this.channels.set(peer, channel);
      this.post({ kind: "channel", to: peer, label: channel.label, stream: this.stream }); return channel;
    }
    async disconnect() { this.post({ kind: "gone" }); this.bus?.close(); this.bus = undefined; }
  }
  (window as any).VDONinjaSDK = function(options: { password?: unknown }) {
    return options.password === false ? new SDK() : new PrivateSDK(options);
  };
}
