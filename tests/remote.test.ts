import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FlightBroadcaster,
  FlightReceiver,
  FLIGHT_CHANNEL,
  FLIGHT_SOURCE_PREFIX,
  sanitizePilotName,
  SIGNAL_BEACON_CHANNEL,
} from "../src/protocol/remote";
import {
  decodeSignalBeaconFrame,
  encodeFlightFrame,
  encodeSignalBeaconFrame,
  FlightFlags,
  SignalBeaconFlags,
} from "../src/protocol/flight-frame";
import { DEFAULT_MAPPINGS } from "../src/signals/mappings";

class FakeChannel extends EventTarget {
  readyState = "open";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  binaryType = "arraybuffer";
  sent: unknown[] = [];
  send(value: unknown) {
    this.sent.push(value);
  }
  close() {
    this.readyState = "closed";
    this.dispatchEvent(new Event("close"));
  }
}
class FakeSdk extends EventTarget {
  channel = new FakeChannel();
  beaconChannel = new FakeChannel();
  sentData: { data: any; options: any }[] = [];
  announcements: any[] = [];
  viewed = "";
  viewCalls = 0;
  openCalls: string[] = [];
  async connect() {}
  async disconnect() {}
  async joinRoom() {}
  async announce(value: any) {
    this.announcements.push(value);
  }
  async view(id: string) {
    this.viewed = id;
    this.viewCalls += 1;
  }
  async stopViewing() {}
  async openChannel(_uuid: string, label: string) {
    expect([FLIGHT_CHANNEL, SIGNAL_BEACON_CHANNEL]).toContain(label);
    this.openCalls.push(label);
    const channel = new FakeChannel();
    if (label === FLIGHT_CHANNEL) this.channel = channel;
    else this.beaconChannel = channel;
    return channel as unknown as RTCDataChannel;
  }
  sendData(data: any, options: any) {
    this.sentData.push({ data, options });
    return true;
  }
  async getPeerQuality() {
    return { relayed: false, rttMs: 12 };
  }
  emit(type: string, detail: any) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
const frame = (sequence: number) =>
  encodeFlightFrame({
    sequence,
    beatCounter: sequence,
    altitude: 0.25,
    throttle: 0.5,
    traffic: 0.5,
    beatAgeMs: 20,
    quality: 0.9,
    flags: FlightFlags.controlReady,
  });

afterEach(() => vi.useRealTimers());
describe("VDO.Ninja flight bridge", () => {
  it("announces a safe pilot name and preserves it during discovery", async () => {
    const senderSdk = new FakeSdk();
    const sender = new FlightBroadcaster({
      sdkFactory: () => senderSdk as any,
    });
    await sender.start(DEFAULT_MAPPINGS, "  Captain <George>  ");
    expect(sanitizePilotName("  Captain <George>  ")).toBe("Captain George");
    expect(sender.snapshot().sourceLabel).toBe("Captain George");
    expect(senderSdk.announcements[0]).toMatchObject({
      label: "Captain George",
      meta: { pilotName: "Captain George" },
    });
    await sender.stop();

    const receiverSdk = new FakeSdk();
    const receiver = new FlightReceiver({
      sdkFactory: () => receiverSdk as any,
    });
    await receiver.startDiscovery();
    receiverSdk.emit("listing", {
      list: [
        {
          streamID: `${FLIGHT_SOURCE_PREFIX}named001`,
          UUID: "pilot-peer",
          label: "Captain George",
        },
      ],
    });
    expect(receiver.snapshot().sources[0]?.label).toBe("Captain George");
    await receiver.stop();
  });

  it("discovers one source, validates config, goes stale, and needs three frames to recover", async () => {
    vi.useFakeTimers();
    const sdk = new FakeSdk();
    const receiver = new FlightReceiver({ sdkFactory: () => sdk as any });
    await receiver.startDiscovery();
    const sourceId = `${FLIGHT_SOURCE_PREFIX}1234abcd`;
    sdk.emit("listing", { list: [{ streamID: sourceId, UUID: "peer-1" }] });
    await vi.advanceTimersByTimeAsync(300);
    expect(sdk.viewed).toBe(sourceId);
    sdk.emit("dataReceived", {
      uuid: "peer-1",
      streamID: sourceId,
      data: {
        kind: "ecgaming-flight-config",
        protocol: "ecgflightv1",
        schemaVersion: 1,
        sourceId,
        sessionId: "session",
        createdAt: new Date().toISOString(),
        mappings: DEFAULT_MAPPINGS,
      },
    });
    expect(receiver.snapshot().config?.sourceId).toBe(sourceId);
    expect(receiver.acceptFrame(frame(1))).toBe(true);
    expect(receiver.snapshot().phase).toBe("live");
    await vi.advanceTimersByTimeAsync(2000);
    expect(receiver.snapshot().phase).toBe("stale");
    receiver.acceptFrame(frame(2));
    receiver.acceptFrame(frame(3));
    expect(receiver.snapshot().phase).toBe("stale");
    receiver.acceptFrame(frame(4));
    expect(receiver.snapshot().phase).toBe("live");
    expect(receiver.snapshot().diagnostics.receivedFrames).toBe(4);
    await receiver.stop();
  });
  it("caps changed sends, uses latest-only backpressure, and delivers an immutable config", async () => {
    let now = 0;
    const sdk = new FakeSdk();
    const sender = new FlightBroadcaster({
      sdkFactory: () => sdk as any,
      now: () => now,
    });
    await sender.start(DEFAULT_MAPPINGS);
    sdk.emit("dataChannelOpen", { uuid: "peer-1" });
    await Promise.resolve();
    await Promise.resolve();
    expect(
      sdk.sentData.some((item) => item.data.kind === "ecgaming-flight-config"),
    ).toBe(true);
    const offer = (altitude: number) =>
      sender.offer(
        {
          beatCounter: 0,
          altitude,
          throttle: 0.5,
          traffic: 0.5,
          beatAgeMs: 9999,
          quality: 0.8,
          flags: FlightFlags.controlReady,
        },
        now,
      );
    expect(offer(0)).toBe(true);
    now = 1;
    expect(offer(0.2)).toBe(false);
    now = 17;
    expect(offer(0.3)).toBe(true);
    sdk.channel.bufferedAmount = 12;
    now = 34;
    expect(offer(0.4)).toBe(false);
    expect(sender.snapshot().droppedBackpressure).toBe(1);
    expect(sdk.channel.sent).toHaveLength(2);
    await sender.stop();
  });
  it("reopens both latest-state channels after either custom channel closes", async () => {
    vi.useFakeTimers();
    const sdk = new FakeSdk();
    const sender = new FlightBroadcaster({ sdkFactory: () => sdk as any });
    await sender.start(DEFAULT_MAPPINGS);
    sdk.emit("dataChannelOpen", { uuid: "peer-1" });
    await Promise.resolve();
    await Promise.resolve();
    expect(sdk.openCalls).toEqual([FLIGHT_CHANNEL, SIGNAL_BEACON_CHANNEL]);

    sdk.channel.close();
    await vi.advanceTimersByTimeAsync(250);
    expect(sdk.openCalls).toEqual([
      FLIGHT_CHANNEL,
      SIGNAL_BEACON_CHANNEL,
      FLIGHT_CHANNEL,
      SIGNAL_BEACON_CHANNEL,
    ]);
    expect(sender.snapshot()).toMatchObject({
      listenerCount: 1,
      beaconListenerCount: 1,
    });
    await sender.stop();
  });
  it("re-requests a selected view after stale command recovery is exhausted", async () => {
    vi.useFakeTimers();
    const sdk = new FakeSdk();
    const receiver = new FlightReceiver({ sdkFactory: () => sdk as any });
    await receiver.startDiscovery();
    const sourceId = `${FLIGHT_SOURCE_PREFIX}recover1`;
    sdk.emit("listing", { list: [{ streamID: sourceId, UUID: "peer-1" }] });
    await vi.advanceTimersByTimeAsync(300);
    expect(sdk.viewCalls).toBe(1);

    sdk.emit("connectionFailed", { streamID: sourceId, uuid: "peer-1" });
    await vi.advanceTimersByTimeAsync(750);
    expect(sdk.viewCalls).toBe(2);
    expect(receiver.snapshot().diagnostics.reconnectAttempts).toBe(1);
    await receiver.stop();
  });
  it("adds a separate derived-metric beacon with session fencing", async () => {
    vi.useFakeTimers();
    let now = 0;
    const sdk = new FakeSdk();
    const sender = new FlightBroadcaster({
      sdkFactory: () => sdk as any,
      now: () => now,
    });
    await sender.start(DEFAULT_MAPPINGS);
    sdk.emit("dataChannelOpen", { uuid: "peer-1" });
    await Promise.resolve();
    await Promise.resolve();
    const config = sdk.sentData.find(
      (item) => item.data.kind === "ecgaming-signal-config",
    )?.data;
    expect(config).toMatchObject({
      protocol: "ecgsignalv1",
      rawEcgIncluded: false,
    });
    expect(config.sessionToken).toBeGreaterThan(0);

    expect(
      sender.offerBeacon(
        {
          metrics: { heart_rate: 74, rr_interval: 811, excitement_score: 0.4 },
          ecgBeatCounter: 4,
          rrBeatCounter: 3,
          ecgBeatAgeMs: 18,
          rrBeatAgeMs: 42,
          ecgBeatQuality: 0.91,
          rrBeatQuality: 0.75,
          flags:
            SignalBeaconFlags.physicalPolar |
            SignalBeaconFlags.ecgStreamReady,
        },
        now,
      ),
    ).toBe(true);
    const decoded = decodeSignalBeaconFrame(
      sdk.beaconChannel.sent.at(-1),
    )!;
    expect(decoded.sessionToken).toBe(config.sessionToken);
    expect(decoded.metrics.heart_rate).toBeCloseTo(74);
    expect(decoded.ecgBeatCounter).toBe(4);
    expect(sdk.channel.sent).toHaveLength(0);
    await sender.stop();
  });
  it("exposes fresh beacon telemetry and rejects another session token", async () => {
    vi.useFakeTimers();
    const sdk = new FakeSdk();
    const receiver = new FlightReceiver({ sdkFactory: () => sdk as any });
    await receiver.startDiscovery();
    const sourceId = `${FLIGHT_SOURCE_PREFIX}beac0123`;
    sdk.emit("listing", { list: [{ streamID: sourceId, UUID: "peer-1" }] });
    await vi.advanceTimersByTimeAsync(300);
    sdk.emit("dataReceived", {
      uuid: "peer-1",
      streamID: sourceId,
      data: {
        kind: "ecgaming-signal-config",
        protocol: "ecgsignalv1",
        schemaVersion: 1,
        sourceId,
        sessionId: "beacon-session",
        sessionToken: 1234,
        metricOrder: [
          "excitement_score",
          "excitometer",
          "heart_rate",
          "rr_interval",
          "rmssd",
          "ln_rmssd",
          "sdnn",
          "ecg_local_power",
          "ecg_rms",
          "ecg_peak_to_peak",
        ],
        rawEcgIncluded: false,
      },
    });
    const beaconFrame = (sequence: number, sessionToken = 1234) =>
      encodeSignalBeaconFrame({
        sequence,
        sessionToken,
        metrics: { heart_rate: 68 },
        ecgBeatCounter: 2,
        rrBeatCounter: 2,
        ecgBeatAgeMs: 25,
        rrBeatAgeMs: 50,
        ecgBeatQuality: 0.9,
        rrBeatQuality: 0.8,
        flags: SignalBeaconFlags.physicalPolar,
      });
    expect(receiver.acceptBeaconFrame(beaconFrame(1))).toBe(true);
    expect(receiver.snapshot().beacon).toMatchObject({
      phase: "live",
      fresh: true,
      latest: { metrics: { heart_rate: 68 } },
    });
    expect(receiver.acceptBeaconFrame(beaconFrame(2, 9999))).toBe(false);
    sdk.emit("dataReceived", {
      uuid: "peer-1",
      streamID: sourceId,
      data: {
        ...receiver.snapshot().beacon.config,
        sessionId: "next-beacon-session",
        sessionToken: 5678,
      },
    });
    expect(receiver.snapshot().beacon).toMatchObject({
      phase: "ready",
      fresh: false,
    });
    expect(receiver.snapshot().beacon.latest).toBeUndefined();
    expect(receiver.acceptBeaconFrame(beaconFrame(2))).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(receiver.snapshot().beacon.phase).toBe("ready");
    expect(receiver.snapshot().beacon.fresh).toBe(false);
    await receiver.stop();
  });
});
