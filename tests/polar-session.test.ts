import { describe, expect, it } from "vitest";
import {
  POLAR_COMMANDS,
  POLAR_UUIDS,
  PolarH10BrowserSession,
} from "../src/vendor/affect-tracker/polar-stream.js";

class FakeCharacteristic extends EventTarget {
  value: DataView<ArrayBufferLike> = new DataView(new ArrayBuffer(0));
  onStart?: () => void;
  onWrite?: (value: Uint8Array) => void;
  readBytes = new Uint8Array([88]);

  async startNotifications() {
    this.onStart?.();
    return this;
  }

  async stopNotifications() {
    return this;
  }

  async writeValueWithResponse(value: Uint8Array) {
    this.onWrite?.(Uint8Array.from(value));
  }

  async readValue() {
    return new DataView(
      this.readBytes.buffer,
      this.readBytes.byteOffset,
      this.readBytes.byteLength,
    );
  }

  dispatchBytes(bytes: Uint8Array) {
    this.value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.dispatchEvent(new Event("characteristicvaluechanged"));
  }
}

function ecgFrame() {
  const bytes = new Uint8Array(13);
  bytes[0] = 0x00;
  bytes[1] = 0x01;
  bytes[9] = 0x00;
  bytes.set([0x34, 0x12, 0x00], 10);
  return bytes;
}

function accelerometerFrame() {
  const bytes = new Uint8Array(16);
  bytes[0] = 0x02;
  bytes[1] = 0x02;
  bytes[9] = 0x01;
  const view = new DataView(bytes.buffer);
  view.setInt16(10, 15, true);
  view.setInt16(12, 1_000, true);
  view.setInt16(14, -20, true);
  return bytes;
}

function createPolarFixture({
  failFirstPmdDiscovery = false,
  emitHeartRate = true,
} = {}) {
  const control = new FakeCharacteristic();
  const pmdData = new FakeCharacteristic();
  const heartRate = new FakeCharacteristic();
  const battery = new FakeCharacteristic();
  const commands: number[][] = [];
  let pmdDiscoveryFailures = failFirstPmdDiscovery ? 1 : 0;
  let connectCalls = 0;

  const pmdService = {
    async getCharacteristic(uuid: string) {
      if (uuid === POLAR_UUIDS.pmdControl) return control;
      if (uuid === POLAR_UUIDS.pmdData) return pmdData;
      throw new DOMException("Characteristic unavailable", "NotFoundError");
    },
  };
  const heartRateService = {
    async getCharacteristic(uuid: string) {
      if (uuid === POLAR_UUIDS.heartRateMeasurement) return heartRate;
      throw new DOMException("Characteristic unavailable", "NotFoundError");
    },
  };
  const batteryService = {
    async getCharacteristic(uuid: string) {
      if (uuid === POLAR_UUIDS.batteryLevel) return battery;
      throw new DOMException("Characteristic unavailable", "NotFoundError");
    },
  };

  const device = new EventTarget() as EventTarget & {
    gatt: {
      connect: () => Promise<typeof server>;
      disconnect: () => void;
    };
  };
  const server = {
    connected: false,
    async getPrimaryService(uuid: string) {
      if (!server.connected)
        throw new DOMException(
          "GATT Server is disconnected. Cannot retrieve services.",
          "NetworkError",
        );
      if (uuid === POLAR_UUIDS.pmdService && pmdDiscoveryFailures > 0) {
        pmdDiscoveryFailures -= 1;
        server.connected = false;
        device.dispatchEvent(new Event("gattserverdisconnected"));
        throw new DOMException(
          "GATT Server is disconnected. Cannot retrieve services.",
          "NetworkError",
        );
      }
      if (uuid === POLAR_UUIDS.pmdService) return pmdService;
      if (uuid === POLAR_UUIDS.heartRateService) return heartRateService;
      if (uuid === POLAR_UUIDS.batteryService) return batteryService;
      throw new DOMException("Service unavailable", "NotFoundError");
    },
    disconnect() {
      if (!server.connected) return;
      server.connected = false;
      device.dispatchEvent(new Event("gattserverdisconnected"));
    },
  };
  device.gatt = {
    async connect() {
      connectCalls += 1;
      server.connected = true;
      return server;
    },
    disconnect() {
      server.disconnect();
    },
  };

  heartRate.onStart = () => {
    if (emitHeartRate)
      queueMicrotask(() =>
        heartRate.dispatchBytes(new Uint8Array([0x10, 72, 0x00, 0x04])),
      );
  };
  control.onWrite = (value) => {
    commands.push(Array.from(value));
    if (value[0] !== 0x02) return;
    queueMicrotask(() => {
      control.dispatchBytes(new Uint8Array([0xf0, value[0], value[1], 0x00]));
      pmdData.dispatchBytes(value[1] === 0x00 ? ecgFrame() : accelerometerFrame());
    });
  };

  return {
    commands,
    connectCalls: () => connectCalls,
    navigatorObject: {
      bluetooth: {
        async requestDevice() {
          return device;
        },
        async getAvailability() {
          return true;
        },
      },
      userActivation: { isActive: true },
      userAgent: "Chromium test",
    },
  };
}

