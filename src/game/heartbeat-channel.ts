export const GAME_HEARTBEAT_CHANNEL = "ecgaming-heartbeat-v1";
export const GAME_HEARTBEAT_KIND = "ecgaming-heartbeat";
export const GAME_HEARTBEAT_VERSION = 1;
export const GAME_HEARTBEAT_MAX_AGE_MS = 250;

export type GameHeartbeatSource = "ecg-rpeak" | "polar-rr";
export type GameHeartbeatRoute =
  | "ground-control"
  | "mobile-direct"
  | "flight-deck";

export interface GameHeartbeatMessage {
  kind: typeof GAME_HEARTBEAT_KIND;
  version: typeof GAME_HEARTBEAT_VERSION;
  route: GameHeartbeatRoute;
  source: GameHeartbeatSource;
  beatCounter: number;
  ageMs: number;
  confidence: number;
  physicalPolar: boolean;
  simulated: boolean;
  ready: boolean;
  sentAtEpochMs: number;
}

export type GameHeartbeatInput = Omit<
  GameHeartbeatMessage,
  "kind" | "version" | "route" | "sentAtEpochMs"
>;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function createGameHeartbeatMessage(
  route: GameHeartbeatRoute,
  input: GameHeartbeatInput,
  sentAtEpochMs = Date.now(),
): GameHeartbeatMessage {
  return {
    kind: GAME_HEARTBEAT_KIND,
    version: GAME_HEARTBEAT_VERSION,
    route,
    source: input.source,
    beatCounter: input.beatCounter >>> 0,
    ageMs: Math.max(0, input.ageMs),
    confidence: Math.max(0, Math.min(1, input.confidence)),
    physicalPolar: input.physicalPolar,
    simulated: input.simulated,
    ready: input.ready,
    sentAtEpochMs,
  };
}

export function isGameHeartbeatMessage(
  value: unknown,
): value is GameHeartbeatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<GameHeartbeatMessage>;
  return (
    message.kind === GAME_HEARTBEAT_KIND &&
    message.version === GAME_HEARTBEAT_VERSION &&
    ["ground-control", "mobile-direct", "flight-deck"].includes(
      String(message.route),
    ) &&
    ["ecg-rpeak", "polar-rr"].includes(String(message.source)) &&
    finite(message.beatCounter) &&
    message.beatCounter >= 0 &&
    finite(message.ageMs) &&
    message.ageMs >= 0 &&
    finite(message.confidence) &&
    message.confidence >= 0 &&
    message.confidence <= 1 &&
    typeof message.physicalPolar === "boolean" &&
    typeof message.simulated === "boolean" &&
    typeof message.ready === "boolean" &&
    finite(message.sentAtEpochMs)
  );
}

export function isFreshGameHeartbeatMessage(
  value: unknown,
  nowEpochMs = Date.now(),
  maxTransportAgeMs = 500,
): value is GameHeartbeatMessage {
  if (!isGameHeartbeatMessage(value) || !value.ready) return false;
  const transportAge = nowEpochMs - value.sentAtEpochMs;
  return (
    value.ageMs <= GAME_HEARTBEAT_MAX_AGE_MS &&
    transportAge >= 0 &&
    transportAge <= maxTransportAgeMs
  );
}

export class GameHeartbeatPublisher {
  private readonly channel?: BroadcastChannel;

  constructor(private readonly route: GameHeartbeatRoute) {
    try {
      if (typeof BroadcastChannel !== "undefined")
        this.channel = new BroadcastChannel(GAME_HEARTBEAT_CHANNEL);
    } catch {
      // Keyboard/touch controls remain available when BroadcastChannel fails.
    }
  }

  publish(input: GameHeartbeatInput) {
    const message = createGameHeartbeatMessage(this.route, input);
    this.channel?.postMessage(message);
    return message;
  }

  close() {
    this.channel?.close();
  }
}
