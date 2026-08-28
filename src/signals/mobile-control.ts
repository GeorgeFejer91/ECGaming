import type { BeatSource, FlightMappings, MetricId } from "../protocol/types";
import { DEFAULT_MAPPINGS, sanitizeMappings } from "./mappings";

export type MobileAltitudeMode = Extract<
  MetricId,
  "excitement_score" | "heart_rate" | "rr_interval" | "manual"
>;

export interface MobileControlSettings {
  altitudeMode: MobileAltitudeMode;
  beatSource: BeatSource;
  manualAltitude: number;
  throttle: number;
  traffic: number;
}

export interface MobileReadinessInput {
  simulated: boolean;
  connected: boolean;
  ecgReady: boolean;
  detectorReady: boolean;
  metrics: Record<string, number>;
  mappings: FlightMappings;
}

export const DEFAULT_MOBILE_SETTINGS: MobileControlSettings = Object.freeze({
  altitudeMode: "excitement_score",
  beatSource: "ecg-rpeak",
  manualAltitude: 0.5,
  throttle: 0.5,
  traffic: 0.5,
});

const finite = (value: unknown) => Number.isFinite(Number(value));

export function sanitizeMobileSettings(value: unknown): MobileControlSettings {
  const candidate = (
    value && typeof value === "object" ? value : {}
  ) as Partial<MobileControlSettings>;
  const altitudeMode = [
    "excitement_score",
    "heart_rate",
    "rr_interval",
    "manual",
  ].includes(String(candidate.altitudeMode))
    ? (candidate.altitudeMode as MobileAltitudeMode)
    : DEFAULT_MOBILE_SETTINGS.altitudeMode;
  const beatSource = ["ecg-rpeak", "polar-rr", "off"].includes(
    String(candidate.beatSource),
  )
    ? (candidate.beatSource as BeatSource)
    : DEFAULT_MOBILE_SETTINGS.beatSource;
  const bounded = (candidateValue: unknown, fallback: number) =>
    Math.max(
      0,
      Math.min(1, finite(candidateValue) ? Number(candidateValue) : fallback),
    );
  return {
    altitudeMode,
    beatSource,
    manualAltitude: bounded(
      candidate.manualAltitude,
      DEFAULT_MOBILE_SETTINGS.manualAltitude,
    ),
    throttle: bounded(candidate.throttle, DEFAULT_MOBILE_SETTINGS.throttle),
    traffic: bounded(candidate.traffic, DEFAULT_MOBILE_SETTINGS.traffic),
  };
}

export function buildMobileMappings(
  settings: MobileControlSettings,
): FlightMappings {
  const result = structuredClone(DEFAULT_MAPPINGS);
  const altitudeRanges: Record<
    MobileAltitudeMode,
    { minimum: number; maximum: number; reverse: boolean }
  > = {
    excitement_score: { minimum: 0, maximum: 1, reverse: false },
    heart_rate: { minimum: 50, maximum: 160, reverse: false },
    rr_interval: { minimum: 400, maximum: 1_300, reverse: true },
    manual: { minimum: 0, maximum: 1, reverse: false },
  };
  result.altitude = {
    ...result.altitude,
    metric: settings.altitudeMode,
    ...altitudeRanges[settings.altitudeMode],
    manual: settings.manualAltitude,
  };
  result.throttle.manual = settings.throttle;
  result.traffic.manual = settings.traffic;
  result.beatSource = settings.beatSource;
  result.beatAction = settings.beatSource === "off" ? "off" : "pulse";
  return sanitizeMappings(result);
}

export function mobileReadiness(input: MobileReadinessInput) {
  const mappedMetric = input.mappings.altitude.metric;
  const checks = {
    source: input.simulated || input.connected,
    heartRate: input.simulated || finite(input.metrics.heart_rate),
    rr: input.simulated || finite(input.metrics.rr_interval),
    ecg: input.simulated || input.ecgReady,
    mappedMetric:
      mappedMetric === "manual" || finite(input.metrics[mappedMetric]),
    beat:
      input.mappings.beatSource === "off" ||
      input.simulated ||
      (input.mappings.beatSource === "ecg-rpeak"
        ? input.detectorReady
        : finite(input.metrics.rr_interval)),
  };
  return {
    checks,
    ready: Object.values(checks).every(Boolean),
  };
}
