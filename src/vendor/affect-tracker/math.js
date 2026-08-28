export const DEFAULT_VERTEX_COUNT = 192;
export const DEFAULT_WAVE_COUNT = 16;
export const DEFAULT_FLUBBER_BASE_SHAPE = "circle";
export const FLUBBER_BASE_SHAPES = Object.freeze([
  "circle",
  "heart",
  "triangle",
  "square",
]);

export function clamp(value, minimum = -1, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function affectParameters(x, y) {
  const safeX = clamp(x);
  const safeY = clamp(y);
  const radius = Math.min(1, Math.hypot(safeX, safeY));
  const nearOrigin = Math.abs(safeX) < 0.005 && Math.abs(safeY) < 0.005;
  const rawAngle = nearOrigin ? 0 : Math.atan2(safeX, safeY) + Math.PI;
  const angle01 = (((rawAngle / (Math.PI * 2)) % 1) + 1) % 1;

  return {
    x: safeX,
    y: safeY,
    frequency: 1.5 + safeY,
    amplitude: 0.3 + 0.1 * safeY,
    shapeMix: (safeX + 1) / 2,
    disorder: 0.4 * (1 - safeX),
    angle01,
    saturation: radius,
  };
}

function normalize(values) {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of values) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const range = maximum - minimum || 1;
  return Float64Array.from(values, (value) => (value - minimum) / range);
}

function centeredModulo(value, period) {
  return ((((value + period / 2) % period) + period) % period) - period / 2;
}

function createRegularPolygonProfile(vertexCount, sideCount, vertexRotation) {
  const x = new Float64Array(vertexCount);
  const y = new Float64Array(vertexCount);
  const sector = (Math.PI * 2) / sideCount;
  const apothem = Math.cos(Math.PI / sideCount);
  const edgeNormal = vertexRotation + Math.PI / sideCount;
  for (let index = 0; index < vertexCount; index += 1) {
    const theta = (index * Math.PI * 2) / vertexCount;
    const offset = centeredModulo(theta - edgeNormal, sector);
    const radius = apothem / Math.cos(offset);
    x[index] = radius * Math.cos(theta);
    y[index] = radius * Math.sin(theta);
  }
  return { x, y };
}

function createHeartProfile(vertexCount) {
  const x = new Float64Array(vertexCount);
  const y = new Float64Array(vertexCount);
  let minimumY = Infinity;
  let maximumY = -Infinity;
  for (let index = 0; index < vertexCount; index += 1) {
    const theta = (index * Math.PI * 2) / vertexCount;
    const sine = Math.sin(theta);
    x[index] = 16 * sine * sine * sine;
    y[index] = -(
      13 * Math.cos(theta) -
      5 * Math.cos(2 * theta) -
      2 * Math.cos(3 * theta) -
      Math.cos(4 * theta)
    );
    minimumY = Math.min(minimumY, y[index]);
    maximumY = Math.max(maximumY, y[index]);
  }
  const centerY = (minimumY + maximumY) / 2;
  let maximumRadius = 0;
  for (let index = 0; index < vertexCount; index += 1) {
    y[index] -= centerY;
    maximumRadius = Math.max(maximumRadius, Math.hypot(x[index], y[index]));
  }
  for (let index = 0; index < vertexCount; index += 1) {
    x[index] /= maximumRadius;
    y[index] /= maximumRadius;
  }
  return { x, y };
}

function createBaseShapeProfiles(vertexCount) {
  const circle = {
    x: new Float64Array(vertexCount),
    y: new Float64Array(vertexCount),
  };
  for (let index = 0; index < vertexCount; index += 1) {
    const theta = (index * Math.PI * 2) / vertexCount;
    circle.x[index] = Math.cos(theta);
    circle.y[index] = Math.sin(theta);
  }
  return Object.freeze({
    circle,
    heart: createHeartProfile(vertexCount),
    triangle: createRegularPolygonProfile(vertexCount, 3, -Math.PI / 2),
    square: createRegularPolygonProfile(vertexCount, 4, -Math.PI / 4),
  });
}

