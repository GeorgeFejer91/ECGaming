const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const mix = (from: number, to: number, amount: number) =>
  from + (to - from) * amount;

const point = (value: number) => value.toFixed(2);

/**
 * Produces one compound, anatomical lung silhouette. Both lobes live in the
 * same SVG path and their outer pleural surface expands from the center out.
 */
export function lungSilhouettePath(volume01: number): string {
  const volume = clamp01(Number.isFinite(volume01) ? volume01 : 0);
  const expansion = volume * volume * (3 - 2 * volume);
  const leftOuter = mix(91, 64, expansion);
  const rightOuter = mix(229, 256, expansion);
  const shoulder = mix(106, 96, expansion);
  const base = mix(216, 242, expansion);
  const lowerWidth = mix(107, 94, expansion);
  const upper = mix(76, 68, expansion);
  const innerDepth = mix(199, 210, expansion);

  return [
    `M 147 ${point(upper)}`,
    `C 132 ${point(upper - 2)}, 119 ${point(upper + 8)}, ${point(shoulder)} 99`,
    `C ${point(leftOuter + 7)} 119, ${point(leftOuter)} 158, ${point(leftOuter + 7)} 190`,
    `C ${point(leftOuter + 11)} 211, ${point(lowerWidth)} ${point(base)}, 124 ${point(base - 2)}`,
    `C 140 ${point(base - 4)}, 146 ${point(innerDepth)}, 147 183`,
    `C 149 158, 144 132, 151 106`,
    `C 155 91, 155 80, 147 ${point(upper)}`,
    "Z",
    `M 173 ${point(upper)}`,
    `C 188 ${point(upper - 2)}, 202 ${point(upper + 7)}, ${point(320 - shoulder)} 98`,
    `C ${point(rightOuter - 7)} 118, ${point(rightOuter)} 157, ${point(rightOuter - 7)} 190`,
    `C ${point(rightOuter - 11)} 213, ${point(320 - lowerWidth)} ${point(base)}, 196 ${point(base - 2)}`,
    `C 180 ${point(base - 4)}, 174 ${point(innerDepth + 2)}, 173 180`,
    `C 171 153, 176 130, 169 105`,
    `C 165 90, 165 80, 173 ${point(upper)}`,
    "Z",
  ].join(" ");
}
