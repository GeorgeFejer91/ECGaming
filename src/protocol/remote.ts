import {
  decodeFlightFrame,
  encodeFlightFrame,
  FLIGHT_HEARTBEAT_MS,
  FLIGHT_MAX_HZ,
  FLIGHT_RECOVERY_FRAMES,
  FLIGHT_STALE_MS,
  isNewerSequence,
} from "./flight-frame";
import type {
  FlightConfigV1,
  FlightFrame,
  FlightMappings,
  FlightReceiverSnapshot,
  RemoteSource,
} from "./types";
import { sanitizeMappings } from "../signals/mappings";

export const FLIGHT_ROOM = "ecgaming_flight_v1";
export const FLIGHT_SOURCE_PREFIX = "ecg_ground_";
export const FLIGHT_CHANNEL = "ecgflightv1";
export const FLIGHT_FORCE_TURN_PARAM = "remote-force-turn";
const DISCOVERY_SETTLE_MS = 300,
  MIN_INTERVAL = 1000 / FLIGHT_MAX_HZ,
  EARLY_TOLERANCE = 5,
  MIN_SEPARATION = MIN_INTERVAL - EARLY_TOLERANCE;

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
  return {
    streamId,
    uuid: String(value?.UUID ?? value?.uuid ?? ""),
    label: formatSourceLabel(streamId),
  };
};

