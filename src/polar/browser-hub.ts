import {
  PolarH10BrowserSession,
  PolarStreamError,
  polarWebBluetoothSupport,
} from "../vendor/affect-tracker/polar-stream.js";

export { polarWebBluetoothSupport };

export const POLAR_HUB_CHANNEL = "ecgaming-polar-hub-v1";
export const POLAR_HUB_KIND = "ecgaming-polar-hub-status";
export const POLAR_HUB_VERSION = 1;
const REMOTE_OWNER_FRESH_MS = 2_000;
const STATUS_INTERVAL_MS = 500;

export type PolarHubState =
  | "idle"
  | "connecting"
  | "live"
  | "recovering"
  | "failed";

export interface PolarHubStatus {
  kind: typeof POLAR_HUB_KIND;
  version: typeof POLAR_HUB_VERSION;
  ownerId: string;
  state: PolarHubState;
  stage: string;
  setupAttempt: number;
  setupAttemptsTotal: number;
  heartRateBpm?: number;
  ecgRateHz?: number;
  breathingReady: boolean;
  physicalPolar: boolean;
  sentAtEpochMs: number;
}

interface PolarSessionLike {
  connect(onEvent: (event: any) => void): Promise<void>;
  disconnect(options?: {
    emit?: boolean;
    releaseLease?: boolean;
  }): Promise<void>;
  diagnosticSnapshot(): Record<string, unknown>;
}

interface HubChannelLike {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  postMessage(message: unknown): void;
  close(): void;
}

interface HubTimerLike {
  setInterval(
    handler: () => void,
    timeoutMs: number,
  ): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
}

function createHubChannel(): HubChannelLike | undefined {
  try {
    return typeof BroadcastChannel === "undefined"
      ? undefined
      : new BroadcastChannel(POLAR_HUB_CHANNEL);
  } catch {
    return undefined;
  }
}

