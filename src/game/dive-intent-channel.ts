export const GAME_DIVE_CHANNEL = "ecgaming-breathing-v1";
export const GAME_DIVE_KIND = "ecgaming-dive-intent";
export const GAME_DIVE_VERSION = 1;
export const GAME_DIVE_SIGNAL_MAX_AGE_MS = 500;

export type GameDiveRoute = "ground-control" | "mobile-direct";
export type GameDiveState =
  | "unavailable"
  | "inhale"
  | "hold"
  | "active"
  | "recovery";

export interface GameDiveInput {
  volume01?: number;
  ready: boolean;
  physicalPolar: boolean;
  simulated: boolean;
  signalAgeMs: number;
}

export interface GameDiveSnapshot {
  state: GameDiveState;
  active: boolean;
  volume01?: number;
  holdProgress01: number;
  activeRemainingMs: number;
  reason: string;
}

export interface GameDiveMessage extends GameDiveSnapshot {
  kind: typeof GAME_DIVE_KIND;
  version: typeof GAME_DIVE_VERSION;
  route: GameDiveRoute;
  physicalPolar: boolean;
  simulated: boolean;
  signalAgeMs: number;
  sentAtEpochMs: number;
}

export const DIVE_INHALE_THRESHOLD = 0.88;
export const DIVE_RELEASE_THRESHOLD = 0.82;
export const DIVE_STABLE_RANGE = 0.045;
export const DIVE_HOLD_MS = 850;
export const DIVE_MAX_ACTIVE_MS = 8_000;
export const DIVE_RECOVERY_MS = 4_000;
const DIVE_RECOVERY_VOLUME = 0.6;
const SAMPLE_INTERVAL_MS = 50;

