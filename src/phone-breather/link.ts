import { BRSPConnection, type BrspTransport } from "../vendor/brsp/src/brsp.js";
import { VdoNinjaTransport } from "../vendor/brsp/src/vdo-ninja-transport.js";
import type { BreathInvitation } from "./invitation";
import { loadTiltSdk } from "../phone-tilt/link";

const BREATH_SCOPE = "breath.signal";
const BREATH_PROFILE = "ecgaming-breath-v1";
const CONTROL_RELAY_HZ = 50;
const CONTROL_RELAY_MS = 1000 / CONTROL_RELAY_HZ;
const CAPABILITIES = ["latest-intent", "latest-state", "state-snapshot", "pilot-label"];
const PILOT_LABEL_CAPABILITY = "pilot-label";

const dispatch = (target: EventTarget, type: string, detail: unknown) =>
  target.dispatchEvent(new CustomEvent(type, { detail }));

type TransportFactory = (role: "target" | "controller", invitation: BreathInvitation) => BrspTransport;
const defaultTransport: TransportFactory = (role, invitation) =>
  new VdoNinjaTransport({
    role,
    room: invitation.room,
    sharedSecret: invitation.secret,
    label: "ECGaming Phone Breather",
    forceTurn: new URLSearchParams(location.search).get("remote-force-turn") === "1",
  });

export interface BreathSignal {
  volume01: number;
  phase: -1 | 0 | 1;
  flow01: number;
  confidence01: number;
  timestamp: number;
}

export interface BreathState extends BreathSignal {
  profile: typeof BREATH_PROFILE;
  revision: number;
  pilotName: string;
  connected: boolean;
}

function exactFields<T extends Record<string, unknown>>(obj: unknown, keys: string[]): obj is T {
  return !!obj && typeof obj === "object" && !Array.isArray(obj) && Object.keys(obj).length === keys.length && keys.every((k) => Object.hasOwn(obj, k));
}

function validBreathSignalFields(v: unknown): v is BreathSignal {
  const w = v as Record<string, unknown>;
  return (
    typeof w.volume01 === "number" &&
    Number.isFinite(w.volume01) &&
    w.volume01 >= 0 &&
    w.volume01 <= 1 &&
    typeof w.phase === "number" &&
    (w.phase === 1 || w.phase === 0 || w.phase === -1) &&
    typeof w.flow01 === "number" &&
    Number.isFinite(w.flow01) &&
    w.flow01 >= 0 &&
    w.flow01 <= 1 &&
    typeof w.confidence01 === "number" &&
    Number.isFinite(w.confidence01) &&
    w.confidence01 >= 0 &&
    w.confidence01 <= 1 &&
    typeof w.timestamp === "number" &&
    Number.isFinite(w.timestamp)
  );
}

function validBreathSignal(v: unknown): v is BreathSignal {
  return (
    exactFields<Record<string, unknown>>(v, ["volume01", "phase", "flow01", "confidence01", "timestamp"]) &&
    validBreathSignalFields(v)
  );
}

function validBreathState(v: unknown): v is BreathState {
  return (
    exactFields<Record<string, unknown>>(v, ["profile", "revision", "volume01", "phase", "flow01", "confidence01", "timestamp", "pilotName", "connected"]) &&
    v.profile === BREATH_PROFILE &&
    typeof v.revision === "number" &&
    Number.isSafeInteger(v.revision) &&
    v.revision >= 0 &&
    validBreathSignalFields(v) &&
    typeof v.pilotName === "string" &&
    typeof v.connected === "boolean"
  );
}