export function createProfiles(
  vertexCount = DEFAULT_VERTEX_COUNT,
  waveCount = DEFAULT_WAVE_COUNT,
  triangleAngleDegrees = 45,
) {
  if (
    !Number.isInteger(vertexCount) ||
    !Number.isInteger(waveCount) ||
    vertexCount < waveCount * 4
  ) {
    throw new RangeError(
      "vertexCount and waveCount must be integers with at least four vertices per wave",
    );
  }
  if (vertexCount % waveCount !== 0) {
    throw new RangeError("vertexCount must be divisible by waveCount");
  }

  const rounded = new Float64Array(vertexCount);
  const pointy = new Float64Array(vertexCount);
  const verticesPerWave = vertexCount / waveCount;
  const halfWave = verticesPerWave / 2;
  const vertexRadians = (Math.PI * 2) / vertexCount;
  const alpha = Math.PI / 2 + (triangleAngleDegrees * Math.PI) / 180;

  for (let index = 0; index < vertexCount; index += 1) {
    const theta = (index * Math.PI * 2) / vertexCount;
    rounded[index] = Math.cos(waveCount * theta);

    const position = index % verticesPerWave;
    const distance = Math.abs(position - halfWave);
    const denominator = Math.sin(Math.PI - alpha - vertexRadians * distance);
    pointy[index] = Math.sin(alpha) / denominator;
  }

  return {
    pointy: normalize(pointy),
    rounded: normalize(rounded),
    baseShapes: createBaseShapeProfiles(vertexCount),
    vertexCount,
    waveCount,
  };
}

export function hashSeed(seed) {
  let hash = 2166136261;
  for (const character of String(seed)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createSeededRandom(seed) {
  let value = hashSeed(seed);
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export function createProjectionOffsets(seed, waveCount = DEFAULT_WAVE_COUNT) {
  const random = createSeededRandom(seed);
  const phases = new Float64Array(waveCount);
  const amplitudes = new Float64Array(waveCount);
  for (let index = 0; index < waveCount; index += 1) {
    phases[index] = (random() * 2 - 1) * Math.PI;
    amplitudes[index] = random() * 2 - 1;
  }
  return { phases, amplitudes };
}

function mix(start, end, amount) {
  return start + (end - start) * amount;
}

function rgbToHsv(red, green, blue) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta !== 0) {
    if (maximum === r) hue = ((g - b) / delta) % 6;
    else if (maximum === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue /= 6;
    if (hue < 0) hue += 1;
  }
  return [hue, maximum === 0 ? 0 : delta / maximum, maximum];
}

function hsvToRgb(hue, saturation, value) {
  const chroma = value * saturation;
  const section = hue * 6;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  let rgb;
  if (section < 1) rgb = [chroma, x, 0];
  else if (section < 2) rgb = [x, chroma, 0];
  else if (section < 3) rgb = [0, chroma, x];
  else if (section < 4) rgb = [0, x, chroma];
  else if (section < 5) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];
  const offset = value - chroma;
  return rgb.map((component) => Math.round((component + offset) * 255));
}

export function affectColor(angle01, saturation) {
  const green = [31, 255, 0];
  const red = [255, 0, 19];
  const amount = angle01 <= 0.5 ? angle01 * 2 : (angle01 - 0.5) * 2;
  const start = angle01 <= 0.5 ? green : red;
  const end = angle01 <= 0.5 ? red : green;
  const gradientColor = start.map((component, index) =>
    mix(component, end[index], amount),
  );
  const [hue, , value] = rgbToHsv(...gradientColor);
  const [r, g, b] = hsvToRgb(hue, clamp(saturation, 0, 1), value);
  return `rgb(${r} ${g} ${b})`;
}

export const DEFAULT_AFFECT_PALETTE = Object.freeze({
  up: "#ffd166",
  down: "#5c7cfa",
  left: "#ff5b68",
  right: "#5dffb0",
});

function hexToRgb(value) {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value);
  return match
    ? match.slice(1).map((component) => Number.parseInt(component, 16))
    : null;
}

