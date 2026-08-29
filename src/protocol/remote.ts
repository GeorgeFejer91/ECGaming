import {
  decodeSignalBeaconFrame,
  decodeFlightFrame,
  encodeSignalBeaconFrame,
  encodeFlightFrame,
  FLIGHT_HEARTBEAT_MS,
  FLIGHT_MAX_HZ,
  FLIGHT_RECOVERY_FRAMES,
  FLIGHT_STALE_MS,
  isNewerSequence,
  SIGNAL_BEACON_CHANNEL,
  SIGNAL_BEACON_HEARTBEAT_MS,
  SIGNAL_BEACON_MAX_HZ,
  SIGNAL_BEACON_LEGACY_METRICS,
  SIGNAL_BEACON_METRICS,
  SIGNAL_BEACON_STALE_MS,
} from "./flight-frame";
import type {
  FlightConfigV1,
  FlightFrame,
  FlightMappings,
  FlightReceiverSnapshot,
  RemoteSource,
  SignalBeaconConfigV1,
  SignalBeaconFrame,
} from "./types";
import { sanitizeMappings } from "../signals/mappings";

export const FLIGHT_ROOM = "ecgaming_flight_v1";
export const FLIGHT_SOURCE_PREFIX = "ecg_ground_";
export const FLIGHT_CHANNEL = "ecgflightv1";
export { SIGNAL_BEACON_CHANNEL };
export const FLIGHT_FORCE_TURN_PARAM = "remote-force-turn";
const DISCOVERY_SETTLE_MS = 300,
  MIN_INTERVAL = 1000 / FLIGHT_MAX_HZ,
  EARLY_TOLERANCE = 5,
  MIN_SEPARATION = MIN_INTERVAL - EARLY_TOLERANCE,
  BEACON_MIN_INTERVAL = 1000 / SIGNAL_BEACON_MAX_HZ,
  BEACON_MIN_SEPARATION = BEACON_MIN_INTERVAL - EARLY_TOLERANCE;

type Sdk = EventTarget & {
  connect(): Promise<void>;
  disconnect?(): Promise<void>;
  joinRoom(value: unknown): Promise<void>;
  announce(value: unknown): Promise<void>;
  view(id: string, options: unknown): Promise<void>;
  stopViewing?(id: string): Promise<void>;
  openChannel(
    uuid: string,
    label: string,
    options: unknown,
  ): Promise<RTCDataChannel>;
  sendData(data: unknown, options: unknown): boolean;
  getPeerQuality?(uuid: string): Promise<{ relayed?: boolean; rttMs?: number }>;
};
type Timers = {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
};

declare global {
  var VDONinjaSDK: (new (options: unknown) => Sdk) | undefined;
}
const detailEvent = <T>(type: string, detail: T) => {
  const event = new Event(type);
  Object.defineProperty(event, "detail", { value: detail, enumerable: true });
  return event;
};
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : String(error ?? "Unknown transport error");
const randomBytes = (length: number) => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues?.(bytes);
  if (bytes.every((v) => v === 0))
    for (let i = 0; i < length; i += 1)
      bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
};
const randomHex = (length = 4) =>
  Array.from(randomBytes(length), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
const randomUint32 = () => {
  const bytes = randomBytes(4),
    value = new DataView(bytes.buffer).getUint32(0, true);
  return value || 1;
};
export const generateFlightSourceId = () =>
  `${FLIGHT_SOURCE_PREFIX}${randomHex()}`;
export const formatSourceLabel = (id: string) => {
  const compact = id
    .replace(FLIGHT_SOURCE_PREFIX, "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
    .slice(-8)
    .padStart(8, "0");
  return `Tower ${compact.slice(0, 4)} ${compact.slice(4)}`;
};
export const sanitizePilotName = (value: unknown) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} ._'’\-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
export const isFlightSource = (id: unknown): id is string =>
  typeof id === "string" && id.startsWith(FLIGHT_SOURCE_PREFIX);
export const forceTurnEnabled = (locationObject: Location = location) => {
  try {
    return (
      new URL(locationObject.href).searchParams.get(FLIGHT_FORCE_TURN_PARAM) ===
      "1"
    );
  } catch {
    return false;
  }
};
const sdkFactory = (forceTurn: boolean): Sdk => {
  if (typeof globalThis.VDONinjaSDK !== "function")
    throw new Error("The bundled VDO.Ninja transport could not be loaded.");
  return new globalThis.VDONinjaSDK({
    password: false,
    salt: "ecgaming-flight-v1",
    forceTURN: forceTurn,
  });
};
const sourceItem = (value: any): RemoteSource => {
  const streamId = String(value?.streamID ?? value?.streamId ?? "");
  const pilotName = sanitizePilotName(
    value?.label ?? value?.pilotName ?? value?.meta?.pilotName,
  );
  return {
    streamId,
    uuid: String(value?.UUID ?? value?.uuid ?? ""),
    label: pilotName || formatSourceLabel(streamId),
  };
};

function createConfig(
  sourceId: string,
  mappings: FlightMappings,
  sessionId = randomHex(8),
  pilotName = "",
): FlightConfigV1 {
  return {
    kind: "ecgaming-flight-config",
    protocol: "ecgflightv1",
    schemaVersion: 1,
    sourceId,
    sessionId,
    createdAt: new Date().toISOString(),
    ...(pilotName ? { pilotName } : {}),
    mappings: structuredClone(mappings),
  };
}
function createBeaconConfig(
  sourceId: string,
  sessionId: string,
  pilotName = "",
): SignalBeaconConfigV1 {
  return {
    kind: "ecgaming-signal-config",
    protocol: "ecgsignalv1",
    schemaVersion: 1,
    sourceId,
    sessionId,
    ...(pilotName ? { pilotName } : {}),
    sessionToken: randomUint32(),
    metricOrder: [...SIGNAL_BEACON_METRICS],
    rawEcgIncluded: false,
  };
}
function parseConfig(value: unknown): FlightConfigV1 | undefined {
  const candidate = (
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value);
          } catch {
            return undefined;
          }
        })()
      : value
  ) as FlightConfigV1 | undefined;
  return candidate?.kind === "ecgaming-flight-config" &&
    candidate.protocol === "ecgflightv1" &&
    candidate.schemaVersion === 1 &&
    isFlightSource(candidate.sourceId)
    ? {
        ...candidate,
        ...(sanitizePilotName(candidate.pilotName)
          ? { pilotName: sanitizePilotName(candidate.pilotName) }
          : { pilotName: undefined }),
        mappings: sanitizeMappings(candidate.mappings),
      }
    : undefined;
}

