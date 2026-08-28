import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FlightBroadcaster,
  FlightReceiver,
  FLIGHT_CHANNEL,
  FLIGHT_SOURCE_PREFIX,
} from "../src/protocol/remote";
import { encodeFlightFrame, FlightFlags } from "../src/protocol/flight-frame";
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
  sentData: { data: any; options: any }[] = [];
  viewed = "";
  async connect() {}
  async disconnect() {}
  async joinRoom() {}
  async announce() {}
  async view(id: string) {
    this.viewed = id;
  }
  async stopViewing() {}
  async openChannel(_uuid: string, label: string) {
    expect(label).toBe(FLIGHT_CHANNEL);
    return this.channel as unknown as RTCDataChannel;
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
});
