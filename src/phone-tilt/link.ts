import { BRSPConnection, type BrspTransport } from "../vendor/brsp/src/brsp.js";
import { VdoNinjaTransport } from "../vendor/brsp/src/vdo-ninja-transport.js";
import { TILT_SCOPE, TiltAuthority, type TiltControls, type TiltState, validControls, validTiltState } from "./controls";
import type { TiltInvitation } from "./invitation";
import { COMPANION_SCOPE, exactFields, validOffer, validRelay, type RelayState, type SourceOffer } from "../flight-session/contract";
import { PILOT_LABEL_CAPABILITY, validPilotName } from "./pilot-name";

export const CONTROL_RELAY_HZ = 130;
export const CONTROL_RELAY_MS = 1000 / CONTROL_RELAY_HZ;
const capabilities = ["latest-intent", "latest-state", "state-snapshot", PILOT_LABEL_CAPABILITY];
const dispatch = (target: EventTarget, type: string, detail: unknown) => target.dispatchEvent(new CustomEvent(type, { detail }));
let sdkLoading: Promise<void> | undefined;
export function loadTiltSdk(): Promise<void> {
  if (typeof globalThis.VDONinjaSDK === "function") return Promise.resolve();
  if (sdkLoading) return sdkLoading;
  sdkLoading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL("../vendor/vdoninja/1.5.5/vdoninja-sdk.min.js", location.href).href;
    const timer = setTimeout(() => failed(), 15_000);
    const failed = () => { clearTimeout(timer); script.remove(); sdkLoading = undefined; reject(new Error("Connection software could not load. Please try again.")); };
    script.onload = () => { clearTimeout(timer); typeof globalThis.VDONinjaSDK === "function" ? resolve() : failed(); };
    script.onerror = failed;
    document.head.append(script);
  });
  return sdkLoading;
}
type TransportFactory = (role: "target" | "controller", invitation: TiltInvitation) => BrspTransport;
const defaultTransport: TransportFactory = (role, invitation) => new VdoNinjaTransport({
  role, room: invitation.room, sharedSecret: invitation.secret, label: "ECGaming phone tilt",
  forceTurn: new URLSearchParams(location.search).get("remote-force-turn") === "1",
});

