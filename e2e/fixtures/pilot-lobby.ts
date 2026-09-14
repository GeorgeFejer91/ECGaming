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
    sources = new Map<string, { uuid: string; label: string }>(); channels = new Map<string, Channel>();
    registry = "";
    async connect() { (window as any).testSdkStarts++; }
    post(message: Record<string, unknown>) { this.bus?.postMessage({ ...message, from: this.id }); }
    async joinRoom({ room }: { room: string }) {
      this.bus = new BroadcastChannel(`pilot-test-${room}`);
      this.registry = `pilot-test-${room}-sources`;
      this.bus.onmessage = ({ data: d }) => {
        if (d.to && d.to !== this.id) return;
        if (d.kind === "listing") {
          this.sources.set(d.stream, { uuid: d.from, label: d.label });
          emit(this, "listing", { list: [{ streamID: d.stream, UUID: d.from, label: d.label }] });
        }
        if (d.kind === "view") emit(this, "dataChannelOpen", { uuid: d.from });
        if (d.kind === "channel") {
          const channel = new Channel(this, d.from, d.label); this.channels.set(d.from, channel);
          emit(this, "channelOpen", { uuid: d.from, streamID: d.stream, label: d.label, channel });
        }
        if (d.kind === "data") {
          const dropNext = (window as any).pilotDropNextRequestBeforeDelivery;
          const loseNext = (window as any).pilotLoseNextRequestBeforeDelivery;
          if (dropNext && JSON.parse(d.data)?.kind === "request") {
            (window as any).pilotDropNextRequestBeforeDelivery = false;
            (window as any).pilotDroppedRequestCount = ((window as any).pilotDroppedRequestCount ?? 0) + 1;
            this.channels.get(d.from)?.close(); this.channels.delete(d.from); emit(this, "dataChannelClose", { uuid: d.from });
          } else if (loseNext && JSON.parse(d.data)?.kind === "request") {
            (window as any).pilotLoseNextRequestBeforeDelivery = false;
            (window as any).pilotLostRequestCount = ((window as any).pilotLostRequestCount ?? 0) + 1;
          } else this.channels.get(d.from)?.dispatchEvent(new MessageEvent("message", { data: d.data }));
        }
        if (d.kind === "close" || d.kind === "gone") {
          this.channels.get(d.from)?.close(); this.channels.delete(d.from); emit(this, "dataChannelClose", { uuid: d.from });
        }
      };
      // The signaling server returns one complete listing. Reading its simulated
      // registry avoids racing replies from background, WebGL-heavy tower tabs.
      const list = Object.entries(JSON.parse(localStorage.getItem(this.registry) ?? "{}"))
        .map(([streamID, value]) => {
          const source = typeof value === "string" ? { uuid: value, label: "" } : value as { uuid: string; label?: string };
          this.sources.set(streamID, { uuid: source.uuid, label: source.label ?? "" });
          return { streamID, UUID: source.uuid, label: source.label ?? "" };
        });
      emit(this, "listing", { list });
    }
    async announce({ streamID, label }: { streamID: string; label?: string }) {
      this.stream = streamID;
      const sources = JSON.parse(localStorage.getItem(this.registry) ?? "{}"); sources[streamID] = { uuid: this.id, label: label ?? "" };
      localStorage.setItem(this.registry, JSON.stringify(sources));
      this.post({ kind: "listing", stream: this.stream, label: label ?? "" });
    }
    async view(stream: string) { this.post({ kind: "view", to: this.sources.get(stream)?.uuid }); }
    async openChannel(peer: string, label: string) {
      const channel = new Channel(this, peer, `x-${label}`); this.channels.set(peer, channel);
      this.post({ kind: "channel", to: peer, label: channel.label, stream: this.stream }); return channel;
    }
    async disconnect() {
      if (this.registry && this.stream) {
        const sources = JSON.parse(localStorage.getItem(this.registry) ?? "{}"); delete sources[this.stream];
        localStorage.setItem(this.registry, JSON.stringify(sources));
      }
      this.post({ kind: "gone" }); this.bus?.close(); this.bus = undefined;
    }
  }
  (window as any).VDONinjaSDK = function(options: { password?: unknown }) {
    return options.password === false ? new SDK() : new PrivateSDK(options);
  };
}
