/** Test-only two-page SDK adapter. Real browser BRSP/WebCrypto, deterministic transport. */
export function installTiltSdkFixture() {
  // Shared-context BroadcastChannel fixtures represent separate visible devices, not background tabs.
  // Tests can explicitly hide one device to exercise the application's visibility release.
  (window as any).testPageVisible = true;
  (window as any).testSdkStarts = 0;
  (window as any).motionPermissionRequests = 0;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => !(window as any).testPageVisible });
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (window as any).testPageVisible ? "visible" : "hidden" });
  const emit = (target: EventTarget, name: string, detail: unknown) => target.dispatchEvent(new CustomEvent(name, { detail }));
  class Channel extends EventTarget {
    readyState = "open";
    bufferedAmount = 0;
    bufferedAmountLowThreshold = 0;
    binaryType = "arraybuffer";
    constructor(readonly label: string, readonly sdk: SDK) { super(); }
    send(data: string) {
      const envelope = JSON.parse(data);
      if (envelope.type === "intent") (window as any).lastTestIntent = envelope.body.controls;
      this.sdk.post({ kind: "data", label: this.label, data });
    }
    close() { if (this.readyState === "closed") return; this.readyState = "closed"; emit(this, "close", {}); }
  }
  class SDK extends EventTarget {
    role = "controller";
    bus?: BroadcastChannel;
    streamId = "";
    channels = new Map<string, Channel>();
    async connect() { (window as any).testSdkStarts++; }
    post(message: Record<string, unknown>) { this.bus?.postMessage({ ...message, from: this.role }); }
    async joinRoom({ room }: { room: string }) {
      this.bus = new BroadcastChannel(`tilt-test-${room}`);
      this.bus.onmessage = ({ data }) => {
        if (data.from === this.role) return;
        if (data.kind === "find" && this.role === "target") this.announce({ streamID: this.streamId });
        if (data.kind === "listing") emit(this, "listing", { list: [{ streamID: data.streamId, UUID: "peer-link" }] });
        if (data.kind === "view" && this.role === "target") emit(this, "dataChannelOpen", { uuid: "peer-link" });
        if (data.kind === "channel" && this.role === "controller") {
          const channel = new Channel(data.label, this); this.channels.set(data.label, channel);
          emit(this, "channelOpen", { uuid: "peer-link", label: data.label, streamID: this.streamId, channel });
        }
        if (data.kind === "data") {
          const channel = this.channels.get(data.label);
          if (channel) channel.dispatchEvent(new MessageEvent("message", { data: data.data }));
        }
        if (data.kind === "gone") emit(this, "dataChannelClose", { uuid: "peer-link" });
      };
      this.post({ kind: "find" });
    }
    async announce({ streamID }: { streamID: string }) { this.role = "target"; this.streamId = streamID; this.post({ kind: "listing", streamId: streamID }); }
    async view(streamId: string) { this.streamId = streamId; this.post({ kind: "view" }); }
    async openChannel(_peer: string, label: string) {
      const channel = new Channel(`x-${label}`, this); this.channels.set(channel.label, channel);
      this.post({ kind: "channel", label: channel.label }); return channel;
    }
    async getPeerQuality() { return { relayed: false, rttMs: 1 }; }
    async disconnect() { this.post({ kind: "gone" }); this.bus?.close(); }
  }
  Object.defineProperty(window, "VDONinjaSDK", { configurable: true, writable: true, value: SDK });
  if (typeof DeviceOrientationEvent === "undefined") return; // Initial about:blank has no secure motion API.
  (window as any).orientationSample = { beta: 0, gamma: -40 };
  (window as any).sendOrientation = true;
  Object.defineProperty(screen.orientation, "angle", { configurable: true, get: () => 90 });
  Object.defineProperty(DeviceOrientationEvent, "requestPermission", { configurable: true, value: async () => {
    (window as any).motionPermissionRequests++;
    return (window as any).motionPermissionResult ?? "granted";
  } });
  setInterval(() => {
    if ((window as any).sendOrientation)
      window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", (window as any).orientationSample));
  }, 16);
}