function createOwnerId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `polar-hub-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export function isPolarHubStatus(value: unknown): value is PolarHubStatus {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<PolarHubStatus>;
  return (
    message.kind === POLAR_HUB_KIND &&
    message.version === POLAR_HUB_VERSION &&
    typeof message.ownerId === "string" &&
    ["idle", "connecting", "live", "recovering", "failed"].includes(
      String(message.state),
    ) &&
    typeof message.stage === "string" &&
    Number.isFinite(message.setupAttempt) &&
    Number.isFinite(message.setupAttemptsTotal) &&
    typeof message.breathingReady === "boolean" &&
    typeof message.physicalPolar === "boolean" &&
    Number.isFinite(message.sentAtEpochMs)
  );
}

export class PolarBrowserHub {
  private readonly session: PolarSessionLike;
  private readonly channel?: HubChannelLike;
  private readonly timer: HubTimerLike;
  private readonly now: () => number;
  private readonly ownerId = createOwnerId();
  private readonly listeners = new Set<(event: any) => void>();
  private readonly statusListeners = new Set<(status: PolarHubStatus) => void>();
  private connectPromise?: Promise<void>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private remoteOwner?: PolarHubStatus;
  private state: PolarHubState = "idle";
  private stage = "idle";
  private setupAttempt = 0;
  private setupAttemptsTotal = 4;
  private heartRateBpm?: number;
  private ecgRateHz?: number;
  private breathingReady = false;
  private lastPublishedAt = -Infinity;

  constructor({
    session = new PolarH10BrowserSession(),
    channel = createHubChannel(),
    timer = globalThis,
    now = () => Date.now(),
  }: {
    session?: PolarSessionLike;
    channel?: HubChannelLike;
    timer?: HubTimerLike;
    now?: () => number;
  } = {}) {
    this.session = session;
    this.channel = channel;
    this.timer = timer;
    this.now = now;
    this.channel?.addEventListener("message", this.handleHubMessage);
  }

  diagnosticSnapshot(): Record<string, unknown> {
    return {
      ...this.session.diagnosticSnapshot(),
      hubOwnerId: this.ownerId,
      hubState: this.state,
      remoteOwner: this.freshRemoteOwner()?.ownerId,
    };
  }

  subscribeStatus(listener: (status: PolarHubStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.statusSnapshot());
    return () => this.statusListeners.delete(listener);
  }

  async connect(onEvent: (event: any) => void): Promise<void> {
    this.listeners.add(onEvent);
    if (this.state === "live") {
      onEvent({
        kind: "connection",
        connected: true,
        sharedHub: true,
        message: "Polar H10 is already live through the central browser hub",
      });
      return;
    }
    if (this.connectPromise) return this.connectPromise;

    const remote = this.freshRemoteOwner();
    if (remote && ["connecting", "live", "recovering"].includes(remote.state))
      throw new PolarStreamError(
        "POLAR_HUB_IN_USE",
        "The central Polar hub is already active in another ECGaming tab. Use that tab as the sensor owner or disconnect it before moving ownership here.",
        true,
      );

    this.state = "connecting";
    this.stage = "chooser";
    this.publishStatus(true);
    this.startHeartbeat();
    const attempt = this.session
      .connect(this.handleSessionEvent)
      .catch((error) => {
        this.state = "failed";
        this.stage = "failed";
        this.publishStatus(true);
        this.stopHeartbeat();
        throw error;
      })
      .finally(() => {
        this.connectPromise = undefined;
      });
    this.connectPromise = attempt;
    return attempt;
  }

  async disconnect(options?: {
    emit?: boolean;
    releaseLease?: boolean;
  }): Promise<void> {
    await this.session.disconnect(options);
    this.state = "idle";
    this.stage = "idle";
    this.heartRateBpm = undefined;
    this.ecgRateHz = undefined;
    this.breathingReady = false;
    this.publishStatus(true);
    this.stopHeartbeat();
  }

  destroy(): void {
    this.stopHeartbeat();
    this.channel?.removeEventListener("message", this.handleHubMessage);
    this.channel?.close();
    this.listeners.clear();
    this.statusListeners.clear();
  }

  private readonly handleSessionEvent = (event: any): void => {
    if (event.kind === "diagnostic" && event.snapshot) {
      this.stage = String(event.snapshot.stage ?? this.stage);
      this.setupAttempt = Number(event.snapshot.streamSetupAttempt) || 0;
      this.setupAttemptsTotal =
        Number(event.snapshot.streamSetupAttemptsTotal) || 4;
      if (this.stage === "recovering") this.state = "recovering";
    }
    if (event.kind === "status" && this.state !== "recovering")
      this.state = "connecting";
    if (event.kind === "connection") {
      this.state = event.connected
        ? "live"
        : event.recovering
          ? "recovering"
          : "failed";
      if (event.connected) this.stage = "live";
      if (!event.connected && !event.recovering) this.stopHeartbeat();
    }
    if (event.kind === "heart-rate") {
      const value = Number(event.beatsPerMinute);
      if (Number.isFinite(value) && value > 0) this.heartRateBpm = value;
    }
    if (event.kind === "ecg") {
      const value = Number(event.streamHealth?.observedSampleRateHz);
      if (Number.isFinite(value)) this.ecgRateHz = value;
    }
    if (event.kind === "accelerometer")
      this.breathingReady = event.breathing?.ready === true;

    for (const listener of this.listeners) listener(event);
    this.publishStatus(
      ["connection", "diagnostic", "error", "warning"].includes(event.kind),
    );
  };

  private readonly handleHubMessage = (event: MessageEvent<unknown>): void => {
    if (!isPolarHubStatus(event.data) || event.data.ownerId === this.ownerId)
      return;
    this.remoteOwner = event.data;
    for (const listener of this.statusListeners) listener(event.data);
  };

  private freshRemoteOwner(): PolarHubStatus | undefined {
    if (
      this.remoteOwner &&
      this.now() - this.remoteOwner.sentAtEpochMs <= REMOTE_OWNER_FRESH_MS
    )
      return this.remoteOwner;
    this.remoteOwner = undefined;
    return undefined;
  }

  private statusSnapshot(): PolarHubStatus {
    return {
      kind: POLAR_HUB_KIND,
      version: POLAR_HUB_VERSION,
      ownerId: this.ownerId,
      state: this.state,
      stage: this.stage,
      setupAttempt: this.setupAttempt,
      setupAttemptsTotal: this.setupAttemptsTotal,
      heartRateBpm: this.heartRateBpm,
      ecgRateHz: this.ecgRateHz,
      breathingReady: this.breathingReady,
      physicalPolar: this.state === "live",
      sentAtEpochMs: this.now(),
    };
  }

  private publishStatus(force = false): void {
    const now = this.now();
    if (!force && now - this.lastPublishedAt < STATUS_INTERVAL_MS) return;
    this.lastPublishedAt = now;
    const status = this.statusSnapshot();
    try {
      this.channel?.postMessage(status);
    } catch {
      // The Web Lock remains the authority if cross-tab status is unavailable.
    }
    for (const listener of this.statusListeners) listener(status);
  }

  private startHeartbeat(): void {
    if (this.heartbeat !== undefined) return;
    this.heartbeat = this.timer.setInterval(
      () => this.publishStatus(true),
      STATUS_INTERVAL_MS,
    );
  }

  private stopHeartbeat(): void {
    if (this.heartbeat === undefined) return;
    this.timer.clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }
}

type PolarHubGlobal = typeof globalThis & {
  __ecgamingPolarBrowserHubV1?: PolarBrowserHub;
};

export function getPolarBrowserHub(): PolarBrowserHub {
  const root = globalThis as PolarHubGlobal;
  root.__ecgamingPolarBrowserHubV1 ??= new PolarBrowserHub();
  return root.__ecgamingPolarBrowserHubV1;
}
