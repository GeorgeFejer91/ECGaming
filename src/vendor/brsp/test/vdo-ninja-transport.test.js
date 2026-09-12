import assert from "node:assert/strict";
import test from "node:test";

import {
  VDO_BRSP_CONTROL_CHANNEL,
  VDO_BRSP_STATE_CHANNEL,
  VdoNinjaTransport,
} from "../src/vdo-ninja-transport.js";

class MockChannel extends EventTarget {
  constructor(label, options = {}) {
    super();
    this.label = `x-${label}`;
    this.options = options;
    this.readyState = "open";
    this.bufferedAmount = 0;
    this.sent = [];
  }

  send(value) {
    this.sent.push(value);
  }

  close() {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.dispatchEvent(new Event("close"));
  }
}

class MockSdk extends EventTarget {
  constructor(options, listing = []) {
    super();
    this.options = options;
    this.listing = listing;
    this.calls = [];
    this.channels = new Map();
  }

  emit(type, detail) {
    const event = new Event(type);
    Object.defineProperty(event, "detail", { value: detail });
    this.dispatchEvent(event);
  }

  async connect() { this.calls.push(["connect"]); }

  async joinRoom(options) {
    this.calls.push(["joinRoom", options]);
    this.emit("listing", { list: this.listing });
  }

  async announce(options) { this.calls.push(["announce", options]); }

  async view(streamId, options) { this.calls.push(["view", streamId, options]); }

  async openChannel(peerKey, label, options) {
    this.calls.push(["openChannel", peerKey, label, options]);
    const channel = new MockChannel(label, options);
    this.channels.set(label, channel);
    return channel;
  }

  async disconnect() { this.calls.push(["disconnect"]); }
}