function parseBeaconConfig(value: unknown): SignalBeaconConfigV1 | undefined {
  const candidate = (
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value);
          } catch {
            return undefined;
          }
        })()
      : value
  ) as SignalBeaconConfigV1 | undefined;
  const metricOrder = Array.isArray(candidate?.metricOrder)
    ? candidate.metricOrder
    : [];
  const acceptedMetricOrder = [
    SIGNAL_BEACON_METRICS,
    SIGNAL_BEACON_LEGACY_METRICS,
  ].find(
    (expected) =>
      metricOrder.length === expected.length &&
      metricOrder.every((metric, index) => metric === expected[index]),
  );
  return candidate?.kind === "ecgaming-signal-config" &&
    candidate.protocol === "ecgsignalv1" &&
    candidate.schemaVersion === 1 &&
    isFlightSource(candidate.sourceId) &&
    typeof candidate.sessionId === "string" &&
    candidate.sessionId.length > 0 &&
    Number.isInteger(candidate.sessionToken) &&
    candidate.sessionToken > 0 &&
    candidate.rawEcgIncluded === false &&
    acceptedMetricOrder
    ? {
        ...candidate,
        ...(sanitizePilotName(candidate.pilotName)
          ? { pilotName: sanitizePilotName(candidate.pilotName) }
          : { pilotName: undefined }),
        metricOrder: [...acceptedMetricOrder],
      }
    : undefined;
}

abstract class RemoteBase extends EventTarget {
  protected sdk?: Sdk;
  protected listeners: [string, EventListener][] = [];
  protected timeouts = new Set<ReturnType<typeof setTimeout>>();
  protected intervals = new Set<ReturnType<typeof setInterval>>();
  protected readonly forceTurn: boolean;
  protected readonly now: () => number;
  protected readonly timers: Timers;
  protected readonly makeSdk: () => Sdk;
  constructor(
    options: {
      forceTurn?: boolean;
      now?: () => number;
      timers?: Timers;
      sdkFactory?: () => Sdk;
    } = {},
  ) {
    super();
    this.forceTurn = options.forceTurn ?? forceTurnEnabled();
    this.now = options.now ?? (() => performance.now());
    this.timers = options.timers ?? globalThis;
    this.makeSdk = options.sdkFactory ?? (() => sdkFactory(this.forceTurn));
  }
  protected listen(type: string, handler: EventListener) {
    this.sdk!.addEventListener(type, handler);
    this.listeners.push([type, handler]);
  }
  protected timeout(callback: () => void, ms: number) {
    const id = this.timers.setTimeout(() => {
      this.timeouts.delete(id);
      callback();
    }, ms);
    this.timeouts.add(id);
    return id;
  }
  protected interval(callback: () => void, ms: number) {
    const id = this.timers.setInterval(callback, ms);
    this.intervals.add(id);
    return id;
  }
  protected clearTimer(id?: ReturnType<typeof setTimeout>) {
    if (id !== undefined) {
      this.timers.clearTimeout(id);
      this.timeouts.delete(id);
    }
  }
  protected async disconnectSdk() {
    for (const id of this.timeouts) this.timers.clearTimeout(id);
    for (const id of this.intervals) this.timers.clearInterval(id);
    this.timeouts.clear();
    this.intervals.clear();
    if (this.sdk)
      for (const [type, handler] of this.listeners)
        this.sdk.removeEventListener(type, handler);
    this.listeners = [];
    const current = this.sdk;
    this.sdk = undefined;
    try {
      await current?.disconnect?.();
    } catch {
      /* best effort */
    }
  }
}

export interface BroadcasterSnapshot {
  phase: "idle" | "connecting" | "broadcasting" | "error";
  streamId: string;
  sessionId: string;
  sourceLabel: string;
  listenerCount: number;
  beaconListenerCount: number;
  route: "direct" | "relay" | "unknown";
  rttMs?: number;
  droppedBackpressure: number;
  beaconDroppedBackpressure: number;
  sequence: number;
  beaconSequence: number;
  forceTurnRequested: boolean;
  message?: string;
  error?: boolean;
}

export type SignalBeaconOffer = Omit<
  SignalBeaconFrame,
  "sequence" | "sessionToken"
>;