describe("Polar browser session", () => {
  it("retries a disconnect during PMD discovery and requires live HR, ECG, and ACC", async () => {
    const fixture = createPolarFixture({ failFirstPmdDiscovery: true });
    const events: Array<Record<string, unknown>> = [];
    const session = new PolarH10BrowserSession({
      navigatorObject: fixture.navigatorObject as unknown as Navigator,
      secureContext: true,
      streamSetupRetryDelaysMs: [0],
      firstHeartRateTimeoutMs: 100,
      firstEcgTimeoutMs: 100,
      firstAccelerometerTimeoutMs: 100,
      controlResponseTimeoutMs: 100,
    });

    await session.connect((event: Record<string, unknown>) => events.push(event));

    expect(fixture.connectCalls()).toBe(2);
    expect(
      events.some(
        (event) =>
          event.kind === "status" &&
          String(event.message).includes("automatic reconnect"),
      ),
    ).toBe(true);
    const live = events.find(
      (event) => event.kind === "connection" && event.connected === true,
    ) as { streamHealth?: Record<string, number>; message?: string } | undefined;
    expect(live?.message).toContain("HR + 130 Hz ECG + 200 Hz ACC");
    expect(live?.streamHealth).toMatchObject({
      heartRateFrameCount: 1,
      frameCount: 1,
      accelerometerFrameCount: 1,
    });
    expect(fixture.commands).toContainEqual(Array.from(POLAR_COMMANDS.startEcg));
    expect(fixture.commands).toContainEqual(
      Array.from(POLAR_COMMANDS.startAccelerometer),
    );

    await session.disconnect();
  });

  it("does not declare the Polar live when heart-rate frames are absent", async () => {
    const fixture = createPolarFixture({ emitHeartRate: false });
    const events: Array<Record<string, unknown>> = [];
    const session = new PolarH10BrowserSession({
      navigatorObject: fixture.navigatorObject as unknown as Navigator,
      secureContext: true,
      streamSetupRetryDelaysMs: [],
      firstHeartRateTimeoutMs: 10,
      firstEcgTimeoutMs: 100,
      firstAccelerometerTimeoutMs: 100,
      controlResponseTimeoutMs: 100,
    });

    await expect(
      session.connect((event: Record<string, unknown>) => events.push(event)),
    ).rejects.toMatchObject({ code: "PMD_FIRST_HEART_RATE_TIMEOUT" });
    expect(
      events.some(
        (event) => event.kind === "connection" && event.connected === true,
      ),
    ).toBe(false);
  });

  it("fails closed when HR stalls even while ECG and ACC remain fresh", async () => {
    const events: Array<Record<string, unknown>> = [];
    const session = new PolarH10BrowserSession({
      navigatorObject: {} as Navigator,
      secureContext: true,
      now: () => 100,
      liveEcgTimeoutMs: 20,
    });
    session.onEvent = (event: Record<string, unknown>) => events.push(event);
    session.connected = true;
    session.stopRequested = false;
    session.liveRecoveryAttempts = 1;
    session.lastEcgFrameAtMs = 95;
    session.lastHeartRateFrameAtMs = 0;
    session.lastAccelerometerFrameAtMs = 95;

    await session.handleLiveEcgWatchdog();

    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "connection",
        connected: false,
        error: true,
        message: expect.stringContaining("heart rate"),
      }),
    );
    expect(session.diagnosticSnapshot()).toMatchObject({
      lastErrorCode: "POLAR_LIVE_SIGNAL_STALLED",
    });
  });

  it("uses Polar's canonical 200 Hz, 16-bit, 8G ACC setting order", () => {
    expect(POLAR_COMMANDS.startAccelerometer).toEqual([
      0x02, 0x02, 0x00, 0x01, 200, 0, 0x01, 0x01, 16, 0, 0x02, 0x01, 8,
      0,
    ]);
  });
});
