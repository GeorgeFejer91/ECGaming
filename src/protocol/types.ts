export type MetricId =
  | "manual"
  | "breathing_volume"
  | "excitement_score"
  | "excitometer"
  | "heart_rate"
  | "rr_interval"
  | "rmssd"
  | "ln_rmssd"
  | "sdnn"
  | "ecg_local_power"
  | "ecg_rms"
  | "ecg_peak_to_peak";
export type ContinuousCommand = "altitude" | "throttle" | "traffic";
export type BeatSource = "ecg-rpeak" | "polar-rr" | "off";
export type BeatAction = "pulse" | "lift" | "off";
export type DerivedMetricId = Exclude<MetricId, "manual">;
export type NormalizationMode = "fixed" | "adaptive";

export interface NormalizationConfig {
  mode: NormalizationMode;
  /** Minimum number of real metric observations before adaptive output is valid. */
  minimumSamples: number;
  /** Minimum elapsed observation time before adaptive output is valid. */
  warmupMs: number;
  /** Minimum learned raw-value span required before adaptive output is valid. */
  minimumSpan: number;
}

export interface SignalBinding {
  metric: MetricId;
  minimum: number;
  maximum: number;
  /** Missing on legacy v1 settings/configs and sanitized to fixed mode. */
  normalization?: NormalizationConfig;
  reverse: boolean;
  attackMs: number;
  releaseMs: number;
  manual: number;
}

export interface FlightMappings {
  altitude: SignalBinding;
  throttle: SignalBinding;
  traffic: SignalBinding;
  beatSource: BeatSource;
  beatAction: BeatAction;
}

export interface FlightConfigV1 {
  kind: "ecgaming-flight-config";
  protocol: "ecgflightv1";
  schemaVersion: 1;
  sourceId: string;
  sessionId: string;
  createdAt: string;
  mappings: FlightMappings;
}

export interface FlightFrame {
  sequence: number;
  beatCounter: number;
  altitude: number;
  throttle: number;
  traffic: number;
  beatAgeMs: number;
  quality: number;
  flags: number;
}

/**
 * Derived-metric telemetry is additive to ecgflightv1. It intentionally cannot
 * contain raw ECG samples or a device identifier.
 */
export interface SignalBeaconConfigV1 {
  kind: "ecgaming-signal-config";
  protocol: "ecgsignalv1";
  schemaVersion: 1;
  sourceId: string;
  sessionId: string;
  sessionToken: number;
  metricOrder: DerivedMetricId[];
  rawEcgIncluded: false;
}

export interface SignalBeaconFrame {
  sequence: number;
  sessionToken: number;
  metrics: Partial<Record<DerivedMetricId, number>>;
  ecgBeatCounter: number;
  rrBeatCounter: number;
  ecgBeatAgeMs: number;
  rrBeatAgeMs: number;
  ecgBeatQuality: number;
  rrBeatQuality: number;
  flags: number;
}

export interface SignalBeaconReceiverSnapshot {
  phase: "unavailable" | "ready" | "live" | "stale";
  config?: SignalBeaconConfigV1;
  latest?: SignalBeaconFrame & { receivedAt: number };
  packetAgeMs?: number;
  fresh: boolean;
}

export interface RemoteSource {
  streamId: string;
  uuid: string;
  label: string;
}

export interface FlightReceiverSnapshot {
  phase:
    | "idle"
    | "discovering"
    | "selecting"
    | "connecting"
    | "ready"
    | "live"
    | "stale"
    | "error";
  sources: RemoteSource[];
  selectedStreamId: string;
  sourceLabel: string;
  latest?: FlightFrame & { receivedAt: number };
  config?: FlightConfigV1;
  packetAgeMs?: number;
  route: "direct" | "relay" | "unknown";
  rttMs?: number;
  recoveryFrames: number;
  beacon: SignalBeaconReceiverSnapshot;
  diagnostics: {
    receivedFrames: number;
    p95GapMs?: number;
    maxGapMs?: number;
    sequenceGaps: number;
    staleTransitions: number;
  };
}
