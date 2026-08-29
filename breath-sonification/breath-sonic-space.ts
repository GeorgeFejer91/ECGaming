export type SonicMotion = "opening" | "closing" | "open" | "closed" | "suspended";

export interface BreathSonicSpace {
  openness01: number;
  cutoffMultiplier: number;
  mouthResonanceHz: number;
  spectralSpread: number;
  stereoWidth: number;
  diffusionMix: number;
  roughnessMultiplier: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const mix = (left: number, right: number, amount: number) =>
  left + (right - left) * amount;
const smoothstep = (value: number) => value * value * (3 - 2 * value);

/**
 * Maps the lung-volume surrogate onto a coherent closed-to-open sound gesture.
 * Loudness is deliberately absent: acoustic energy remains coupled to flow so
 * spatial opening is not confused with the rising-level cue for looming.
 * Keep the allocation-free equivalent in breath-processor.js in sync.
 */
export function mapBreathSonicSpace(
  volume01: number,
  naturalness01 = 0.72,
): BreathSonicSpace {
  const openness01 = smoothstep(clamp01(volume01));
  const naturalness = clamp01(naturalness01);

  return {
    openness01,
    cutoffMultiplier: mix(0.72, 1.28, openness01),
    mouthResonanceHz: mix(360, 860, openness01),
    spectralSpread: mix(0.72, 1.16, openness01),
    stereoWidth: mix(0.055, 0.34 + naturalness * 0.28, openness01),
    diffusionMix: mix(0.008, 0.085 + naturalness * 0.075, openness01),
    roughnessMultiplier: mix(1.12, 0.82, openness01),
  };
}

export function sonicMotionForPhase(
  phase: string,
  openness01: number,
): SonicMotion {
  if (phase === "inhale") return "opening";
  if (phase === "exhale") return "closing";
  if (openness01 >= 0.72) return "open";
  if (openness01 <= 0.28) return "closed";
  return "suspended";
}

export function sonicQualities(openness01: number): string {
  if (openness01 >= 0.67) return "broad · resonant · diffuse";
  if (openness01 <= 0.33) return "narrow · dry · focused";
  return "unfolding · balanced · near";
}