function eventOnce(target, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}; phase=${target.phase}`)), 2_000);
    target.addEventListener(type, (event) => {
      clearTimeout(timer);
      resolve(event.detail);
    }, { once: true });
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("constructing the adapter performs no network or SDK work", () => {
  let constructed = 0;
  const transport = new VdoNinjaTransport({
    role: "target",
    room: "brsp_no_auto_connection",
    sharedSecret: "generated-secret-with-enough-entropy",
    sdkFactory: () => { constructed += 1; return new MockSdk({}); },
  });
  assert.equal(constructed, 0);
  assert.equal(transport.phase, "idle");
});

test("target retains an early controller hello while the second lane is opening", async () => {
  const sdk = new MockSdk({});
  const stateGate = deferred();
  const original = sdk.openChannel.bind(sdk);
  sdk.openChannel = async (...args) => {
    const channel = await original(...args);
    if (args[1] === VDO_BRSP_STATE_CHANNEL) await stateGate.promise;
    return channel;
  };
  const transport = new VdoNinjaTransport({ role: "target", room: "brsp_early_hello_test", sharedSecret: "generated-secret-with-enough-entropy", sdkFactory: () => sdk });
  const order = [];
  transport.addEventListener("peeropen", () => order.push("open"));
  transport.addEventListener("controlmessage", event => order.push(event.detail.data));
  await transport.start();
  sdk.emit("dataChannelOpen", { uuid: "early-peer" });
  await nextTurn();
  sdk.channels.get(VDO_BRSP_CONTROL_CHANNEL).dispatchEvent(new MessageEvent("message", { data: "early hello" }));
  assert.deepEqual(order, []);
  stateGate.resolve(); await nextTurn();
  assert.deepEqual(order, ["open", "early hello"]);
  await transport.stop();
});

test("controller buffers early hello, bounds pre-open bytes, and drops closed-channel work", async () => {
  const sdk = new MockSdk({});
  const transport = new VdoNinjaTransport({ role: "controller", room: "brsp_early_controller_test", sharedSecret: "generated-secret-with-enough-entropy", sdkFactory: () => sdk });
  const order = [];
  transport.addEventListener("peeropen", () => order.push("open"));
  transport.addEventListener("controlmessage", event => order.push(event.detail.data));
  await transport.start();
  const control = new MockChannel(VDO_BRSP_CONTROL_CHANNEL);
  const state = new MockChannel(VDO_BRSP_STATE_CHANNEL);
  sdk.emit("channelOpen", { uuid: "early-peer", label: control.label, channel: control });
  control.dispatchEvent(new MessageEvent("message", { data: "early hello" }));
  assert.deepEqual(order, []);
  sdk.emit("channelOpen", { uuid: "early-peer", label: state.label, channel: state });
  assert.deepEqual(order, ["open", "early hello"]);
  await transport.stop();
  control.dispatchEvent(new MessageEvent("message", { data: "late" }));
  assert.deepEqual(order, ["open", "early hello"]);

  const bounded = new VdoNinjaTransport({ role: "controller", room: "brsp_early_bounded_test", sharedSecret: "generated-secret-with-enough-entropy", sdkFactory: () => new MockSdk({}) });
  await bounded.start();
  const large = new MockChannel(VDO_BRSP_CONTROL_CHANNEL);
  bounded.acceptControllerChannel({ uuid: "too-large", label: large.label, channel: large });
  large.dispatchEvent(new MessageEvent("message", { data: "x".repeat(16_385) }));
  assert.equal(large.readyState, "closed");
  assert.equal(bounded.peers.size, 0);
  await bounded.stop();
});

test("explicit Stop wins while Start is awaiting SDK connect", async () => {
  const connectGate = deferred();
  let sdk;
  const transport = new VdoNinjaTransport({
    role: "target",
    room: "brsp_cancel_connect_room",
    sharedSecret: "generated-secret-with-enough-entropy",
    sdkFactory: (options) => {
      sdk = new MockSdk(options);
      sdk.connect = async () => {
        sdk.calls.push(["connect"]);
        await connectGate.promise;
      };
      return sdk;
    },
  });
  const errors = [];
  transport.addEventListener("status", (event) => {
    if (event.detail.error) errors.push(event.detail.message);
  });

  const starting = transport.start();
  await nextTurn();
  assert.deepEqual(sdk.calls, [["connect"]]);
  const stopping = transport.stop();
  connectGate.resolve();

  const [startResult, stopResult] = await Promise.all([starting, stopping]);
  assert.equal(startResult.phase, "closed");
  assert.equal(stopResult.phase, "closed");
  assert.equal(transport.phase, "closed");
  assert.equal(sdk.calls.some(([name]) => name === "joinRoom"), false);
  assert.equal(sdk.calls.some(([name]) => name === "announce"), false);
  assert.deepEqual(errors, []);
});

test("explicit Stop wins while Start is awaiting room join and never views a listing", async () => {
  const joinGate = deferred();
  let sdk;
  const transport = new VdoNinjaTransport({
    role: "controller",
    room: "brsp_cancel_join_room",
    sharedSecret: "generated-secret-with-enough-entropy",
    sdkFactory: (options) => {
      sdk = new MockSdk(options, [{
        streamID: "brsp_target_cancelled",
        UUID: "cancelled-uuid",
        label: "Cancelled target",
      }]);
      sdk.joinRoom = async (joinOptions) => {
        sdk.calls.push(["joinRoom", joinOptions]);
        sdk.emit("listing", { list: sdk.listing });
        await joinGate.promise;
      };
      return sdk;
    },
  });

  const starting = transport.start();
  await nextTurn();
  assert.equal(sdk.calls.some(([name]) => name === "joinRoom"), true);
  assert.equal(transport.sources.size, 1, "the early listing arrived before cancellation");
  const stopping = transport.stop();
  joinGate.resolve();

  const [startResult, stopResult] = await Promise.all([starting, stopping]);
  assert.equal(startResult.phase, "closed");
  assert.equal(stopResult.phase, "closed");
  assert.equal(sdk.calls.some(([name]) => name === "view"), false);
  assert.equal(transport.sources.size, 0);
  assert.equal(transport.discoveryReady, false);
});

test("failed Start removes old SDK listeners and clears selection before retry", async () => {
  const sdks = [];
  let attempt = 0;
  const transport = new VdoNinjaTransport({
    role: "controller",
    room: "brsp_failed_start_retry_room",
    sharedSecret: "generated-secret-with-enough-entropy",
    sdkFactory: (options) => {
      attempt += 1;
      const listing = attempt === 1
        ? [{ streamID: "brsp_target_first", UUID: "first-uuid", label: "First target" }]
        : [{ streamID: "brsp_target_retry", UUID: "retry-uuid", label: "Retry target" }];
      const instance = new MockSdk(options, listing);
      if (attempt === 1) {
        instance.view = async (streamId, viewOptions) => {
          instance.calls.push(["view", streamId, viewOptions]);
          throw new Error("first view failed");
        };
        instance.disconnect = async () => {
          instance.calls.push(["disconnect"]);
          instance.emit("videoaddedtoroom", {
            streamID: "brsp_target_disconnect_stale",
            UUID: "disconnect-stale-uuid",
          });
        };
      }
      sdks.push(instance);
      return instance;
    },
  });

  await assert.rejects(transport.start(), /first view failed/);
  assert.equal(transport.phase, "error");
  assert.equal(transport.sources.size, 0, "disconnect-time stale events cannot repopulate discovery");
  assert.equal(transport.peers.size, 0);
  assert.equal(transport.selectedStreamId, "");
  assert.equal(transport.selectedPeerKey, "");
  assert.equal(transport.discoveryReady, false);

  sdks[0].emit("videoaddedtoroom", {
    streamID: "brsp_target_late_stale",
    UUID: "late-stale-uuid",
  });
  assert.equal(transport.sources.size, 0, "a failed SDK no longer has live listeners");

  const retryResult = await transport.start();
  assert.equal(retryResult.phase, "connecting-peer");
  assert.equal(sdks[1].calls.find(([name]) => name === "view")?.[1], "brsp_target_retry");
  assert.equal(transport.selectedStreamId, "brsp_target_retry");
  assert.deepEqual([...transport.sources.keys()], ["brsp_target_retry"]);

  sdks[0].emit("videoaddedtoroom", {
    streamID: "brsp_target_old_sdk_after_retry",
    UUID: "old-sdk-after-retry-uuid",
  });
  assert.deepEqual([...transport.sources.keys()], ["brsp_target_retry"]);
  await transport.stop();
});

test("target announces data-only and opens reliable control plus unordered zero-retry state", async () => {
  let sdk;
  const transport = new VdoNinjaTransport({
    role: "target",
    room: "brsp_target_room_1234",
    sharedSecret: "generated-secret-with-enough-entropy",
    sdkFactory: (options) => { sdk = new MockSdk(options); return sdk; },
  });
  await transport.start();
  assert.equal(sdk.options.password, "generated-secret-with-enough-entropy");
  assert.equal(sdk.calls.some(([name]) => name === "announce"), true);
  assert.equal(sdk.calls.some(([name]) => name === "view"), false);
  const opened = eventOnce(transport, "peeropen");
  sdk.emit("dataChannelOpen", { uuid: "controller-uuid" });
  assert.deepEqual(await opened, { peerKey: "controller-uuid" });
  assert.deepEqual(sdk.calls.filter(([name]) => name === "openChannel").map((call) => call.slice(2)), [
    [VDO_BRSP_CONTROL_CHANNEL, { ordered: true }],
    [VDO_BRSP_STATE_CHANNEL, { ordered: false, maxRetransmits: 0 }],
  ]);
  await transport.stop();
});

test("controller requests no audio or video and accepts the two custom channels", async () => {
  let sdk;
  const transport = new VdoNinjaTransport({
    role: "controller",
    room: "brsp_controller_room",
    sharedSecret: "generated-secret-with-enough-entropy",
    sdkFactory: (options) => {
      sdk = new MockSdk(options, [{
        streamID: "brsp_target_test_123",
        UUID: "target-uuid",
        label: "Test target",
      }]);
      return sdk;
    },
  });
  await transport.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const view = sdk.calls.find(([name]) => name === "view");
  assert.equal(view[1], "brsp_target_test_123");
  assert.deepEqual(view[2], {
    audio: false,
    video: false,
    downloads: false,
    allowresources: false,
    label: "BRSP controller",
  });
  const opened = eventOnce(transport, "peeropen");
  sdk.emit("channelOpen", {
    uuid: "target-uuid",
    streamID: "brsp_target_test_123",
    label: `x-${VDO_BRSP_CONTROL_CHANNEL}`,
    channel: new MockChannel(VDO_BRSP_CONTROL_CHANNEL, { ordered: true }),
  });
  sdk.emit("channelOpen", {
    uuid: "target-uuid",
    streamID: "brsp_target_test_123",
    label: `x-${VDO_BRSP_STATE_CHANNEL}`,
    channel: new MockChannel(VDO_BRSP_STATE_CHANNEL, { ordered: false, maxRetransmits: 0 }),
  });
  assert.deepEqual(await opened, { peerKey: "target-uuid" });
  await transport.stop();
});

test("multiple discovered targets require explicit selection and bind channels to that peer", async () => {
  let sdk;
  const transport = new VdoNinjaTransport({
    role: "controller",
    room: "brsp_multi_target_room",
    sharedSecret: "generated-secret-with-enough-entropy",
    sdkFactory: (options) => {
      sdk = new MockSdk(options, [
        { streamID: "brsp_target_alpha", UUID: "alpha-uuid", label: "Alpha" },
        { streamID: "brsp_target_beta", UUID: "beta-uuid", label: "Beta" },
      ]);
      return sdk;
    },
  });
  await transport.start();
  assert.equal(transport.phase, "selection-required");
  assert.equal(sdk.calls.some(([name]) => name === "view"), false);

  await transport.selectTarget("brsp_target_beta");
  assert.equal(sdk.calls.find(([name]) => name === "view")?.[1], "brsp_target_beta");
  sdk.emit("channelOpen", {
    uuid: "alpha-uuid",
    label: `x-${VDO_BRSP_CONTROL_CHANNEL}`,
    channel: new MockChannel(VDO_BRSP_CONTROL_CHANNEL),
  });
  assert.equal(transport.peers.has("alpha-uuid"), false, "a channel without streamID cannot bypass the UUID binding");

  const opened = eventOnce(transport, "peeropen");
  sdk.emit("channelOpen", {
    uuid: "beta-uuid",
    label: `x-${VDO_BRSP_CONTROL_CHANNEL}`,
    channel: new MockChannel(VDO_BRSP_CONTROL_CHANNEL),
  });
  sdk.emit("channelOpen", {
    uuid: "beta-uuid",
    label: `x-${VDO_BRSP_STATE_CHANNEL}`,
    channel: new MockChannel(VDO_BRSP_STATE_CHANNEL),
  });
  assert.deepEqual(await opened, { peerKey: "beta-uuid" });
  const closed = eventOnce(transport, "peerclose");
  sdk.emit("userLeft", { streamID: "brsp_target_beta" });
  assert.equal((await closed).peerKey, "beta-uuid", "stream departure closes the mapped UUID peer");
  await transport.stop();
});

test("an explicit target-selection failure keeps the live SDK retryable", async () => {
  let sdk;
  let failView = true;
  const transport = new VdoNinjaTransport({
    role: "controller",
    room: "brsp_selection_retry_room",
    sharedSecret: "generated-secret-with-enough-entropy",
    sdkFactory: (options) => {
      sdk = new MockSdk(options, [
        { streamID: "brsp_target_retry_alpha", UUID: "retry-alpha-uuid", label: "Retry alpha" },
        { streamID: "brsp_target_retry_beta", UUID: "retry-beta-uuid", label: "Retry beta" },
      ]);
      sdk.view = async (streamId, viewOptions) => {
        sdk.calls.push(["view", streamId, viewOptions]);
        if (failView) throw new Error("temporary explicit view failure");
      };
      return sdk;
    },
  });

  await transport.start();
  assert.equal(transport.phase, "selection-required");
  await assert.rejects(transport.selectTarget("brsp_target_retry_beta"), /temporary explicit view failure/);
  assert.equal(transport.phase, "selection-required");
  assert.equal(transport.selectedStreamId, "");
  assert.equal(transport.selectedPeerKey, "");
  assert.equal(sdk.calls.some(([name]) => name === "disconnect"), false, "the active discovery SDK remains owned");
  assert.equal((await transport.start()).phase, "selection-required", "Start cannot orphan the active SDK");

  failView = false;
  await transport.selectTarget("brsp_target_retry_alpha");
  assert.equal(transport.phase, "connecting-peer");
  assert.equal(transport.selectedStreamId, "brsp_target_retry_alpha");
  assert.equal(sdk.calls.filter(([name]) => name === "connect").length, 1);
  await transport.stop();
});

test("state lane retains only the newest pending frame under backpressure", async () => {
  let sdk;
  const transport = new VdoNinjaTransport({
    role: "target",
    room: "brsp_backpressure_room",
    sharedSecret: "generated-secret-with-enough-entropy",
    sdkFactory: (options) => { sdk = new MockSdk(options); return sdk; },
  });
  await transport.start();
  const opened = eventOnce(transport, "peeropen");
  sdk.emit("dataChannelOpen", { uuid: "controller-uuid" });
  await opened;
  const state = sdk.channels.get(VDO_BRSP_STATE_CHANNEL);
  state.bufferedAmount = 10;
  assert.equal(transport.sendState("controller-uuid", "old"), false);
  assert.equal(transport.sendState("controller-uuid", "new"), false);
  state.bufferedAmount = 0;
  state.dispatchEvent(new Event("bufferedamountlow"));
  assert.deepEqual(state.sent, ["new"]);
  await transport.stop();
});
