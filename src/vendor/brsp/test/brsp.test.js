import assert from "node:assert/strict";
import test from "node:test";

import {
  BRSPConnection,
  BRSP_CONTROL_MAX_BYTES,
  canonicalStringify,
  createHelloEnvelope,
  createProofEnvelope,
  decodeEnvelope,
  encodeEnvelope,
  isNewerSequence,
  makeEnvelope,
  negotiateSession,
  verifyProofEnvelope,
} from "../src/brsp.js";

class MockTransport extends EventTarget {
  constructor() {
    super();
    this.other = undefined;
    this.peerKey = "peer-link";
    this.closed = false;
    this.blockControl = false;
    this.blockState = false;
    this.sentControl = [];
    this.sentState = [];
    this.dropControl = undefined;
  }

  connect(other) {
    this.other = other;
    other.other = this;
  }

  open() {
    this.dispatch("peeropen", { peerKey: this.peerKey });
  }

  dispatch(type, detail) {
    const event = new Event(type);
    Object.defineProperty(event, "detail", { value: detail });
    this.dispatchEvent(event);
  }

  sendControl(peerKey, data) {
    if (this.closed || this.blockControl || peerKey !== this.peerKey) return false;
    this.sentControl.push(data);
    if (this.dropControl?.(data)) return true;
    queueMicrotask(() => this.other.dispatch("controlmessage", { peerKey, data }));
    return true;
  }

  sendState(peerKey, data) {
    if (this.closed || this.blockState || peerKey !== this.peerKey) return false;
    this.sentState.push(data);
    queueMicrotask(() => this.other.dispatch("statemessage", { peerKey, data }));
    return true;
  }

  closePeer(peerKey) {
    if (peerKey === this.peerKey) this.closed = true;
  }

