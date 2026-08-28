export type MetricId =
  | "manual"
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

export interface SignalBinding {
  metric: MetricId;
  minimum: number;
  maximum: number;
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
  diagnostics: {
    receivedFrames: number;
    p95GapMs?: number;
    maxGapMs?: number;
    sequenceGaps: number;
    staleTransitions: number;
  };
}
