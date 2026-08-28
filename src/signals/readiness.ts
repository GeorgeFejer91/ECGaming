export type FlightLaunchSource =
  | "polar-direct"
  | "remote-beacon"
  | "simulation";

export type FlightLaunchBlockReason =
  | "source-not-live"
  | "remote-config-missing"
  | "signal-missing"
  | "signal-stale"
  | "physical-polar-missing"
  | "simulation-rejected"
  | "metric-not-ready"
  | "normalization-not-ready"
  | "beat-not-ready"
  | "aircraft-not-ready";

export interface FlightLaunchReadinessInput {
  source: FlightLaunchSource;
  phase: string;
  nowMs: number;
  lastSignalAtMs?: number;
  maximumSignalAgeMs?: number;
  physicalPolar: boolean;
  simulation: boolean;
  remoteConfigReady?: boolean;
  metricReady: boolean;
  normalizationReady: boolean;
  beatReady: boolean;
  aircraftReady: boolean;
}

export interface FlightLaunchReadiness {
  ready: boolean;
  signalAgeMs?: number;
  reasons: FlightLaunchBlockReason[];
}

/**
 * One fail-closed launch predicate for direct and network signal adapters.
 * A public beacon's physicalPolar flag is still only an unauthenticated claim;
 * this predicate prevents accidental simulation/fallback, not impersonation.
 */
export function flightLaunchReadiness(
  input: FlightLaunchReadinessInput,
): FlightLaunchReadiness {
  const reasons: FlightLaunchBlockReason[] = [];
  const maximumAge = Number.isFinite(input.maximumSignalAgeMs)
    ? Math.max(0, Number(input.maximumSignalAgeMs))
    : 2_000;
  const hasSignal =
    Number.isFinite(input.nowMs) && Number.isFinite(input.lastSignalAtMs);
  const signalAgeMs = hasSignal
    ? Number(input.nowMs) - Number(input.lastSignalAtMs)
    : undefined;

  if (input.phase !== "live") reasons.push("source-not-live");
  if (input.source === "remote-beacon" && !input.remoteConfigReady)
    reasons.push("remote-config-missing");
  if (!hasSignal) reasons.push("signal-missing");
  else if (signalAgeMs! < 0 || signalAgeMs! > maximumAge)
    reasons.push("signal-stale");
  if (!input.physicalPolar) reasons.push("physical-polar-missing");
  if (input.source === "simulation" || input.simulation)
    reasons.push("simulation-rejected");
  if (!input.metricReady) reasons.push("metric-not-ready");
  if (!input.normalizationReady) reasons.push("normalization-not-ready");
  if (!input.beatReady) reasons.push("beat-not-ready");
  if (!input.aircraftReady) reasons.push("aircraft-not-ready");

  return { ready: reasons.length === 0, signalAgeMs, reasons };
}
