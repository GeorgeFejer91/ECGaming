export type BreathPhase =
  | "inhale"
  | "inhale-hold"
  | "exhale"
  | "exhale-hold";

export interface BreathTiming {
  inhaleSeconds: number;
  inhaleHoldSeconds: number;
  exhaleSeconds: number;
  exhaleHoldSeconds: number;
}

export interface BreathFrame {
  phase: BreathPhase;
  phase01: number;
  cycle01: number;
  volume01: number;
  flow01: number;
}

export const DEFAULT_BREATH_TIMING: Readonly<BreathTiming> = {
  inhaleSeconds: 1.8,
  inhaleHoldSeconds: 0.15,
  exhaleSeconds: 2.6,
  exhaleHoldSeconds: 0.45,
};

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

const finiteOr = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback;

const smoothstep = (value: number) => value * value * (3 - 2 * value);

export function normalizeBreathTiming(
  timing: Partial<BreathTiming> = {},
): BreathTiming {
  return {
    inhaleSeconds: clamp(
      finiteOr(timing.inhaleSeconds ?? DEFAULT_BREATH_TIMING.inhaleSeconds, 1.8),
      0.3,
      12,
    ),
    inhaleHoldSeconds: clamp(
      finiteOr(
        timing.inhaleHoldSeconds ?? DEFAULT_BREATH_TIMING.inhaleHoldSeconds,
        0.15,
      ),
      0,
      8,
    ),
    exhaleSeconds: clamp(
      finiteOr(timing.exhaleSeconds ?? DEFAULT_BREATH_TIMING.exhaleSeconds, 2.6),
      0.3,
      16,
    ),
    exhaleHoldSeconds: clamp(
      finiteOr(
        timing.exhaleHoldSeconds ?? DEFAULT_BREATH_TIMING.exhaleHoldSeconds,
        0.45,
      ),
      0,
      8,
    ),
  };
}

export function getCycleSeconds(timing: BreathTiming): number {
  return (
    timing.inhaleSeconds +
    timing.inhaleHoldSeconds +
    timing.exhaleSeconds +
    timing.exhaleHoldSeconds
  );
}

export function getBreathsPerMinute(timing: BreathTiming): number {
  return 60 / getCycleSeconds(timing);
}

export function interpolateBreathTiming(
  from: BreathTiming,
  to: BreathTiming,
  amount01: number,
): BreathTiming {
  const amount = clamp(amount01, 0, 1);
  const mix = (left: number, right: number) =>
    left + (right - left) * amount;
  return {
    inhaleSeconds: mix(from.inhaleSeconds, to.inhaleSeconds),
    inhaleHoldSeconds: mix(from.inhaleHoldSeconds, to.inhaleHoldSeconds),
    exhaleSeconds: mix(from.exhaleSeconds, to.exhaleSeconds),
    exhaleHoldSeconds: mix(from.exhaleHoldSeconds, to.exhaleHoldSeconds),
  };
}

export function sampleBreathCycle(
  elapsedSeconds: number,
  requestedTiming: BreathTiming,
): BreathFrame {
  const timing = normalizeBreathTiming(requestedTiming);
  const cycleSeconds = getCycleSeconds(timing);
  const wrapped =
    ((finiteOr(elapsedSeconds, 0) % cycleSeconds) + cycleSeconds) % cycleSeconds;
  const cycle01 = wrapped / cycleSeconds;

  if (wrapped < timing.inhaleSeconds) {
    const phase01 = wrapped / timing.inhaleSeconds;
    return {
      phase: "inhale",
      phase01,
      cycle01,
      volume01: smoothstep(phase01),
      flow01: Math.pow(Math.sin(Math.PI * phase01), 0.72),
    };
  }

  let phaseTime = wrapped - timing.inhaleSeconds;
  if (phaseTime < timing.inhaleHoldSeconds) {
    return {
      phase: "inhale-hold",
      phase01:
        timing.inhaleHoldSeconds > 0 ? phaseTime / timing.inhaleHoldSeconds : 1,
      cycle01,
      volume01: 1,
      flow01: 0,
    };
  }

  phaseTime -= timing.inhaleHoldSeconds;
  if (phaseTime < timing.exhaleSeconds) {
    const phase01 = phaseTime / timing.exhaleSeconds;
    return {
      phase: "exhale",
      phase01,
      cycle01,
      volume01: 1 - smoothstep(phase01),
      flow01: 0.82 * Math.pow(Math.sin(Math.PI * phase01), 0.88),
    };
  }

  phaseTime -= timing.exhaleSeconds;
  return {
    phase: "exhale-hold",
    phase01:
      timing.exhaleHoldSeconds > 0 ? phaseTime / timing.exhaleHoldSeconds : 1,
    cycle01,
    volume01: 0,
    flow01: 0,
  };
}