interface CrestSample {
  at: number;
  value: number;
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export class BreathingDiveGate {
  private crest: CrestSample[] = [];
  private activeSince?: number;
  private recoveryUntil = -Infinity;
  private lastSampleAt = -Infinity;

  reset(): GameDiveSnapshot {
    this.crest = [];
    this.activeSince = undefined;
    this.recoveryUntil = -Infinity;
    this.lastSampleAt = -Infinity;
    return this.snapshot("unavailable", false, undefined, 0, 0, "signal-unavailable");
  }

  update(input: GameDiveInput, now = performance.now()): GameDiveSnapshot {
    const volume = finite(input.volume01)
      ? Math.max(0, Math.min(1, input.volume01))
      : undefined;
    const physicalReady =
      input.ready &&
      input.physicalPolar &&
      !input.simulated &&
      finite(input.signalAgeMs) &&
      input.signalAgeMs >= 0 &&
      input.signalAgeMs <= GAME_DIVE_SIGNAL_MAX_AGE_MS &&
      volume !== undefined;

    if (!physicalReady) {
      this.crest = [];
      this.activeSince = undefined;
      return this.snapshot(
        "unavailable",
        false,
        volume,
        0,
        0,
        input.simulated ? "simulation-blocked" : "signal-unavailable",
      );
    }

    if (this.activeSince !== undefined) {
      const elapsed = now - this.activeSince;
      if (volume < DIVE_RELEASE_THRESHOLD || elapsed >= DIVE_MAX_ACTIVE_MS) {
        this.activeSince = undefined;
        this.crest = [];
        this.recoveryUntil = now + DIVE_RECOVERY_MS;
        return this.snapshot(
          "recovery",
          false,
          volume,
          0,
          0,
          elapsed >= DIVE_MAX_ACTIVE_MS ? "active-limit" : "crest-released",
        );
      }
      return this.snapshot(
        "active",
        true,
        volume,
        1,
        Math.max(0, DIVE_MAX_ACTIVE_MS - elapsed),
        "inspiratory-crest-held",
      );
    }

    if (
      Number.isFinite(this.recoveryUntil) &&
      (now < this.recoveryUntil || volume > DIVE_RECOVERY_VOLUME)
    ) {
      this.crest = [];
      return this.snapshot(
        "recovery",
        false,
        volume,
        0,
        0,
        "bounded-recovery",
      );
    }
    if (Number.isFinite(this.recoveryUntil)) this.recoveryUntil = -Infinity;

    if (volume < DIVE_INHALE_THRESHOLD) {
      this.crest = [];
      return this.snapshot(
        "inhale",
        false,
        volume,
        0,
        0,
        "below-inspiratory-crest",
      );
    }

    if (now - this.lastSampleAt >= SAMPLE_INTERVAL_MS) {
      this.lastSampleAt = now;
      this.crest.push({ at: now, value: volume });
    }
    const cutoff = now - DIVE_HOLD_MS;
    this.crest = this.crest.filter((sample) => sample.at >= cutoff);
    const first = this.crest[0];
    const elapsed = first ? Math.max(0, now - first.at) : 0;
    const values = this.crest.map((sample) => sample.value);
    const range = values.length
      ? Math.max(...values) - Math.min(...values)
      : Infinity;

    if (range > DIVE_STABLE_RANGE) {
      this.crest = [{ at: now, value: volume }];
      return this.snapshot(
        "hold",
        false,
        volume,
        0,
        0,
        "steady-the-crest",
      );
    }

    const progress = Math.max(0, Math.min(1, elapsed / DIVE_HOLD_MS));
    if (elapsed >= DIVE_HOLD_MS) {
      this.activeSince = now;
      return this.snapshot(
        "active",
        true,
        volume,
        1,
        DIVE_MAX_ACTIVE_MS,
        "inspiratory-crest-held",
      );
    }
    return this.snapshot(
      "hold",
      false,
      volume,
      progress,
      0,
      "hold-inspiratory-crest",
    );
  }

  private snapshot(
    state: GameDiveState,
    active: boolean,
    volume01: number | undefined,
    holdProgress01: number,
    activeRemainingMs: number,
    reason: string,
  ): GameDiveSnapshot {
    return {
      state,
      active,
      volume01,
      holdProgress01,
      activeRemainingMs,
      reason,
    };
  }
}

export function isGameDiveMessage(value: unknown): value is GameDiveMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<GameDiveMessage>;
  return (
    message.kind === GAME_DIVE_KIND &&
    message.version === GAME_DIVE_VERSION &&
    ["ground-control", "mobile-direct"].includes(String(message.route)) &&
    ["unavailable", "inhale", "hold", "active", "recovery"].includes(
      String(message.state),
    ) &&
    typeof message.active === "boolean" &&
    (message.volume01 === undefined ||
      (finite(message.volume01) && message.volume01 >= 0 && message.volume01 <= 1)) &&
    finite(message.holdProgress01) &&
    message.holdProgress01 >= 0 &&
    message.holdProgress01 <= 1 &&
    finite(message.activeRemainingMs) &&
    message.activeRemainingMs >= 0 &&
    typeof message.reason === "string" &&
    typeof message.physicalPolar === "boolean" &&
    typeof message.simulated === "boolean" &&
    finite(message.signalAgeMs) &&
    message.signalAgeMs >= 0 &&
    finite(message.sentAtEpochMs)
  );
}

export class GameDivePublisher {
  private readonly gate = new BreathingDiveGate();
  private readonly channel?: BroadcastChannel;
  private lastPublishedAt = -Infinity;
  private lastState = "";
  private closed = false;

  constructor(private readonly route: GameDiveRoute) {
    try {
      if (typeof BroadcastChannel !== "undefined")
        this.channel = new BroadcastChannel(GAME_DIVE_CHANNEL);
    } catch {
      // The game keeps keyboard/touch fallback when BroadcastChannel fails.
    }
  }

  update(input: GameDiveInput, now = performance.now()) {
    const snapshot = this.gate.update(input, now);
    if (this.closed) return undefined;
    const signature = `${snapshot.state}:${snapshot.active}:${snapshot.reason}`;
    if (signature !== this.lastState || now - this.lastPublishedAt >= 100) {
      this.lastState = signature;
      this.lastPublishedAt = now;
      const message: GameDiveMessage = {
        kind: GAME_DIVE_KIND,
        version: GAME_DIVE_VERSION,
        route: this.route,
        ...snapshot,
        physicalPolar: input.physicalPolar,
        simulated: input.simulated,
        signalAgeMs: Math.max(0, input.signalAgeMs),
        sentAtEpochMs: Date.now(),
      };
      try {
        this.channel?.postMessage(message);
      } catch {
        // A final animation frame can race page teardown after the channel closes.
      }
      return message;
    }
    return undefined;
  }

  close() {
    this.closed = true;
    this.channel?.close();
  }
}