export class FlightBroadcaster extends RemoteBase {
  private phase: BroadcasterSnapshot["phase"] = "idle";
  private streamId = "";
  private sourceLabel = "";
  private config?: FlightConfigV1;
  private beaconConfig?: SignalBeaconConfigV1;
  private channels = new Map<string, RTCDataChannel>();
  private beaconChannels = new Map<string, RTCDataChannel>();
  private qualities = new Map<
    string,
    { route: "direct" | "relay" | "unknown"; rttMs?: number }
  >();
  private opening = new Set<string>();
  private beaconOpening = new Set<string>();
  private latest?: Omit<FlightFrame, "sequence">;
  private lastSent?: Omit<FlightFrame, "sequence">;
  private sequence = 0;
  private lastSentAt = -Infinity;
  private lastChangedAt = -Infinity;
  private nextChangedAt = -Infinity;
  private heartbeatTimer?: ReturnType<typeof setTimeout>;
  private dropped = 0;
  private latestBeacon?: SignalBeaconOffer;
  private lastSentBeacon?: SignalBeaconOffer;
  private beaconSequence = 0;
  private lastBeaconSentAt = -Infinity;
  private lastBeaconChangedAt = -Infinity;
  private nextBeaconChangedAt = -Infinity;
  private beaconHeartbeatTimer?: ReturnType<typeof setTimeout>;
  private beaconDropped = 0;
  snapshot(extra: Partial<BroadcasterSnapshot> = {}): BroadcasterSnapshot {
    const values = [...this.qualities.values()],
      rtts = values.map((v) => v.rttMs).filter(Number.isFinite) as number[];
    const route = values.some((v) => v.route === "relay")
      ? "relay"
      : values.some((v) => v.route === "direct")
        ? "direct"
        : "unknown";
    return {
      phase: this.phase,
      streamId: this.streamId,
      sessionId: this.config?.sessionId ?? "",
      sourceLabel: this.streamId ? this.sourceLabel : "",
      listenerCount: this.channels.size,
      beaconListenerCount: this.beaconChannels.size,
      route,
      rttMs: rtts.length ? Math.max(...rtts) : undefined,
      droppedBackpressure: this.dropped,
      beaconDroppedBackpressure: this.beaconDropped,
      sequence: this.sequence,
      beaconSequence: this.beaconSequence,
      forceTurnRequested: this.forceTurn,
      ...extra,
    };
  }
  private emit(extra: Partial<BroadcasterSnapshot> = {}) {
    this.dispatchEvent(detailEvent("statechange", this.snapshot(extra)));
  }
  async start(
    mappings: FlightMappings,
    pilotName = "",
  ): Promise<BroadcasterSnapshot> {
    if (this.phase !== "idle" && this.phase !== "error") return this.snapshot();
    await this.stop();
    this.phase = "connecting";
    this.streamId = generateFlightSourceId();
    this.sourceLabel =
      sanitizePilotName(pilotName) || formatSourceLabel(this.streamId);
    const sessionId = randomHex(8);
    this.config = createConfig(
      this.streamId,
      mappings,
      sessionId,
      this.sourceLabel,
    );
    this.beaconConfig = createBeaconConfig(
      this.streamId,
      sessionId,
      this.sourceLabel,
    );
    this.emit({ message: "Connecting to the public flight room…" });
    try {
      this.sdk = this.makeSdk();
      this.listen("dataChannelOpen", ((event: CustomEvent) => {
        const uuid = event.detail?.uuid;
        if (uuid) {
          this.deliverConfig(uuid);
          this.deliverBeaconConfig(uuid);
          void this.openRealtime(uuid);
          void this.openBeacon(uuid);
        }
      }) as EventListener);
      this.listen("dataReceived", ((event: CustomEvent) => {
        if (event.detail?.data?.kind === "ecgaming-config-request")
          this.deliverConfig(event.detail?.uuid);
        if (event.detail?.data?.kind === "ecgaming-signal-config-request")
          this.deliverBeaconConfig(event.detail?.uuid);
      }) as EventListener);
      this.listen("dataChannelClose", ((event: CustomEvent) =>
        this.removePeer(event.detail?.uuid)) as EventListener);
      this.listen("userLeft", ((event: CustomEvent) =>
        this.removePeer(
          event.detail?.UUID ?? event.detail?.uuid,
        )) as EventListener);
      this.listen("error", ((event: CustomEvent) =>
        this.emit({
          message: errorMessage(event.detail?.error ?? event.detail),
          error: true,
        })) as EventListener);
      await this.sdk.connect();
      await this.sdk.joinRoom({ room: FLIGHT_ROOM, password: false });
      await this.sdk.announce({
        streamID: this.streamId,
        label: this.sourceLabel,
        meta: {
          protocol: "ecgflightv1",
          schemaVersion: 1,
          signalProtocol: "ecgsignalv1",
          pilotName: this.sourceLabel,
        },
      });
      this.phase = "broadcasting";
      this.scheduleHeartbeat();
      this.scheduleBeaconHeartbeat();
      this.interval(() => void this.refreshQuality(), 2000);
      this.emit({ message: "Tower is broadcasting normalized game commands." });
      return this.snapshot();
    } catch (error) {
      this.phase = "error";
      this.emit({ message: errorMessage(error), error: true });
      await this.disconnectSdk();
      throw error;
    }
  }
  private deliverConfig(uuid: string) {
    if (!this.sdk || !this.config || !uuid) return false;
    return Boolean(
      this.sdk.sendData(this.config, {
        uuid,
        preference: "any",
        allowFallback: false,
      }),
    );
  }
  private deliverBeaconConfig(uuid: string) {
    if (!this.sdk || !this.beaconConfig || !uuid) return false;
    return Boolean(
      this.sdk.sendData(this.beaconConfig, {
        uuid,
        preference: "any",
        allowFallback: false,
      }),
    );
  }
  private async openRealtime(uuid: string) {
    if (!this.sdk || !uuid || this.channels.has(uuid) || this.opening.has(uuid))
      return;
    this.opening.add(uuid);
    try {
      const channel = await this.sdk.openChannel(uuid, FLIGHT_CHANNEL, {
        ordered: false,
        maxRetransmits: 0,
      });
      channel.binaryType = "arraybuffer";
      channel.bufferedAmountLowThreshold = 0;
      this.channels.set(uuid, channel);
      channel.addEventListener("close", () => this.removePeer(uuid), {
        once: true,
      });
      channel.addEventListener("bufferedamountlow", () =>
        this.flush(true, this.now(), uuid),
      );
      this.deliverConfig(uuid);
      this.flush(true);
      this.emit({ message: "A Flight Deck is receiving commands." });
      void this.refreshQuality();
    } catch (error) {
      this.emit({
        message: `Realtime channel failed: ${errorMessage(error)}`,
        error: true,
      });
    } finally {
      this.opening.delete(uuid);
    }
  }
  private async openBeacon(uuid: string) {
    if (
      !this.sdk ||
      !uuid ||
      this.beaconChannels.has(uuid) ||
      this.beaconOpening.has(uuid)
    )
      return;
    this.beaconOpening.add(uuid);
    try {
      const channel = await this.sdk.openChannel(uuid, SIGNAL_BEACON_CHANNEL, {
        ordered: false,
        maxRetransmits: 0,
      });
      channel.binaryType = "arraybuffer";
      channel.bufferedAmountLowThreshold = 0;
      this.beaconChannels.set(uuid, channel);
      channel.addEventListener("close", () => this.removePeer(uuid), {
        once: true,
      });
      channel.addEventListener("bufferedamountlow", () =>
        this.flushBeacon(true, this.now(), uuid),
      );
      this.deliverBeaconConfig(uuid);
      this.flushBeacon(true);
      this.emit({ message: "A receiver opened the derived-metric beacon." });
      void this.refreshQuality();
    } catch (error) {
      this.emit({
        message: `Signal beacon channel failed: ${errorMessage(error)}`,
        error: true,
      });
    } finally {
      this.beaconOpening.delete(uuid);
    }
  }
  offer(frame: Omit<FlightFrame, "sequence">, offeredAt = this.now()) {
    this.latest = { ...frame };
    const changed =
      !this.lastSent ||
      Object.keys(frame).some(
        (key) => (frame as any)[key] != (this.lastSent as any)[key],
      );
    if (changed && this.readyForChange(offeredAt))
      return this.flush(false, offeredAt);
    return false;
  }
  private readyForChange(time: number) {
    return (
      time - this.lastChangedAt >= MIN_SEPARATION &&
      (!Number.isFinite(this.nextChangedAt) ||
        time + EARLY_TOLERANCE >= this.nextChangedAt)
    );
  }
  private recordChanged(time: number) {
    this.lastChangedAt = time;
    if (
      !Number.isFinite(this.nextChangedAt) ||
      time > this.nextChangedAt + MIN_INTERVAL
    )
      this.nextChangedAt = time + MIN_INTERVAL;
    else this.nextChangedAt += MIN_INTERVAL;
  }
  flush(force = false, time = this.now(), onlyUuid?: string) {
    if (
      this.phase !== "broadcasting" ||
      !this.latest ||
      this.channels.size === 0
    )
      return false;
    const changed =
      !this.lastSent ||
      Object.keys(this.latest).some(
        (key) => (this.latest as any)[key] != (this.lastSent as any)[key],
      );
    if (!force && (!changed || !this.readyForChange(time))) return false;
    const sequence = (this.sequence + 1) >>> 0,
      bytes = encodeFlightFrame({ ...this.latest, sequence });
    let sent = false;
    const entries = onlyUuid
      ? [[onlyUuid, this.channels.get(onlyUuid)] as const]
      : [...this.channels.entries()];
    for (const [_uuid, channel] of entries) {
      if (!channel || channel.readyState !== "open") continue;
      if (channel.bufferedAmount > 0) {
        this.dropped += 1;
        continue;
      }
      try {
        channel.send(bytes);
        sent = true;
      } catch {
        /* close owns cleanup */
      }
    }
    if (sent) {
      this.sequence = sequence;
      this.lastSent = { ...this.latest };
      this.lastSentAt = time;
      if (changed) this.recordChanged(time);
      this.scheduleHeartbeat();
    }
    return sent;
  }
  private scheduleHeartbeat() {
    if (this.phase !== "broadcasting") return;
    this.clearTimer(this.heartbeatTimer);
    this.heartbeatTimer = this.timeout(() => {
      this.heartbeatTimer = undefined;
      if (this.now() - this.lastSentAt >= FLIGHT_HEARTBEAT_MS) this.flush(true);
      this.scheduleHeartbeat();
    }, FLIGHT_HEARTBEAT_MS);
  }
  offerBeacon(frame: SignalBeaconOffer, offeredAt = this.now()) {
    this.latestBeacon = {
      ...frame,
      metrics: Object.fromEntries(
        Object.entries(frame.metrics).filter(([, value]) =>
          Number.isFinite(value),
        ),
      ) as SignalBeaconOffer["metrics"],
    };
    if (
      this.beaconChanged(this.latestBeacon, this.lastSentBeacon) &&
      this.readyForBeaconChange(offeredAt)
    )
      return this.flushBeacon(false, offeredAt);
    return false;
  }
  private beaconChanged(
    value: SignalBeaconOffer,
    previous?: SignalBeaconOffer,
  ) {
    if (!previous) return true;
    for (const key of [
      "ecgBeatCounter",
      "rrBeatCounter",
      "ecgBeatAgeMs",
      "rrBeatAgeMs",
      "ecgBeatQuality",
      "rrBeatQuality",
      "flags",
    ] as const)
      if (value[key] !== previous[key]) return true;
    return SIGNAL_BEACON_METRICS.some(
      (metric) => value.metrics[metric] !== previous.metrics[metric],
    );
  }
  private readyForBeaconChange(time: number) {
    return (
      time - this.lastBeaconChangedAt >= BEACON_MIN_SEPARATION &&
      (!Number.isFinite(this.nextBeaconChangedAt) ||
        time + EARLY_TOLERANCE >= this.nextBeaconChangedAt)
    );
  }
  private recordBeaconChanged(time: number) {
    this.lastBeaconChangedAt = time;
    if (
      !Number.isFinite(this.nextBeaconChangedAt) ||
      time > this.nextBeaconChangedAt + BEACON_MIN_INTERVAL
    )
      this.nextBeaconChangedAt = time + BEACON_MIN_INTERVAL;
    else this.nextBeaconChangedAt += BEACON_MIN_INTERVAL;
  }
  flushBeacon(force = false, time = this.now(), onlyUuid?: string) {
    if (
      this.phase !== "broadcasting" ||
      !this.latestBeacon ||
      !this.beaconConfig ||
      this.beaconChannels.size === 0
    )
      return false;
    const changed = this.beaconChanged(this.latestBeacon, this.lastSentBeacon);
    if (!force && (!changed || !this.readyForBeaconChange(time))) return false;
    const sequence = (this.beaconSequence + 1) >>> 0,
      bytes = encodeSignalBeaconFrame({
        ...this.latestBeacon,
        sequence,
        sessionToken: this.beaconConfig.sessionToken,
      });
    let sent = false;
    const entries = onlyUuid
      ? [[onlyUuid, this.beaconChannels.get(onlyUuid)] as const]
      : [...this.beaconChannels.entries()];
    for (const [_uuid, channel] of entries) {
      if (!channel || channel.readyState !== "open") continue;
      if (channel.bufferedAmount > 0) {
        this.beaconDropped += 1;
        continue;
      }
      try {
        channel.send(bytes);
        sent = true;
      } catch {
        /* close owns cleanup */
      }
    }
    if (sent) {
      this.beaconSequence = sequence;
      this.lastSentBeacon = {
        ...this.latestBeacon,
        metrics: { ...this.latestBeacon.metrics },
      };
      this.lastBeaconSentAt = time;
      if (changed) this.recordBeaconChanged(time);
      this.scheduleBeaconHeartbeat();
    }
    return sent;
  }
  private scheduleBeaconHeartbeat() {
    if (this.phase !== "broadcasting") return;
    this.clearTimer(this.beaconHeartbeatTimer);
    this.beaconHeartbeatTimer = this.timeout(() => {
      this.beaconHeartbeatTimer = undefined;
      if (this.now() - this.lastBeaconSentAt >= SIGNAL_BEACON_HEARTBEAT_MS)
        this.flushBeacon(true);
      this.scheduleBeaconHeartbeat();
    }, SIGNAL_BEACON_HEARTBEAT_MS);
  }
  private removePeer(uuid: string) {
    if (!uuid) return;
    this.channels.get(uuid)?.close();
    if (this.beaconChannels.get(uuid) !== this.channels.get(uuid))
      this.beaconChannels.get(uuid)?.close();
    this.channels.delete(uuid);
    this.beaconChannels.delete(uuid);
    this.qualities.delete(uuid);
    this.opening.delete(uuid);
    this.beaconOpening.delete(uuid);
    this.emit();
  }
  private async refreshQuality() {
    if (!this.sdk?.getPeerQuality) return;
    await Promise.all(
      [...new Set([...this.channels.keys(), ...this.beaconChannels.keys()])].map(
        async (uuid) => {
        try {
          const q = await this.sdk!.getPeerQuality!(uuid);
          this.qualities.set(uuid, {
            route:
              q.relayed === true
                ? "relay"
                : q.relayed === false
                  ? "direct"
                  : "unknown",
            rttMs: Number.isFinite(q.rttMs) ? Math.round(q.rttMs!) : undefined,
          });
        } catch {
          this.qualities.delete(uuid);
        }
        },
      ),
    );
    if (this.phase === "broadcasting") this.emit();
  }
  async stop() {
    const had = Boolean(this.sdk);
    this.phase = "idle";
    for (const channel of this.channels.values())
      try {
        channel.close();
      } catch {}
    for (const channel of this.beaconChannels.values())
      if (![...this.channels.values()].includes(channel))
        try {
          channel.close();
        } catch {}
    this.channels.clear();
    this.beaconChannels.clear();
    this.qualities.clear();
    this.opening.clear();
    this.beaconOpening.clear();
    this.latest = undefined;
    this.lastSent = undefined;
    this.streamId = "";
    this.sourceLabel = "";
    this.config = undefined;
    this.beaconConfig = undefined;
    this.sequence = 0;
    this.lastSentAt = -Infinity;
    this.lastChangedAt = -Infinity;
    this.nextChangedAt = -Infinity;
    this.dropped = 0;
    this.latestBeacon = undefined;
    this.lastSentBeacon = undefined;
    this.beaconSequence = 0;
    this.lastBeaconSentAt = -Infinity;
    this.lastBeaconChangedAt = -Infinity;
    this.nextBeaconChangedAt = -Infinity;
    this.beaconDropped = 0;
    await this.disconnectSdk();
    if (had) this.emit({ message: "Broadcast stopped." });
  }
}

