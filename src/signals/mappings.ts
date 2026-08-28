import type {
  ContinuousCommand,
  FlightMappings,
  MetricId,
  NormalizationConfig,
  SignalBinding,
} from "../protocol/types";
import type { AdaptiveRangeTracker } from "./adaptive-range";

export interface MetricRangeDefaults {
  minimum: number;
  maximum: number;
  minimumSpan: number;
}

export const METRIC_RANGE_DEFAULTS: Readonly<
  Record<MetricId, MetricRangeDefaults>
> = Object.freeze({
  manual: { minimum: 0, maximum: 1, minimumSpan: 0.05 },
  breathing_volume: { minimum: 0, maximum: 1, minimumSpan: 0.08 },
  excitement_score: { minimum: 0, maximum: 1, minimumSpan: 0.08 },
  excitometer: { minimum: 0, maximum: 1, minimumSpan: 0.08 },
  heart_rate: { minimum: 45, maximum: 160, minimumSpan: 8 },
  rr_interval: { minimum: 400, maximum: 1_300, minimumSpan: 80 },
  rmssd: { minimum: 0, maximum: 120, minimumSpan: 5 },
  ln_rmssd: { minimum: 1.5, maximum: 5.5, minimumSpan: 0.2 },
  sdnn: { minimum: 0, maximum: 120, minimumSpan: 5 },
  ecg_local_power: {
    minimum: 10_000,
    maximum: 2_250_000,
    minimumSpan: 10_000,
  },
  ecg_rms: { minimum: 100, maximum: 1_500, minimumSpan: 50 },
  ecg_peak_to_peak: { minimum: 200, maximum: 4_000, minimumSpan: 100 },
});

export function defaultNormalizationConfig(
  metric: MetricId,
): NormalizationConfig {
  return {
    mode: "fixed",
    minimumSamples: 10,
    warmupMs: 10_000,
    minimumSpan: METRIC_RANGE_DEFAULTS[metric].minimumSpan,
  };
}

export function resetBindingMetric(
  binding: SignalBinding,
  metric: MetricId,
): SignalBinding {
  const range = METRIC_RANGE_DEFAULTS[metric];
  const currentNormalization =
    binding.normalization ?? defaultNormalizationConfig(binding.metric);
  return {
    ...binding,
    metric,
    minimum: range.minimum,
    maximum: range.maximum,
    normalization: {
      ...currentNormalization,
      mode: metric === "manual" ? "fixed" : currentNormalization.mode,
      minimumSpan: range.minimumSpan,
    },
  };
}

export const DEFAULT_MAPPINGS: FlightMappings = {
  altitude: {
    metric: "excitement_score",
    minimum: 0,
    maximum: 1,
    normalization: defaultNormalizationConfig("excitement_score"),
    reverse: false,
    attackMs: 280,
    releaseMs: 650,
    manual: 0,
  },
  throttle: {
    metric: "manual",
    minimum: 0,
    maximum: 1,
    normalization: defaultNormalizationConfig("manual"),
    reverse: false,
    attackMs: 300,
    releaseMs: 500,
    manual: 0.5,
  },
  traffic: {
    metric: "manual",
    minimum: 0,
    maximum: 1,
    normalization: defaultNormalizationConfig("manual"),
    reverse: false,
    attackMs: 300,
    releaseMs: 500,
    manual: 0.5,
  },
  beatSource: "ecg-rpeak",
  beatAction: "pulse",
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

export function normalizeBindingValue(
  value: number | undefined,
  binding: SignalBinding,
  adaptiveRange?: AdaptiveRangeTracker,
): number | undefined {
  if (binding.metric === "manual") return clamp(binding.manual, 0, 1);
  const normalization =
    binding.normalization ?? defaultNormalizationConfig(binding.metric);
  if (normalization.mode === "adaptive") {
    const normalized = adaptiveRange?.normalize(
      binding.metric,
      Number(value),
      normalization,
    );
    return normalized === undefined
      ? undefined
      : binding.reverse
        ? 1 - normalized
        : normalized;
  }
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(binding.minimum) ||
    !Number.isFinite(binding.maximum) ||
    binding.maximum <= binding.minimum
  )
    return undefined;
  const normalized = clamp(
    (Number(value) - binding.minimum) / (binding.maximum - binding.minimum),
    0,
    1,
  );
  return binding.reverse ? 1 - normalized : normalized;
}