function validPilotName(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= 32 && /^[\p{L}\p{N} _\-'.]+$/u.test(v);
}

export class BreathLink extends EventTarget {
  private connection?: BRSPConnection;
  private generation = 0;
  private tick?: ReturnType<typeof setInterval>;
  private lastStateAt = -Infinity;
  private lastRevision = -1;
  private startedAt = 0;
  private authenticatingAt = 0;
  private readyAt = 0;
  private state?: BreathState;
  private stopped = true;
  private abort?: AbortController;
  private wireRevision = 0;
  private previousWire = "";

  pilotName = "";
  confirmedPilotName = "";
  relay: BreathSignal | null = null;
  sourceOffer: BreathSignal | null = null;
  getRelay?: () => BreathSignal | null;
  acceptSource?: (offer: BreathSignal) => void;

  constructor(
    readonly role: "target" | "controller",
    private factory: TransportFactory = defaultTransport,
    private loadSdk: () => Promise<void> = loadTiltSdk,
  ) {
    super();
  }

  get ready() {
    return this.connection?.phase === "ready";
  }

  get active() {
    return !this.stopped;
  }

  get fresh() {
    return this.ready && performance.now() - this.lastStateAt < 1000;
  }

  snapshot(): BreathSignal | undefined {
    if (this.role === "target") return this.relay ?? undefined;
    return this.state;
  }

  async start(invitation: BreathInvitation): Promise<void> {
    if (!this.stopped) return;
    const generation = ++this.generation;
    this.stopped = false;
    this.startedAt = performance.now();
    this.authenticatingAt = this.readyAt = 0;
    this.lastStateAt = -Infinity;
    this.lastRevision = -1;
    this.state = undefined;
    this.relay = null;
    this.sourceOffer = null;
    this.wireRevision = 0;
    this.previousWire = "";
    this.status("Connecting…");

    try {
      await this.loadSdk();
      if (generation !== this.generation) return;

      const transport = this.factory(this.role, invitation);
      const abort = (this.abort = new AbortController());
      const current = () => generation === this.generation && !this.stopped;

      const connection = (this.connection = new BRSPConnection({
        transport,
        role: this.role,
        sessionId: invitation.room,
        sharedSecret: invitation.secret,
        capabilities: CAPABILITIES,
        grantedScopes: this.role === "target" ? [BREATH_SCOPE] : [],
        requestedScopes: this.role === "controller" ? [BREATH_SCOPE] : [],
        getState: () => this.wireState(),
        applyIntent: ({ scope, controls }) => {
          if (!current()) throw new Error("Breath session has ended");
          const labelled = connection.negotiatedCapabilities.includes(PILOT_LABEL_CAPABILITY);
          if (
            scope !== BREATH_SCOPE ||
            !exactFields(controls, labelled ? ["signal", "pilotName"] : ["signal"]) ||
            (labelled && !validPilotName(controls.pilotName)) ||
            !validBreathSignal(controls.signal)
          )
            throw new Error("Invalid breath controls");
          if (labelled) this.pilotName = controls.pilotName as string;
          if (controls.signal) this.acceptSource?.(controls.signal as BreathSignal);
        },
      }));

      const listen = (target: EventTarget, name: string, fn: (event: CustomEvent) => void) =>
        target.addEventListener(name, ((e: Event) => {
          if (current()) fn(e as CustomEvent);
        }) as EventListener, { signal: abort.signal });

      listen(connection, "phasechange", (e) => {
        if (e.detail.phase === "authenticating") this.authenticatingAt = performance.now();
        if (["error", "disconnected"].includes(e.detail.phase)) {
          const reason = typeof e.detail.message === "string" ? e.detail.message : "";
          this.fail("Breath connection ended. Create and scan a new QR code.", e.detail.phase === "disconnected" && reason !== "Peer ended the session.");
        }
      });

      listen(connection, "ready", () => {
        if (!connection.acceptedScopes.includes(BREATH_SCOPE) || !connection.negotiatedCapabilities.includes("latest-intent")) {
          this.fail("This controller is incompatible. Reload both pages and pair again.", false);
          return;
        }
        this.readyAt = performance.now();
        this.status("Connected");
        dispatch(this, "ready", undefined);
      });

      const receive = (e: CustomEvent) => {
        const wire = e.detail.state;
        if (!wire || typeof wire !== "object") {
          this.fail("Invalid breath state.");
          return;
        }
        const state = wire as BreathState;
        const relay = (wire as BreathState & { relay?: BreathSignal | null }).relay;
        const labelled = connection.negotiatedCapabilities.includes(PILOT_LABEL_CAPABILITY);
        if (
          (labelled ? !validPilotName(state.pilotName) : (wire as Partial<BreathState>).pilotName !== undefined) ||
          !validBreathState(state) ||
          (relay !== undefined && relay !== null && !validBreathSignal(relay)) ||
          state.revision !== e.detail.revision
        ) {
          this.fail("The breath host sent incompatible data. Pair again.", false);
          return;
        }
        if (e.detail.revision < this.lastRevision) return;
        this.state = state;
        this.relay = relay ?? null;
        this.lastRevision = e.detail.revision;
        this.lastStateAt = performance.now();
        this.confirmedPilotName = state.pilotName;
        dispatch(this, "state", this.state);
      };

      listen(connection, "state", receive);
      listen(connection, "snapshot", receive);
      listen(connection, "intenterror", () => this.fail("Invalid breath signal. Pair again.", false));
      listen(transport, "quality", (e) => dispatch(this, "quality", { route: e.detail.route, rttMs: e.detail.rttMs }));
      listen(transport, "status", (e) => {
        if (e.detail.phase === "selection-required") this.fail("More than one host was found. Create a new QR code.", false);
      });

      this.tick = setInterval(() => {
        if (!current()) return;
        const now = performance.now();
        if (this.role === "target") {
          const state = this.wireState();
          connection.publishState();
          dispatch(this, "state", state);
        }
        if ((this.authenticatingAt && !this.ready && now - this.authenticatingAt > 15_000) || (this.role === "controller" && !this.ready && now - this.startedAt > 30_000))
          this.fail("Could not reach the breath host. Create and scan a new QR code.");
        else if ((!this.readyAt && now - this.startedAt > 10 * 60_000) || now - this.startedAt > 2 * 60 * 60_000)
          this.fail("This pairing has expired. Create and scan a new QR code.", false);
      }, CONTROL_RELAY_MS);

      await transport.start();
      if (current() && !this.ready) this.status(this.role === "target" ? "Scan the code with your phone." : "Waiting for the breath host…");
    } catch {
      if (generation === this.generation) this.fail("Could not connect. Check the Internet connection and create a new QR code.");
    }
  }

  send(signal: BreathSignal): boolean {
    if (!validBreathSignal(signal) || !this.ready) return false;
    return this.connection!.publishIntent(BREATH_SCOPE, {
      signal,
      ...(this.connection!.negotiatedCapabilities.includes(PILOT_LABEL_CAPABILITY) ? { pilotName: this.pilotName } : {}),
    });
  }

  private wireState(): BreathState {
    const signal = this.sourceOffer ?? { volume01: 0.5, phase: 0, flow01: 0, confidence01: 0, timestamp: performance.now() };
    const state: BreathState = {
      ...signal,
      profile: BREATH_PROFILE,
      revision: 0,
      pilotName: this.pilotName,
      connected: this.ready,
    };
    const serialized = JSON.stringify(state);
    if (serialized !== this.previousWire) {
      this.previousWire = serialized;
      this.wireRevision++;
    }
    return { ...state, revision: this.wireRevision };
  }

  private status(message: string, reconnectable = false) {
    dispatch(this, "status", { message, active: this.active, ready: this.ready, reconnectable });
  }

  private fail(message: string, reconnectable = true) {
    this.stop({ emitStatus: false });
    this.status(message, reconnectable);
  }

  stop(options: { emitStatus?: boolean } = {}): void {
    const wasActive = !this.stopped;
    ++this.generation;
    this.stopped = true;
    if (this.tick !== undefined) clearInterval(this.tick);
    this.tick = undefined;
    this.abort?.abort();
    this.abort = undefined;
    this.state = undefined;
    this.relay = null;
    this.sourceOffer = null;
    this.lastStateAt = -Infinity;
    this.pilotName = this.confirmedPilotName = "";
    const connection = this.connection;
    this.connection = undefined;
    void connection?.close().catch(() => {});
    if (options.emitStatus !== false && wasActive) this.status("Disconnected");
  }
}