  async stop() {
    this.closed = true;
  }
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

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

test("canonical encoding is deterministic and rejects malformed envelopes", () => {
  assert.equal(canonicalStringify({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');
  const hello = createHelloEnvelope({
    role: "target",
    sessionId: "session_12345678",
    senderId: "target_12345678",
    senderEpoch: 7,
    capabilities: ["state", "ack"],
    grantedScopes: ["scene.write"],
  });
  const encoded = encodeEnvelope(hello);
  assert.deepEqual(decodeEnvelope(encoded), hello);
  assert.equal(decodeEnvelope("{}"), undefined);
  assert.equal(decodeEnvelope("x".repeat(BRSP_CONTROL_MAX_BYTES + 1)), undefined);
  assert.throws(() => canonicalStringify(new Date()), /JSON-compatible/);
  assert.throws(() => canonicalStringify(new Map()), /JSON-compatible/);
  assert.throws(() => canonicalStringify(new (class Payload { constructor() { this.value = 1; } })()), /JSON-compatible/);
  assert.throws(() => canonicalStringify(Object.defineProperty({}, "value", {
    enumerable: true,
    get() { return 1; },
  })), /data property/);
});

test("canonical encoding accepts only dense plain arrays with own data entries", () => {
  assert.equal(canonicalStringify([1, [true, null], "value"]), '[1,[true,null],"value"]');

  const sparse = new Array(1);
  assert.throws(() => canonicalStringify(sparse), /dense array/);

  let getterCalled = false;
  const accessor = [];
  Object.defineProperty(accessor, "0", {
    enumerable: true,
    get() {
      getterCalled = true;
      return "unsafe";
    },
  });
  assert.throws(() => canonicalStringify(accessor), /data property/);
  assert.equal(getterCalled, false, "array accessors are rejected without being invoked");

  class CustomArray extends Array {}
  assert.throws(() => canonicalStringify(new CustomArray(1, 2)), /plain array/);

  const extraProperty = [1];
  extraProperty.label = "not-json-array-data";
  assert.throws(() => canonicalStringify(extraProperty), /extra array properties/);

  const symbolProperty = [1];
  symbolProperty[Symbol("metadata")] = true;
  assert.throws(() => canonicalStringify(symbolProperty), /extra array properties/);

  let capabilityGetterCalled = false;
  const accessorCapabilities = [];
  Object.defineProperty(accessorCapabilities, "0", {
    enumerable: true,
    get() {
      capabilityGetterCalled = true;
      return "state";
    },
  });
  assert.throws(() => createHelloEnvelope({
    role: "target",
    sessionId: "session_accessor_array",
    senderId: "target_accessor_array",
    senderEpoch: 1,
    capabilities: accessorCapabilities,
  }), /data property/);
  assert.equal(capabilityGetterCalled, false, "typed envelope construction also rejects array accessors without invoking them");
});

test("peer-open control failure enters protocol error without leaking the attach rejection", async () => {
  const transport = new MockTransport();
  transport.blockControl = true;
  const connection = new BRSPConnection({
    transport,
    role: "target",
    sessionId: "session_start_failure",
    sharedSecret: "startup-failure-secret-with-entropy",
    peerId: "target_start_failure",
  });
  const phaseChange = eventOnce(connection, "phasechange");
  const protocolError = eventOnce(connection, "protocolerror");

  transport.open();

  const [phaseDetail, errorDetail] = await Promise.all([phaseChange, protocolError]);
  assert.equal(connection.phase, "error");
  assert.equal(phaseDetail.phase, "error");
  assert.equal(errorDetail.phase, "error");
  assert.match(errorDetail.message, /control lane is unavailable or backpressured/i);
  assert.equal(transport.closed, true, "startup protocol errors close the selected peer");
  await settle();
  await connection.close();
});

test("unsigned half-range sequence ordering handles wraparound", () => {
  assert.equal(isNewerSequence(0, 0xffff_ffff), true);
  assert.equal(isNewerSequence(10, 9), true);
  assert.equal(isNewerSequence(9, 10), false);
  assert.equal(isNewerSequence(10, 10), false);
  assert.equal(isNewerSequence(0x8000_0000, 0), false);
});

test("mutual HMAC proofs bind both hello messages and the sender role", async () => {
  const secret = "a-generated-secret-with-enough-entropy";
  const targetHello = createHelloEnvelope({
    role: "target",
    sessionId: "session_abcdefgh",
    senderId: "target_abcdefgh",
    senderEpoch: 1,
    capabilities: ["ack", "state"],
    grantedScopes: ["scene.write"],
  });
  const controllerHello = createHelloEnvelope({
    role: "controller",
    sessionId: "session_abcdefgh",
    senderId: "controller_abcdef",
    senderEpoch: 2,
    capabilities: ["ack", "other"],
    requestedScopes: ["scene.write", "admin"],
  });
  const proof = await createProofEnvelope({
    localHello: targetHello,
    remoteHello: controllerHello,
    secret,
    sequence: 1,
  });
  assert.equal(await verifyProofEnvelope({
    proof,
    localHello: controllerHello,
    remoteHello: targetHello,
    secret,
  }), true);
  assert.equal(await verifyProofEnvelope({
    proof,
    localHello: controllerHello,
    remoteHello: targetHello,
    secret: "a-different-secret-with-enough-entropy",
  }), false);
  assert.deepEqual(negotiateSession(targetHello, controllerHello), {
    capabilities: ["ack"],
    acceptedScopes: ["scene.write"],
  });
});

test("controller and target authenticate, exchange a snapshot, apply a command, and converge", async () => {
  const targetTransport = new MockTransport();
  const controllerTransport = new MockTransport();
  targetTransport.connect(controllerTransport);
  const state = { revision: 0, x: 0, color: "blue" };

  const target = new BRSPConnection({
    transport: targetTransport,
    role: "target",
    sessionId: "session_remote_demo",
    sharedSecret: "a-generated-192-bit-style-secret",
    peerId: "target_peer_1234",
    epoch: 100,
    capabilities: ["command-ack", "state-snapshot", "latest-state"],
    grantedScopes: ["scene.write"],
    getState: () => ({ ...state }),
    applyCommand: ({ action, args, expectedRevision }) => {
      if (expectedRevision !== null && expectedRevision !== state.revision) {
        return { ok: false, revision: state.revision, error: "revision_conflict" };
      }
      if (action !== "set-x") return { ok: false, revision: state.revision, error: "unsupported_command" };
      state.x = Math.max(-1, Math.min(1, Number(args.x)));
      state.revision += 1;
      return { ok: true, revision: state.revision, result: { x: state.x } };
    },
  });
  const controller = new BRSPConnection({
    transport: controllerTransport,
    role: "controller",
    sessionId: "session_remote_demo",
    sharedSecret: "a-generated-192-bit-style-secret",
    peerId: "controller_peer_1",
    epoch: 200,
    capabilities: ["command-ack", "state-snapshot", "latest-state"],
    requestedScopes: ["scene.write", "admin"],
  });

  const targetReady = eventOnce(target, "ready");
  const controllerReady = eventOnce(controller, "ready");
  targetTransport.open();
  controllerTransport.open();
  const [targetStatus, controllerStatus] = await Promise.all([targetReady, controllerReady]);
  assert.deepEqual(targetStatus.acceptedScopes, ["scene.write"]);
  assert.deepEqual(controllerStatus.acceptedScopes, ["scene.write"]);

  const snapshotPromise = eventOnce(controller, "snapshot");
  target.publishSnapshot();
  assert.deepEqual(await snapshotPromise, { revision: 0, state: { revision: 0, x: 0, color: "blue" } });

  const appliedPromise = eventOnce(controller, "commandapplied");
  const statePromise = eventOnce(controller, "state");
  const targetProtocolError = eventOnce(target, "protocolerror").then((detail) => {
    throw new Error(`Target protocol error: ${detail.message}`);
  });
  const commandId = controller.sendCommand("scene.write", "set-x", { x: 0.75 }, { expectedRevision: 0 });
  const applied = await Promise.race([appliedPromise, targetProtocolError]);
  assert.equal(applied.commandId, commandId);
  assert.equal(applied.ok, true);
  assert.equal(applied.revision, 1);
  const remoteState = await statePromise;
  assert.equal(remoteState.revision, 1);
  assert.equal(remoteState.state.x, 0.75);
  assert.equal(controller.pendingCommands.size, 0);

  await Promise.all([target.close(), controller.close()]);
});

test("a duplicate command is applied once and receives a fresh acknowledgement sequence", async () => {
  const targetTransport = new MockTransport();
  const controllerTransport = new MockTransport();
  targetTransport.connect(controllerTransport);
  let revision = 0;
  let applyCount = 0;
  let droppedFirstApplied = false;
  targetTransport.dropControl = (data) => {
    if (decodeEnvelope(data)?.type !== "applied" || droppedFirstApplied) return false;
    droppedFirstApplied = true;
    return true;
  };
  const target = new BRSPConnection({
    transport: targetTransport,
    role: "target",
    sessionId: "session_command_retry",
    sharedSecret: "command-retry-secret-with-entropy",
    peerId: "target_command_retry",
    grantedScopes: ["scene.write"],
    getState: () => ({ revision }),
    applyCommand: () => {
      applyCount += 1;
      revision += 1;
      return { ok: true, revision, result: { applied: true } };
    },
  });
  const controller = new BRSPConnection({
    transport: controllerTransport,
    role: "controller",
    sessionId: "session_command_retry",
    sharedSecret: "command-retry-secret-with-entropy",
    peerId: "controller_command_retry",
    requestedScopes: ["scene.write"],
  });
  const ready = Promise.all([eventOnce(target, "ready"), eventOnce(controller, "ready")]);
  targetTransport.open();
  controllerTransport.open();
  await ready;

  const commandId = controller.sendCommand("scene.write", "apply-once", {});
  await settle();
  assert.equal(applyCount, 1);
  assert.equal(controller.pendingCommands.has(commandId), true, "the dropped acknowledgement remains pending");
  const original = controllerTransport.sentControl
    .map((data) => decodeEnvelope(data))
    .find((envelope) => envelope?.type === "command" && envelope.body.commandId === commandId);
  assert.ok(original);
  const applied = eventOnce(controller, "commandapplied");
  controllerTransport.sendControl(controllerTransport.peerKey, encodeEnvelope(makeEnvelope({
    type: "command",
    sessionId: original.sessionId,
    senderId: original.senderId,
    senderEpoch: original.senderEpoch,
    sequence: (original.sequence + 1) >>> 0,
    body: original.body,
  })));
  assert.equal((await applied).commandId, commandId);
  assert.equal(applyCount, 1, "the target reducer is not run twice");
  assert.equal(controller.pendingCommands.has(commandId), false);
  const acknowledgements = targetTransport.sentControl
    .map((data) => decodeEnvelope(data))
    .filter((envelope) => envelope?.type === "applied" && envelope.body.commandId === commandId);
  assert.equal(acknowledgements.length, 2);
  assert.notEqual(acknowledgements[0].sequence, acknowledgements[1].sequence);
  const protocolError = eventOnce(target, "protocolerror");
  controllerTransport.sendControl(controllerTransport.peerKey, encodeEnvelope(makeEnvelope({
    type: "command",
    sessionId: original.sessionId,
    senderId: original.senderId,
    senderEpoch: original.senderEpoch,
    sequence: (original.sequence + 2) >>> 0,
    body: { ...original.body, action: "different-action" },
  })));
  assert.match((await protocolError).message, /commandId was reused/i);
  await Promise.all([target.close(), controller.close()]);
});

test("controller freshness expires after readiness and remains stale after peer close", async () => {
  const targetTransport = new MockTransport();
  const controllerTransport = new MockTransport();
  targetTransport.connect(controllerTransport);
  let clock = 100;
  const target = new BRSPConnection({
    transport: targetTransport,
    role: "target",
    sessionId: "session_freshness",
    sharedSecret: "freshness-secret-with-enough-entropy",
    peerId: "target_freshness",
    now: () => clock,
  });
  const controller = new BRSPConnection({
    transport: controllerTransport,
    role: "controller",
    sessionId: "session_freshness",
    sharedSecret: "freshness-secret-with-enough-entropy",
    peerId: "controller_freshness",
    now: () => clock,
  });
  const ready = Promise.all([eventOnce(target, "ready"), eventOnce(controller, "ready")]);
  targetTransport.open();
  controllerTransport.open();
  await ready;
  assert.equal(controller.isStateStale(clock + 1_999), false);
  assert.equal(controller.isStateStale(clock + 2_000), true, "no first state expires from the ready boundary");
  controllerTransport.dispatch("peerclose", { peerKey: controllerTransport.peerKey });
  assert.equal(controller.phase, "disconnected");
  assert.equal(controller.isStateStale(clock + 2_001), true, "disconnect does not make held state fresh again");
  await Promise.all([target.close(), controller.close()]);
});

test("wrong pairing secrets fail closed before application messages", async () => {
  const targetTransport = new MockTransport();
  const controllerTransport = new MockTransport();
  targetTransport.connect(controllerTransport);
  const target = new BRSPConnection({
    transport: targetTransport,
    role: "target",
    sessionId: "session_wrong_secret",
    sharedSecret: "target-secret-with-enough-entropy",
    peerId: "target_wrong_secret",
    grantedScopes: ["scene.write"],
  });
  const controller = new BRSPConnection({
    transport: controllerTransport,
    role: "controller",
    sessionId: "session_wrong_secret",
    sharedSecret: "controller-secret-enough-entropy",
    peerId: "controller_wrong_secret",
    requestedScopes: ["scene.write"],
  });
  const targetError = eventOnce(target, "protocolerror");
  targetTransport.open();
  controllerTransport.open();
  assert.match((await targetError).message, /proof failed/i);
  await settle();
  assert.notEqual(target.phase, "ready");
  assert.notEqual(controller.phase, "ready");
});

test("state backpressure drops obsolete offers instead of growing history", async () => {
  const targetTransport = new MockTransport();
  const controllerTransport = new MockTransport();
  targetTransport.connect(controllerTransport);
  const target = new BRSPConnection({
    transport: targetTransport,
    role: "target",
    sessionId: "session_backpressure",
    sharedSecret: "backpressure-secret-enough-entropy",
    peerId: "target_backpressure",
    grantedScopes: [],
    getState: () => ({ revision: 0, x: 0 }),
  });
  const controller = new BRSPConnection({
    transport: controllerTransport,
    role: "controller",
    sessionId: "session_backpressure",
    sharedSecret: "backpressure-secret-enough-entropy",
    peerId: "controller_backpressure",
    requestedScopes: [],
  });
  const ready = Promise.all([eventOnce(target, "ready"), eventOnce(controller, "ready")]);
  targetTransport.open();
  controllerTransport.open();
  await ready;
  const sentBeforePressure = targetTransport.sentState.length;
  targetTransport.blockState = true;
  assert.equal(target.publishState({ revision: 1, x: 0.1 }), false);
  assert.equal(target.publishState({ revision: 2, x: 0.9 }), false);
  assert.equal(targetTransport.sentState.length, sentBeforePressure, "blocked latest-state offers do not grow transport history");
});

test("smartphone-style live intent uses the replaceable lane and target state confirms the result", async () => {
  const targetTransport = new MockTransport();
  const controllerTransport = new MockTransport();
  targetTransport.connect(controllerTransport);
  const state = { revision: 0, joystick: { x: 0, y: 0 } };
  const target = new BRSPConnection({
    transport: targetTransport,
    role: "target",
    sessionId: "session_live_intent",
    sharedSecret: "live-intent-secret-enough-entropy",
    peerId: "target_live_intent",
    capabilities: ["latest-intent", "latest-state"],
    grantedScopes: ["controls.write"],
    getState: () => ({ ...state, joystick: { ...state.joystick } }),
    applyIntent: ({ controls }) => {
      state.joystick = {
        x: Math.max(-1, Math.min(1, Number(controls.joystick.x))),
        y: Math.max(-1, Math.min(1, Number(controls.joystick.y))),
      };
      state.revision += 1;
      return { revision: state.revision, state: { ...state, joystick: { ...state.joystick } } };
    },
  });
  const controller = new BRSPConnection({
    transport: controllerTransport,
    role: "controller",
    sessionId: "session_live_intent",
    sharedSecret: "live-intent-secret-enough-entropy",
    peerId: "controller_live_intent",
    capabilities: ["latest-intent", "latest-state"],
    requestedScopes: ["controls.write"],
  });
  const ready = Promise.all([eventOnce(target, "ready"), eventOnce(controller, "ready")]);
  targetTransport.open();
  controllerTransport.open();
  await ready;
  const intentReceived = eventOnce(target, "intent");
  const targetProtocolError = eventOnce(target, "protocolerror").then((detail) => {
    throw new Error(`Target protocol error: ${detail.message}`);
  });
  const stateReturned = eventOnce(controller, "state");
  assert.equal(controller.publishIntent("controls.write", { joystick: { x: 0.8, y: -0.3 } }), true);
  const intent = await Promise.race([intentReceived, targetProtocolError]);
  assert.equal(intent.scope, "controls.write");
  assert.deepEqual(intent.controls, { joystick: { x: 0.8, y: -0.3 } });
  const returned = await stateReturned;
  assert.equal(returned.revision, 1);
  assert.deepEqual(returned.state.joystick, { x: 0.8, y: -0.3 });
});