/** One activation owns one authenticated connection and every timer it creates. */
export class TiltLink extends EventTarget {
  readonly authority = new TiltAuthority();
  relay: RelayState | null = null;
  sourceOffer: SourceOffer | null = null;
  pilotName = "";
  confirmedPilotName = "";
  getRelay?: () => RelayState | null;
  acceptSource?: (offer: SourceOffer) => void;
  private wireRevision = 0;
  private previousWire = "";
  private connection?: BRSPConnection;
  private generation = 0;
  private tick?: ReturnType<typeof setInterval>;
  private lastStateAt = -Infinity;
  private lastRevision = -1;
  private startedAt = 0;
  private authenticatingAt = 0;
  private readyAt = 0;
  private state?: TiltState;
  private stopped = true;
  private abort?: AbortController;
  constructor(readonly role: "target" | "controller", private factory: TransportFactory = defaultTransport,
    private loadSdk: () => Promise<void> = loadTiltSdk) { super(); }
  get ready() { return this.connection?.phase === "ready"; }
  get active() { return !this.stopped; }
  get fresh() { return this.ready && performance.now() - this.lastStateAt < 500; }
  snapshot() { return this.role === "target" ? this.authority.expire(performance.now()) : this.state; }
  async start(invitation: TiltInvitation) {
    if (!this.stopped) return;
    const generation = ++this.generation;
    this.stopped = false;
    this.startedAt = performance.now(); this.authenticatingAt = this.readyAt = 0;
    this.lastStateAt = -Infinity; this.lastRevision = -1; this.state = undefined;
    this.authority.neutralize();
    this.relay = null; this.sourceOffer = null; this.wireRevision = 0; this.previousWire = "";
    this.status("Connecting…");
    try {
      await this.loadSdk();
      if (generation !== this.generation) return;
      const transport = this.factory(this.role, invitation);
      const abort = this.abort = new AbortController();
      const current = () => generation === this.generation && !this.stopped;
      const connection = this.connection = new BRSPConnection({
        transport, role: this.role, sessionId: invitation.room, sharedSecret: invitation.secret, capabilities,
        grantedScopes: this.role === "target" ? [COMPANION_SCOPE] : [],
        requestedScopes: this.role === "controller" ? [COMPANION_SCOPE] : [],
        getState: () => this.wireState(),
        applyIntent: ({ scope, controls }) => {
          if (!current()) throw new Error("Phone session has ended");
          const labelled = connection.negotiatedCapabilities.includes(PILOT_LABEL_CAPABILITY);
          if (scope !== COMPANION_SCOPE || !exactFields(controls, labelled ? ["tilt", "signal", "pilotName"] : ["tilt", "signal"]) ||
              (labelled && !validPilotName(controls.pilotName)) || !validControls(controls.tilt) ||
              (controls.signal !== null && !validOffer(controls.signal))) throw new Error("Invalid companion controls");
          if (labelled) this.pilotName = controls.pilotName as string;
          this.authority.accept(TILT_SCOPE, controls.tilt, performance.now());
          if (controls.signal) this.acceptSource?.(controls.signal as SourceOffer);
          // The 130 Hz state publisher coalesces all peers' latest values.
        },
      });
      const listen = (target: EventTarget, name: string, fn: (event: CustomEvent) => void) =>
        target.addEventListener(name, ((e: Event) => { if (current()) fn(e as CustomEvent); }) as EventListener, { signal: abort.signal });
      listen(connection, "phasechange", e => {
        if (e.detail.phase === "authenticating") this.authenticatingAt = performance.now();
        if (["error", "disconnected"].includes(e.detail.phase)) this.fail("Phone connection ended. Create and scan a new QR code.");
      });
      listen(connection, "ready", () => {
        if (!connection.acceptedScopes.includes(COMPANION_SCOPE) || !connection.negotiatedCapabilities.includes("latest-intent")) {
          this.fail("This controller is incompatible. Reload both pages and pair again."); return;
        }
        this.readyAt = performance.now();
        this.status("Connected"); dispatch(this, "ready", undefined);
      });
      const receive = (e: CustomEvent) => {
        const wire = e.detail.state;
        if (!wire || typeof wire !== "object") { this.fail("Invalid flight state."); return; }
        const { relay, pilotName, ...tilt } = wire;
        const labelled = connection.negotiatedCapabilities.includes(PILOT_LABEL_CAPABILITY);
        if ((labelled ? !validPilotName(pilotName) : pilotName !== undefined) || !validTiltState(tilt) || (relay !== null && !validRelay(relay)) || wire.revision !== e.detail.revision) {
          this.fail("The flight screen sent incompatible controls. Pair again."); return;
        }
        if (e.detail.revision < this.lastRevision) return;
        this.state = tilt; this.relay = relay; this.lastRevision = e.detail.revision; this.lastStateAt = performance.now();
        this.confirmedPilotName = pilotName ?? "";
        dispatch(this, "state", this.state);
      };
      listen(connection, "state", receive); listen(connection, "snapshot", receive);
      listen(connection, "intenterror", () => this.fail("Invalid phone controls. Pair again."));
      listen(transport, "quality", e => dispatch(this, "quality", { route: e.detail.route, rttMs: e.detail.rttMs }));
      listen(transport, "status", e => {
        if (e.detail.phase === "selection-required") this.fail("More than one flight screen was found. Create a new QR code.");
      });
      // Poll the lease independently of game pause; game frames also check it before applying input.
      this.tick = setInterval(() => {
        if (!current()) return;
        const now = performance.now();
        if (this.role === "target") {
          const state = this.authority.expire(now);
          // This timer already caps the rate. A second elapsed-time gate skips cycles
          // when browser timers round 33.33 ms down, adding avoidable confirmation lag.
          connection.publishState(); dispatch(this, "state", state);
        }
        if ((this.authenticatingAt && !this.ready && now - this.authenticatingAt > 15_000) ||
            (this.role === "controller" && !this.ready && now - this.startedAt > 30_000))
          this.fail("Could not reach the flight screen. Create and scan a new QR code.");
        else if ((!this.readyAt && now - this.startedAt > 10 * 60_000) || now - this.startedAt > 2 * 60 * 60_000)
          this.fail("This pairing has expired. Create and scan a new QR code.");
      }, CONTROL_RELAY_MS);
      await transport.start();
      if (current() && !this.ready) this.status(this.role === "target" ? "Scan the code with your phone." : "Waiting for the flight screen…");
    } catch {
      if (generation === this.generation) this.fail("Could not connect. Check the Internet connection and create a new QR code.");
    }
  }
  send(controls: TiltControls) {
    if (!validControls(controls) || !this.ready) return false;
    return this.connection!.publishIntent(COMPANION_SCOPE, { tilt: controls, signal: this.sourceOffer,
      ...(this.connection!.negotiatedCapabilities.includes(PILOT_LABEL_CAPABILITY) ? { pilotName: this.pilotName } : {}) });
  }
  private wireState() {
    const tilt = this.authority.expire(performance.now());
    const state = { ...tilt, revision: 0, relay: this.getRelay?.() ?? null,
      ...(this.connection?.negotiatedCapabilities.includes(PILOT_LABEL_CAPABILITY) ? { pilotName: this.pilotName } : {}) };
    const serialized = JSON.stringify(state);
    if (serialized !== this.previousWire) { this.previousWire = serialized; this.wireRevision++; }
    return { ...state, revision: this.wireRevision };
  }
  private status(message: string) { dispatch(this, "status", { message, active: this.active, ready: this.ready }); }
  private fail(message: string) { this.stop(); this.status(message); }
  stop() {
    ++this.generation;
    this.stopped = true;
    if (this.tick !== undefined) clearInterval(this.tick);
    this.tick = undefined; this.abort?.abort(); this.abort = undefined;
    this.authority.neutralize(); this.state = undefined; this.relay = null; this.sourceOffer = null; this.lastStateAt = -Infinity;
    this.pilotName = this.confirmedPilotName = "";
    const connection = this.connection; this.connection = undefined;
    void connection?.close().catch(() => { /* Producers and input already stopped. */ });
    this.status("Disconnected");
  }
}