export function commandValue(
  command: ContinuousCommand,
  metrics: Record<string, number>,
  mappings: FlightMappings,
  adaptiveRange?: AdaptiveRangeTracker,
): number | undefined {
  const binding = mappings[command];
  const normalized = normalizeBindingValue(
    binding.metric === "manual" ? binding.manual : metrics[binding.metric],
    binding,
    adaptiveRange,
  );
  if (normalized === undefined) return undefined;
  return command === "altitude" ? normalized * 2 - 1 : normalized;
}

export class AttackReleaseSmoother {
  value: number;
  constructor(initial = 0) {
    this.value = initial;
  }
  update(
    target: number,
    deltaMs: number,
    attackMs: number,
    releaseMs: number,
  ): number {
    if (!Number.isFinite(target)) return this.value;
    const duration =
      target > this.value ? Math.max(0, attackMs) : Math.max(0, releaseMs);
    if (duration === 0) return (this.value = target);
    const coefficient = 1 - Math.exp(-Math.max(0, deltaMs) / duration);
    this.value += (target - this.value) * coefficient;
    return this.value;
  }
  reset(value = 0) {
    this.value = value;
  }
}

export function sanitizeMappings(value: unknown): FlightMappings {
  const candidate = (
    value && typeof value === "object" ? value : {}
  ) as Partial<FlightMappings>;
  const commands: ContinuousCommand[] = ["altitude", "throttle", "traffic"];
  const result = structuredClone(DEFAULT_MAPPINGS);
  for (const command of commands) {
    const source = candidate[command];
    if (!source || typeof source !== "object") continue;
    const metric = String(source.metric ?? result[command].metric);
    const acceptedMetric = ([
      "manual",
      "breathing_volume",
      "excitement_score",
      "excitometer",
      "heart_rate",
      "rr_interval",
      "rmssd",
      "ln_rmssd",
      "sdnn",
      "ecg_local_power",
      "ecg_rms",
      "ecg_peak_to_peak",
    ].includes(metric)
      ? metric
      : result[command].metric) as SignalBinding["metric"];
    const range = METRIC_RANGE_DEFAULTS[acceptedMetric];
    const normalizationSource: Partial<NormalizationConfig> =
      source.normalization && typeof source.normalization === "object"
        ? source.normalization
        : {};
    const normalizationDefaults = defaultNormalizationConfig(acceptedMetric);
    result[command] = {
      metric: acceptedMetric,
      minimum: Number.isFinite(Number(source.minimum))
        ? Number(source.minimum)
        : range.minimum,
      maximum: Number.isFinite(Number(source.maximum))
        ? Number(source.maximum)
        : range.maximum,
      normalization: {
        mode:
          acceptedMetric !== "manual" &&
          normalizationSource.mode === "adaptive"
            ? "adaptive"
            : "fixed",
        minimumSamples: clamp(
          Number(normalizationSource.minimumSamples) ||
            normalizationDefaults.minimumSamples,
          2,
          10_000,
        ),
        warmupMs: clamp(
          Number.isFinite(Number(normalizationSource.warmupMs))
            ? Number(normalizationSource.warmupMs)
            : normalizationDefaults.warmupMs,
          0,
          600_000,
        ),
        minimumSpan: Math.max(
          0,
          Number.isFinite(Number(normalizationSource.minimumSpan))
            ? Number(normalizationSource.minimumSpan)
            : normalizationDefaults.minimumSpan,
        ),
      },
      reverse: source.reverse === true,
      attackMs: clamp(
        Number(source.attackMs) || result[command].attackMs,
        0,
        5000,
      ),
      releaseMs: clamp(
        Number(source.releaseMs) || result[command].releaseMs,
        0,
        5000,
      ),
      manual: clamp(Number(source.manual) || 0, 0, 1),
    };
    if (result[command].maximum <= result[command].minimum)
      result[command].maximum = result[command].minimum + 1;
  }
  if (["ecg-rpeak", "polar-rr", "off"].includes(String(candidate.beatSource)))
    result.beatSource = candidate.beatSource!;
  if (["pulse", "lift", "off"].includes(String(candidate.beatAction)))
    result.beatAction = candidate.beatAction!;
  if (result.beatSource === "off") result.beatAction = "off";
  return result;
}
