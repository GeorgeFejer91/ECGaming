export class MockTransport extends EventTarget {
  constructor() {
    super();
    this.other = undefined;
    this.peerKey = "peer-link";
    this.closed = false;
    this.blockState = false;
    this.sentControl = [];
    this.sentState = [];
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
    if (this.closed || peerKey !== this.peerKey) return false;
    this.sentControl.push(data);
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

export function eventOnce(target, type, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}; phase=${target.phase}`)), timeoutMs);
    target.addEventListener(type, (event) => {
      clearTimeout(timer);
      resolve(event.detail);
    }, { once: true });
  });
}

export async function settle(delayMs = 10) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
