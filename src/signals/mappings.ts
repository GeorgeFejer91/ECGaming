import type {
  ContinuousCommand,
  FlightMappings,
  SignalBinding,
} from "../protocol/types";

export const DEFAULT_MAPPINGS: FlightMappings = {
  altitude: {
    metric: "excitement_score",
    minimum: 0,
    maximum: 1,
    reverse: false,
    attackMs: 280,
    releaseMs: 650,
    manual: 0,
  },
  throttle: {
    metric: "manual",
    minimum: 0,
    maximum: 1,
    reverse: false,
    attackMs: 300,
    releaseMs: 500,
    manual: 0.5,
  },
  traffic: {
    metric: "manual",
    minimum: 0,
    maximum: 1,
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
): number | undefined {
  if (binding.metric === "manual") return clamp(binding.manual, 0, 1);
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
): number | undefined {
  const binding = mappings[command];
  const normalized = normalizeBindingValue(
    binding.metric === "manual" ? binding.manual : metrics[binding.metric],
    binding,
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
    result[command] = {
      metric: ([
        "manual",
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
        : result[command].metric) as SignalBinding["metric"],
      minimum: Number.isFinite(Number(source.minimum))
        ? Number(source.minimum)
        : result[command].minimum,
      maximum: Number.isFinite(Number(source.maximum))
        ? Number(source.maximum)
        : result[command].maximum,
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