function createConfig(
  sourceId: string,
  mappings: FlightMappings,
): FlightConfigV1 {
  return {
    kind: "ecgaming-flight-config",
    protocol: "ecgflightv1",
    schemaVersion: 1,
    sourceId,
    sessionId: randomHex(8),
    createdAt: new Date().toISOString(),
    mappings: structuredClone(mappings),
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
    ? { ...candidate, mappings: sanitizeMappings(candidate.mappings) }
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
  route: "direct" | "relay" | "unknown";
  rttMs?: number;
  droppedBackpressure: number;
  sequence: number;
  forceTurnRequested: boolean;
  message?: string;
  error?: boolean;
}

export class FlightBroadcaster extends RemoteBase {
  private phase: BroadcasterSnapshot["phase"] = "idle";
  private streamId = "";
  private config?: FlightConfigV1;
  private channels = new Map<string, RTCDataChannel>();
  private qualities = new Map<
    string,
    { route: "direct" | "relay" | "unknown"; rttMs?: number }
  >();
  private opening = new Set<string>();
  private latest?: Omit<FlightFrame, "sequence">;
  private lastSent?: Omit<FlightFrame, "sequence">;
  private sequence = 0;
  private lastSentAt = -Infinity;
  private lastChangedAt = -Infinity;
  private nextChangedAt = -Infinity;
  private heartbeatTimer?: ReturnType<typeof setTimeout>;
  private dropped = 0;
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
      sourceLabel: this.streamId ? formatSourceLabel(this.streamId) : "",
      listenerCount: this.channels.size,
      route,
      rttMs: rtts.length ? Math.max(...rtts) : undefined,
      droppedBackpressure: this.dropped,
      sequence: this.sequence,
      forceTurnRequested: this.forceTurn,
      ...extra,
    };
  }
  private emit(extra: Partial<BroadcasterSnapshot> = {}) {
    this.dispatchEvent(detailEvent("statechange", this.snapshot(extra)));
  }
  async start(mappings: FlightMappings): Promise<BroadcasterSnapshot> {
    if (this.phase !== "idle" && this.phase !== "error") return this.snapshot();
    await this.stop();
    this.phase = "connecting";
    this.streamId = generateFlightSourceId();
    this.config = createConfig(this.streamId, mappings);
    this.emit({ message: "Connecting to the public flight room…" });
    try {
      this.sdk = this.makeSdk();
      this.listen("dataChannelOpen", ((event: CustomEvent) => {
        const uuid = event.detail?.uuid;
        if (uuid) {
          this.deliverConfig(uuid);
          void this.openRealtime(uuid);
        }
      }) as EventListener);
      this.listen("dataReceived", ((event: CustomEvent) => {
        if (event.detail?.data?.kind === "ecgaming-config-request")
          this.deliverConfig(event.detail?.uuid);
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
        label: formatSourceLabel(this.streamId),
        meta: { protocol: "ecgflightv1", schemaVersion: 1 },
      });
      this.phase = "broadcasting";
      this.scheduleHeartbeat();
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
  private removePeer(uuid: string) {
    if (!uuid) return;
    this.channels.get(uuid)?.close();
    this.channels.delete(uuid);
    this.qualities.delete(uuid);
    this.opening.delete(uuid);
    this.emit();
  }
  private async refreshQuality() {
    if (!this.sdk?.getPeerQuality) return;
    await Promise.all(
      [...this.channels.keys()].map(async (uuid) => {
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
      }),
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
    this.channels.clear();
    this.qualities.clear();
    this.opening.clear();
    this.latest = undefined;
    this.lastSent = undefined;
    this.streamId = "";
    this.config = undefined;
    this.sequence = 0;
    this.lastSentAt = -Infinity;
    this.lastChangedAt = -Infinity;
    this.nextChangedAt = -Infinity;
    this.dropped = 0;
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
  private config?: FlightConfigV1;
  private latest?: FlightFrame & { receivedAt: number };
  private lastSequence?: number;
  private route: "direct" | "relay" | "unknown" = "unknown";
  private rttMs?: number;
  private discoveryTimer?: ReturnType<typeof setTimeout>;
  private staleTimer?: ReturnType<typeof setTimeout>;
  private recoveryFrames = 0;
  private gaps: number[] = [];
  private receivedFrames = 0;
  private sequenceGaps = 0;
  private staleTransitions = 0;
  snapshot(at = this.now()): FlightReceiverSnapshot {
    const age = this.latest
      ? Math.max(0, at - this.latest.receivedAt)
      : undefined;
    return {
      phase: this.phase,
      sources: [...this.sources.values()].sort((a, b) =>
        a.label.localeCompare(b.label),
      ),
      selectedStreamId: this.selectedStreamId,
      sourceLabel: this.selectedStreamId
        ? formatSourceLabel(this.selectedStreamId)
        : "",
      latest: this.latest ? { ...this.latest } : undefined,
      config: this.config ? structuredClone(this.config) : undefined,
      packetAgeMs: age,
      route: this.route,
      rttMs: this.rttMs,
      recoveryFrames: this.recoveryFrames,
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
      this.listen("dataChannelClose", (() =>
        this.armStale("The realtime connection closed.")) as EventListener);
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
    this.config = undefined;
    this.latest = undefined;
    this.lastSequence = undefined;
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
    return Boolean(
      this.sdk.sendData(
        { kind: "ecgaming-config-request", protocol: "ecgflightv1" },
        { uuid: this.selectedUuid, preference: "any", allowFallback: false },
      ),
    );
  }
  private acceptConfig(detail: any) {
    if (!this.selectedStreamId || !detail) return false;
    if (this.selectedUuid && detail.uuid && detail.uuid !== this.selectedUuid)
      return false;
    const config = parseConfig(detail.data);
    if (!config || config.sourceId !== this.selectedStreamId) return false;
    this.config = config;
    this.selectedUuid = detail.uuid ?? this.selectedUuid;
    if (this.phase === "connecting") this.phase = "ready";
    this.dispatchEvent(detailEvent("config", this.snapshot()));
    this.emit({ message: "Flight configuration received and validated." });
    return true;
  }
  private acceptChannel(detail: any) {
    if (
      !detail ||
      detail.label !== `x-${FLIGHT_CHANNEL}` ||
      !this.selectedStreamId
    )
      return;
    if (detail.streamID && detail.streamID !== this.selectedStreamId) return;
    if (this.selectedUuid && detail.uuid && detail.uuid !== this.selectedUuid)
      return;
    this.selectedUuid = detail.uuid ?? this.selectedUuid;
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
    await this.disconnectSdk();
    this.phase = "idle";
    this.sources.clear();
    this.selectedStreamId = "";
    this.selectedUuid = "";
    this.channel = undefined;
    this.config = undefined;
    this.latest = undefined;
    this.lastSequence = undefined;
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