export class FlightReceiver extends RemoteBase {
  private phase: FlightReceiverSnapshot["phase"] = "idle";
  private sources = new Map<string, RemoteSource>();
  private selectedStreamId = "";
  private selectedUuid = "";
  private channel?: RTCDataChannel;
  private beaconChannel?: RTCDataChannel;
  private config?: FlightConfigV1;
  private beaconConfig?: SignalBeaconConfigV1;
  private latest?: FlightFrame & { receivedAt: number };
  private latestBeacon?: SignalBeaconFrame & { receivedAt: number };
  private lastSequence?: number;
  private lastBeaconSequence?: number;
  private beaconPhase: FlightReceiverSnapshot["beacon"]["phase"] =
    "unavailable";
  private route: "direct" | "relay" | "unknown" = "unknown";
  private rttMs?: number;
  private discoveryTimer?: ReturnType<typeof setTimeout>;
  private staleTimer?: ReturnType<typeof setTimeout>;
  private beaconStaleTimer?: ReturnType<typeof setTimeout>;
  private recoveryFrames = 0;
  private gaps: number[] = [];
  private receivedFrames = 0;
  private sequenceGaps = 0;
  private staleTransitions = 0;
  snapshot(at = this.now()): FlightReceiverSnapshot {
    const age = this.latest
      ? Math.max(0, at - this.latest.receivedAt)
      : undefined;
    const beaconAge = this.latestBeacon
      ? Math.max(0, at - this.latestBeacon.receivedAt)
      : undefined;
    const beaconFresh =
      this.beaconPhase === "live" &&
      beaconAge !== undefined &&
      beaconAge < SIGNAL_BEACON_STALE_MS;
    return {
      phase: this.phase,
      sources: [...this.sources.values()].sort((a, b) =>
        a.label.localeCompare(b.label),
      ),
      selectedStreamId: this.selectedStreamId,
      sourceLabel: this.selectedStreamId
        ? (this.sources.get(this.selectedStreamId)?.label ??
          formatSourceLabel(this.selectedStreamId))
        : "",
      latest: this.latest ? { ...this.latest } : undefined,
      config: this.config ? structuredClone(this.config) : undefined,
      packetAgeMs: age,
      route: this.route,
      rttMs: this.rttMs,
      recoveryFrames: this.recoveryFrames,
      beacon: {
        phase: beaconFresh
          ? "live"
          : this.beaconPhase === "live"
            ? "stale"
            : this.beaconPhase,
        config: this.beaconConfig
          ? structuredClone(this.beaconConfig)
          : undefined,
        latest: this.latestBeacon
          ? {
              ...this.latestBeacon,
              metrics: { ...this.latestBeacon.metrics },
            }
          : undefined,
        packetAgeMs: beaconAge,
        fresh: beaconFresh,
      },
      diagnostics: {
        receivedFrames: this.receivedFrames,
        p95GapMs: this.percentile(0.95),
        maxGapMs: this.gaps.length
          ? Math.round(Math.max(...this.gaps))
          : undefined,
        sequenceGaps: this.sequenceGaps,
        staleTransitions: this.staleTransitions,
      },
    };
  }
  private emit(extra: Record<string, unknown> = {}) {
    this.dispatchEvent(
      detailEvent("statechange", { ...this.snapshot(), ...extra }),
    );
  }
  private addSource(value: unknown) {
    const source = sourceItem(value);
    if (!isFlightSource(source.streamId)) return;
    const old = this.sources.get(source.streamId);
    if (old) {
      if (source.uuid) old.uuid = source.uuid;
      if (source.label !== formatSourceLabel(source.streamId))
        old.label = source.label;
    } else this.sources.set(source.streamId, source);
    this.scheduleAuto();
    this.emit();
  }
  private addListing(detail: any) {
    if (Array.isArray(detail?.list))
      detail.list.forEach((v: unknown) => this.addSource(v));
    else this.addSource(detail);
  }
  private removeSource(identifier: string) {
    for (const [id, source] of this.sources)
      if (id === identifier || source.uuid === identifier) {
        this.sources.delete(id);
        if (id === this.selectedStreamId)
          this.markStale("The selected Ground Control source left the room.");
        if (id === this.selectedStreamId)
          this.markBeaconStale(
            "The selected Ground Control beacon left the room.",
          );
      }
    this.emit();
  }
  private scheduleAuto() {
    if (this.discoveryTimer || this.selectedStreamId) return;
    this.discoveryTimer = this.timeout(() => {
      this.discoveryTimer = undefined;
      if (this.sources.size === 1)
        void this.selectSource([...this.sources.keys()][0]!);
      else {
        this.phase = this.sources.size > 1 ? "selecting" : "discovering";
        this.emit();
      }
    }, DISCOVERY_SETTLE_MS);
  }
  async startDiscovery() {
    if (this.phase !== "idle" && this.phase !== "error") return this.snapshot();
    await this.stop();
    this.phase = "discovering";
    this.emit({ message: "Looking for public Ground Control broadcasts…" });
    try {
      this.sdk = this.makeSdk();
      this.listen("listing", ((event: CustomEvent) =>
        this.addListing(event.detail)) as EventListener);
      this.listen("videoaddedtoroom", ((event: CustomEvent) =>
        this.addSource(event.detail)) as EventListener);
      this.listen("userLeft", ((event: CustomEvent) =>
        this.removeSource(
          event.detail?.UUID ?? event.detail?.uuid ?? event.detail?.streamID,
        )) as EventListener);
      this.listen("dataChannelOpen", ((event: CustomEvent) => {
        this.requestConfig(event.detail);
      }) as EventListener);
      this.listen("dataReceived", ((event: CustomEvent) => {
        this.acceptConfig(event.detail);
      }) as EventListener);
      this.listen("channelOpen", ((event: CustomEvent) =>
        this.acceptChannel(event.detail)) as EventListener);
      this.listen("dataChannelClose", ((event: CustomEvent) => {
        if (event.detail?.label === `x-${SIGNAL_BEACON_CHANNEL}`)
          this.markBeaconStale("The derived-metric beacon channel closed.");
        else this.armStale("The realtime connection closed.");
      }) as EventListener);
      this.listen("error", ((event: CustomEvent) =>
        this.emit({
          message: errorMessage(event.detail?.error ?? event.detail),
          error: true,
        })) as EventListener);
      await this.sdk.connect();
      await this.sdk.joinRoom({ room: FLIGHT_ROOM, password: false });
      this.interval(() => void this.refreshQuality(), 2000);
      this.scheduleAuto();
      this.emit();
      return this.snapshot();
    } catch (error) {
      this.phase = "error";
      this.emit({ message: errorMessage(error), error: true });
      await this.disconnectSdk();
      throw error;
    }
  }
  async selectSource(streamId: string) {
    if (!this.sdk || !isFlightSource(streamId)) return this.snapshot();
    if (this.selectedStreamId && this.selectedStreamId !== streamId)
      try {
        await this.sdk.stopViewing?.(this.selectedStreamId);
      } catch {}
    const source = this.sources.get(streamId);
    this.selectedStreamId = streamId;
    this.selectedUuid = source?.uuid ?? "";
    this.channel = undefined;
    this.beaconChannel = undefined;
    this.config = undefined;
    this.beaconConfig = undefined;
    this.latest = undefined;
    this.latestBeacon = undefined;
    this.lastSequence = undefined;
    this.lastBeaconSequence = undefined;
    this.beaconPhase = "unavailable";
    this.clearTimer(this.beaconStaleTimer);
    this.phase = "connecting";
    this.emit({ message: `Connecting to ${formatSourceLabel(streamId)}…` });
    try {
      await this.sdk.view(streamId, {
        audio: false,
        video: false,
        downloads: false,
        allowresources: false,
        label: "EC Gaming Flight Deck data receiver",
      });
    } catch (error) {
      this.phase = "error";
      this.emit({ message: errorMessage(error), error: true });
    }
    return this.snapshot();
  }
  private requestConfig(detail: any) {
    if (!this.sdk || !this.selectedStreamId) return false;
    if (detail?.streamID && detail.streamID !== this.selectedStreamId)
      return false;
    if (this.selectedUuid && detail?.uuid && detail.uuid !== this.selectedUuid)
      return false;
    this.selectedUuid = detail?.uuid ?? this.selectedUuid;
    if (!this.selectedUuid) return false;
    const target = {
      uuid: this.selectedUuid,
      preference: "any",
      allowFallback: false,
    };
    const flightRequested = Boolean(
      this.sdk.sendData(
        { kind: "ecgaming-config-request", protocol: "ecgflightv1" },
        target,
      ),
    );
    const beaconRequested = Boolean(
      this.sdk.sendData(
        { kind: "ecgaming-signal-config-request", protocol: "ecgsignalv1" },
        target,
      ),
    );
    return flightRequested || beaconRequested;
  }
  private acceptConfig(detail: any) {
    if (!this.selectedStreamId || !detail) return false;
    if (this.selectedUuid && detail.uuid && detail.uuid !== this.selectedUuid)
      return false;
    const config = parseConfig(detail.data);
    if (config) {
      if (
        config.sourceId !== this.selectedStreamId ||
        (this.beaconConfig &&
          this.beaconConfig.sessionId !== config.sessionId)
      )
        return false;
      this.config = config;
      const pilotName = sanitizePilotName(config.pilotName);
      if (pilotName) {
        const source = this.sources.get(config.sourceId);
        if (source) source.label = pilotName;
      }
      this.selectedUuid = detail.uuid ?? this.selectedUuid;
      if (this.phase === "connecting") this.phase = "ready";
      this.dispatchEvent(detailEvent("config", this.snapshot()));
      this.emit({ message: "Flight configuration received and validated." });
      return true;
    }
    const beaconConfig = parseBeaconConfig(detail.data);
    if (
      !beaconConfig ||
      beaconConfig.sourceId !== this.selectedStreamId ||
      (this.config && this.config.sessionId !== beaconConfig.sessionId)
    )
      return false;
    const beaconSessionChanged = Boolean(
      this.beaconConfig &&
        (this.beaconConfig.sessionId !== beaconConfig.sessionId ||
          this.beaconConfig.sessionToken !== beaconConfig.sessionToken),
    );
    this.beaconConfig = beaconConfig;
    const pilotName = sanitizePilotName(beaconConfig.pilotName);
    if (pilotName) {
      const source = this.sources.get(beaconConfig.sourceId);
      if (source) source.label = pilotName;
    }
    if (beaconSessionChanged) {
      this.latestBeacon = undefined;
      this.lastBeaconSequence = undefined;
      this.clearTimer(this.beaconStaleTimer);
      this.beaconPhase = "ready";
    }
    this.selectedUuid = detail.uuid ?? this.selectedUuid;
    if (this.beaconPhase === "unavailable") this.beaconPhase = "ready";
    this.dispatchEvent(detailEvent("beaconconfig", this.snapshot()));
    this.emit({ message: "Derived-metric beacon configuration validated." });
    return true;
  }
  private acceptChannel(detail: any) {
    if (
      !detail ||
      ![`x-${FLIGHT_CHANNEL}`, `x-${SIGNAL_BEACON_CHANNEL}`].includes(
        detail.label,
      ) ||
      !this.selectedStreamId
    )
      return;
    if (detail.streamID && detail.streamID !== this.selectedStreamId) return;
    if (this.selectedUuid && detail.uuid && detail.uuid !== this.selectedUuid)
      return;
    this.selectedUuid = detail.uuid ?? this.selectedUuid;
    if (detail.label === `x-${SIGNAL_BEACON_CHANNEL}`) {
      this.beaconChannel = detail.channel;
      const beacon = this.beaconChannel!;
      beacon.binaryType = "arraybuffer";
      beacon.addEventListener("message", (event) =>
        this.acceptBeaconFrame(event.data),
      );
      beacon.addEventListener(
        "close",
        () => this.markBeaconStale("The derived-metric beacon channel closed."),
        { once: true },
      );
      void this.refreshQuality();
      this.emit({
        message: "Derived-metric beacon open; waiting for telemetry…",
      });
      return;
    }
    this.channel = detail.channel;
    const accepted = this.channel!;
    accepted.binaryType = "arraybuffer";
    accepted.addEventListener("message", (event) =>
      this.acceptFrame(event.data),
    );
    accepted.addEventListener(
      "close",
      () => this.armStale("The realtime flight channel closed."),
      { once: true },
    );
    void this.refreshQuality();
    this.emit({
      message: "Realtime channel open; waiting for command frames…",
    });
  }
  acceptFrame(value: unknown, receivedAt = this.now()) {
    const frame = decodeFlightFrame(value);
    if (!frame || !isNewerSequence(frame.sequence, this.lastSequence))
      return false;
    const previousAt = this.latest?.receivedAt,
      previousSeq = this.lastSequence,
      gap = previousAt === undefined ? undefined : receivedAt - previousAt;
    if (gap !== undefined) {
      this.gaps.push(Math.max(0, gap));
      if (this.gaps.length > 128) this.gaps.shift();
    }
    if (previousSeq !== undefined) {
      const distance = ((frame.sequence >>> 0) - (previousSeq >>> 0)) >>> 0;
      if (distance > 1 && distance < 0x80000000)
        this.sequenceGaps += distance - 1;
    }
    const wasStale = this.phase === "stale";
    this.latest = { ...frame, receivedAt };
    this.lastSequence = frame.sequence;
    this.receivedFrames += 1;
    if (wasStale)
      this.recoveryFrames =
        gap !== undefined && gap < FLIGHT_STALE_MS
          ? this.recoveryFrames + 1
          : 1;
    else this.recoveryFrames = 0;
    const recovered = wasStale && this.recoveryFrames >= FLIGHT_RECOVERY_FRAMES;
    this.phase = wasStale && !recovered ? "stale" : "live";
    this.clearTimer(this.staleTimer);
    if (this.phase === "live")
      this.staleTimer = this.timeout(() => this.checkStale(), FLIGHT_STALE_MS);
    this.dispatchEvent(detailEvent("frame", this.snapshot(receivedAt)));
    if (recovered) {
      this.recoveryFrames = 0;
      this.emit({
        transition: "recovered",
        message: "Command link recovered after three consecutive frames.",
      });
    } else if (!wasStale && this.receivedFrames === 1)
      this.emit({
        transition: "live",
        message: "Live command stream received.",
      });
    return true;
  }
  acceptBeaconFrame(value: unknown, receivedAt = this.now()) {
    const frame = decodeSignalBeaconFrame(value);
    if (
      !frame ||
      !this.beaconConfig ||
      frame.sessionToken !== this.beaconConfig.sessionToken ||
      !isNewerSequence(frame.sequence, this.lastBeaconSequence) ||
      !Number.isFinite(receivedAt)
    )
      return false;
    this.latestBeacon = {
      ...frame,
      metrics: { ...frame.metrics },
      receivedAt,
    };
    this.lastBeaconSequence = frame.sequence;
    this.beaconPhase = "live";
    this.clearTimer(this.beaconStaleTimer);
    this.beaconStaleTimer = this.timeout(
      () => this.checkBeaconStale(),
      SIGNAL_BEACON_STALE_MS,
    );
    this.dispatchEvent(detailEvent("beaconframe", this.snapshot(receivedAt)));
    this.emit({ message: "Fresh derived-metric beacon telemetry received." });
    return true;
  }
  private checkStale() {
    if (
      this.phase === "live" &&
      this.latest &&
      this.now() - this.latest.receivedAt >= FLIGHT_STALE_MS
    )
      this.markStale("No command frame arrived for two seconds.");
  }
  private armStale(message: string) {
    if (this.phase !== "live" || !this.latest) {
      this.markStale(message);
      return;
    }
    const remaining = Math.max(
      0,
      FLIGHT_STALE_MS - (this.now() - this.latest.receivedAt),
    );
    this.clearTimer(this.staleTimer);
    this.staleTimer = this.timeout(() => this.markStale(message), remaining);
  }
  private markStale(message: string) {
    if (!this.selectedStreamId) return;
    if (this.phase !== "stale") {
      this.phase = "stale";
      this.recoveryFrames = 0;
      this.staleTransitions += 1;
      this.emit({ transition: "stale", message });
    }
  }
  private checkBeaconStale() {
    if (
      this.beaconPhase === "live" &&
      this.latestBeacon &&
      this.now() - this.latestBeacon.receivedAt >= SIGNAL_BEACON_STALE_MS
    )
      this.markBeaconStale("No signal beacon frame arrived for two seconds.");
  }
  private markBeaconStale(message: string) {
    if (!this.selectedStreamId || this.beaconPhase === "unavailable") return;
    if (this.beaconPhase !== "stale") {
      this.beaconPhase = "stale";
      this.emit({ transition: "beacon-stale", message });
    }
  }
  private percentile(proportion: number) {
    if (!this.gaps.length) return undefined;
    const sorted = [...this.gaps].sort((a, b) => a - b);
    return Math.round(
      sorted[
        Math.min(
          sorted.length - 1,
          Math.max(0, Math.ceil(sorted.length * proportion) - 1),
        )
      ]!,
    );
  }
  private async refreshQuality() {
    if (!this.sdk?.getPeerQuality || !this.selectedUuid) return;
    try {
      const quality = await this.sdk.getPeerQuality(this.selectedUuid);
      this.route =
        quality.relayed === true
          ? "relay"
          : quality.relayed === false
            ? "direct"
            : "unknown";
      this.rttMs = Number.isFinite(quality.rttMs)
        ? Math.round(quality.rttMs!)
        : undefined;
      this.emit();
    } catch {
      this.route = "unknown";
      this.rttMs = undefined;
    }
  }
  async stop() {
    const previous = this.selectedStreamId;
    if (this.sdk && previous)
      try {
        await this.sdk.stopViewing?.(previous);
      } catch {}
    this.channel?.close();
    if (this.beaconChannel !== this.channel) this.beaconChannel?.close();
    await this.disconnectSdk();
    this.phase = "idle";
    this.sources.clear();
    this.selectedStreamId = "";
    this.selectedUuid = "";
    this.channel = undefined;
    this.beaconChannel = undefined;
    this.config = undefined;
    this.beaconConfig = undefined;
    this.latest = undefined;
    this.latestBeacon = undefined;
    this.lastSequence = undefined;
    this.lastBeaconSequence = undefined;
    this.beaconPhase = "unavailable";
    this.route = "unknown";
    this.rttMs = undefined;
    this.recoveryFrames = 0;
    this.gaps = [];
    this.receivedFrames = 0;
    this.sequenceGaps = 0;
    this.staleTransitions = 0;
    this.emit();
  }
}
