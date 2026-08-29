import { describe, expect, it } from "vitest";
import {
  POLAR_HUB_KIND,
  POLAR_HUB_VERSION,
  PolarBrowserHub,
  type PolarHubStatus,
} from "../src/polar/browser-hub";

class FakePolarSession {
  connectCalls = 0;
  disconnectCalls = 0;
  listener?: (event: any) => void;

  async connect(listener: (event: any) => void) {
    this.connectCalls += 1;
    this.listener = listener;
    listener({
      kind: "diagnostic",
      snapshot: {
        stage: "live",
        streamSetupAttempt: 1,
        streamSetupAttemptsTotal: 4,
      },
    });
    listener({ kind: "connection", connected: true });
  }

  async disconnect() {
    this.disconnectCalls += 1;
  }

  diagnosticSnapshot() {
    return { stage: "live" };
  }

  emit(event: any) {
    this.listener?.(event);
  }
}

class FakeHubChannel {
  readonly posts: unknown[] = [];
  private listener?: (event: MessageEvent<unknown>) => void;

  addEventListener(
    _type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ) {
    this.listener = listener;
  }

  removeEventListener() {
    this.listener = undefined;
  }

  postMessage(message: unknown) {
    this.posts.push(message);
  }

  emit(message: unknown) {
    this.listener?.({ data: message } as MessageEvent<unknown>);
  }

  close() {}
}

const timer = {
  setInterval: () => 1 as unknown as ReturnType<typeof setInterval>,
  clearInterval: () => {},
};

describe("central Polar browser hub", () => {
  it("shares one session among frontend listeners and publishes summaries only", async () => {
    const session = new FakePolarSession();
    const channel = new FakeHubChannel();
    let now = 1_000;
    const hub = new PolarBrowserHub({
      session,
      channel,
      timer,
      now: () => now,
    });
    const first: any[] = [];
    const second: any[] = [];

    await hub.connect((event) => first.push(event));
    await hub.connect((event) => second.push(event));
    now += 600;
    session.emit({ kind: "heart-rate", beatsPerMinute: 73 });
    now += 600;
    session.emit({
      kind: "ecg",
      microvolts: [120, -40, 90],
      streamHealth: { observedSampleRateHz: 130 },
    });
    now += 600;
    session.emit({
      kind: "accelerometer",
      samples: [{ x: 1, y: 2, z: 3 }],
      breathing: { ready: true },
    });

    expect(session.connectCalls).toBe(1);
    expect(second).toContainEqual(
      expect.objectContaining({
        kind: "connection",
        connected: true,
        sharedHub: true,
      }),
    );
    const latest = channel.posts.at(-1) as PolarHubStatus;
    expect(latest).toMatchObject({
      kind: POLAR_HUB_KIND,
      version: POLAR_HUB_VERSION,
      state: "live",
      heartRateBpm: 73,
      ecgRateHz: 130,
      breathingReady: true,
      physicalPolar: true,
    });
    expect(JSON.stringify(channel.posts)).not.toMatch(/microvolts|samples/);

    await hub.disconnect();
    expect(session.disconnectCalls).toBe(1);
    hub.destroy();
  });

  it("detects a fresh owner tab before opening another device chooser", async () => {
    const session = new FakePolarSession();
    const channel = new FakeHubChannel();
    const now = 10_000;
    const hub = new PolarBrowserHub({
      session,
      channel,
      timer,
      now: () => now,
    });
    channel.emit({
      kind: POLAR_HUB_KIND,
      version: POLAR_HUB_VERSION,
      ownerId: "ground-control-tab",
      state: "live",
      stage: "live",
      setupAttempt: 1,
      setupAttemptsTotal: 4,
      breathingReady: true,
      physicalPolar: true,
      sentAtEpochMs: now,
    });

    await expect(hub.connect(() => {})).rejects.toMatchObject({
      code: "POLAR_HUB_IN_USE",
      retryable: true,
    });
    expect(session.connectCalls).toBe(0);
    hub.destroy();
  });
});