export function affectPaletteColor(x, y, palette = DEFAULT_AFFECT_PALETTE) {
  const anchors = {
    up: hexToRgb(palette.up) ?? hexToRgb(DEFAULT_AFFECT_PALETTE.up),
    down: hexToRgb(palette.down) ?? hexToRgb(DEFAULT_AFFECT_PALETTE.down),
    left: hexToRgb(palette.left) ?? hexToRgb(DEFAULT_AFFECT_PALETTE.left),
    right: hexToRgb(palette.right) ?? hexToRgb(DEFAULT_AFFECT_PALETTE.right),
  };
  const weights = {
    up: Math.max(0, y),
    down: Math.max(0, -y),
    left: Math.max(0, -x),
    right: Math.max(0, x),
  };
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const neutral = [183, 183, 183];
  if (total <= Number.EPSILON) return `rgb(${neutral.join(" ")})`;
  const directional = neutral.map(
    (_, component) =>
      Object.entries(weights).reduce(
        (sum, [name, weight]) => sum + anchors[name][component] * weight,
        0,
      ) / total,
  );
  const intensity = clamp(Math.hypot(x, y), 0, 1);
  const result = neutral.map((value, component) =>
    Math.round(mix(value, directional[component], intensity)),
  );
  return `rgb(${result.join(" ")})`;
}

export function buildFlubberPath({
  profiles,
  offsets,
  x,
  y,
  phase,
  palette,
  amplitudeScale = 1,
  disorderScale = 1,
  baseShape = DEFAULT_FLUBBER_BASE_SHAPE,
  reducedMotion = false,
}) {
  const parameters = affectParameters(x, y);
  const adjustedAmplitude = parameters.amplitude * clamp(amplitudeScale, 0, 2);
  const adjustedDisorder = parameters.disorder * clamp(disorderScale, 0, 2);
  const { vertexCount, waveCount, pointy, rounded, baseShapes } = profiles;
  const baseProfile = baseShapes?.[baseShape];
  if (!baseProfile || !FLUBBER_BASE_SHAPES.includes(baseShape)) {
    throw new RangeError(`Unsupported Flubber base shape: ${baseShape}`);
  }
  const verticesPerWave = vertexCount / waveCount;
  const scale = reducedMotion ? 1 : 0.9 + 0.1 * (Math.sin(phase) * 0.5 + 0.5);
  const oscillationDepth = reducedMotion ? 0.14 : 0.5;
  const pathParts = new Array(vertexCount + 1);

  for (let index = 0; index < vertexCount; index += 1) {
    const waveIndex =
      Math.floor((index + verticesPerWave / 2) / verticesPerWave) % waveCount;
    const shape =
      pointy[index] * (1 - parameters.shapeMix) +
      rounded[index] * parameters.shapeMix;
    const wave =
      0.5 +
      oscillationDepth *
        Math.sin(phase + adjustedDisorder * offsets.phases[waveIndex]);
    const asymmetry = 1 + adjustedDisorder * offsets.amplitudes[waveIndex];
    const deformation =
      (1 + shape * adjustedAmplitude * wave * asymmetry) * scale;
    const px = deformation * baseProfile.x[index];
    const py = deformation * baseProfile.y[index];
    pathParts[index] =
      `${index === 0 ? "M" : "L"}${px.toFixed(4)},${py.toFixed(4)}`;
  }
  pathParts[vertexCount] = "Z";

  return {
    path: pathParts.join(""),
    color: palette
      ? affectPaletteColor(x, y, palette)
      : affectColor(parameters.angle01, parameters.saturation),
    parameters,
  };
}

export function smoothToward(current, target, response, deltaSeconds) {
  const amount = 1 - Math.exp(-response * Math.max(0, deltaSeconds));
  return clamp(current + (target - current) * amount);
}
