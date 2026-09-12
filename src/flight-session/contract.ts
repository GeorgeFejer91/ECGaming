import type { FlightFrame, FlightMappings } from "../protocol/types";
import { sanitizeMappings } from "../signals/mappings";
import { neutralControls, validControls, type TiltControls } from "../phone-tilt/controls";

export const COMPANION_SCOPE = "flight.companion";
export const SIGNAL_LEASE_MS = 500;
export type SourceId = "ground" | "phone" | "cockpit";
export type SourceStatus = "idle" | "connecting" | "warming" | "live" | "error" | "unsupported";
export interface SourceOffer {
  configRevision: number;
  sourceEpoch: number;
  status: SourceStatus;
  frame: FlightFrame | null;
}
export interface RelayState {
  version: 1;
  configRevision: number;
  sourceEpoch: number;
  source: SourceId;
  assignedSource: boolean;
  mappings: FlightMappings;
  frame: FlightFrame | null;
  steering: TiltControls;
  phoneSelected: boolean;
  speedEnabled: boolean;
}
export const exactFields = (v: unknown, fields: string[]): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === fields.length && fields.every(k => Object.hasOwn(v, k));
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const bounded = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
// BRSP canonicalizes object keys. Validation must compare values independently of insertion order.
const canonical = (value: unknown): string => JSON.stringify(value, (_key, v) =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
export function validFrame(v: unknown): v is FlightFrame {
  return exactFields(v, ["sequence", "beatCounter", "altitude", "throttle", "traffic", "beatAgeMs", "quality", "flags"]) &&
    integer(v.sequence) && integer(v.beatCounter) && bounded(v.altitude, -1, 1) && bounded(v.throttle, 0, 1) &&
    bounded(v.traffic, 0, 1) && bounded(v.beatAgeMs, 0, 999_999) && bounded(v.quality, 0, 1) && integer(v.flags) && v.flags <= 15;
}
export function validOffer(v: unknown): v is SourceOffer {
  return exactFields(v, ["configRevision", "sourceEpoch", "status", "frame"]) && integer(v.configRevision) && integer(v.sourceEpoch) &&
    ["idle", "connecting", "warming", "live", "error", "unsupported"].includes(String(v.status)) && (v.frame === null || validFrame(v.frame));
}
export function validRelay(v: unknown): v is RelayState {
  if (!exactFields(v, ["version", "configRevision", "sourceEpoch", "source", "assignedSource", "mappings", "frame", "steering", "phoneSelected", "speedEnabled"])) return false;
  return v.version === 1 && integer(v.configRevision) && integer(v.sourceEpoch) && ["ground", "phone", "cockpit"].includes(String(v.source)) &&
    typeof v.assignedSource === "boolean" && typeof v.phoneSelected === "boolean" && typeof v.speedEnabled === "boolean" &&
    validControls(v.steering) && (v.frame === null || validFrame(v.frame)) &&
    canonical(sanitizeMappings(v.mappings)) === canonical(v.mappings);
}

/** Ground Control owns configuration and source selection. All ages use its own clock. */
export class RelayAuthority {
  mappings = sanitizeMappings(undefined);
  configRevision = 1;
  sourceEpoch = 1;
  source: SourceId = "ground";
  private frame: FlightFrame | null = null;
  private receivedAt = -Infinity;
  private sequence = -1;
  configure(value: FlightMappings) {
    const next = sanitizeMappings(value);
    if (JSON.stringify(next) === JSON.stringify(this.mappings)) return;
    this.mappings = next; this.configRevision++; this.invalidate();
  }
  select(source: SourceId) {
    if (this.source === source) return;
    this.source = source; this.sourceEpoch++; this.invalidate();
  }
  invalidate() { this.frame = null; this.sequence = -1; this.receivedAt = -Infinity; }
  accept(source: SourceId, offer: SourceOffer, now: number) {
    if (!validOffer(offer) || !Number.isFinite(now)) throw new Error("Invalid signal control packet");
    if (source !== this.source || offer.sourceEpoch !== this.sourceEpoch || offer.configRevision !== this.configRevision) return false;
    if (!offer.frame) { this.frame = null; this.receivedAt = -Infinity; return true; }
    if (offer.frame.sequence <= this.sequence) return false;
    this.sequence = offer.frame.sequence; this.frame = { ...offer.frame }; this.receivedAt = now;
    return true;
  }
  read(now: number): FlightFrame | null {
    if (!this.frame || now - this.receivedAt >= SIGNAL_LEASE_MS || now < this.receivedAt) return null;
    return { ...this.frame, beatAgeMs: Math.min(999_999, this.frame.beatAgeMs + now - this.receivedAt) };
  }
  state(forSource: SourceId, now: number): RelayState {
    return { version: 1, configRevision: this.configRevision, sourceEpoch: this.sourceEpoch, source: this.source,
      assignedSource: forSource === this.source, mappings: structuredClone(this.mappings), frame: this.read(now),
      steering: neutralControls(), phoneSelected: false, speedEnabled: false };
  }
}
