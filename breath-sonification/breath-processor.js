/*
 * Procedural breath source-filter synthesizer.
 * This file is loaded directly into an AudioWorkletGlobalScope.
 */

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const mix = (left, right, amount) => left + (right - left) * amount;
const smoothstep = (value) => value * value * (3 - 2 * value);

// Allocation-free equivalent of mapBreathSonicSpace() in
// breath-sonic-space.ts. Loudness is intentionally not part of this mapping:
// flow remains the sole amplitude authority.
const updateBreathSonicSpace = (target, volume01, naturalness01) => {
  const openness01 = smoothstep(clamp(volume01, 0, 1));
  const naturalness = clamp(naturalness01, 0, 1);
  target.openness01 = openness01;
  target.cutoffMultiplier = mix(0.72, 1.28, openness01);
  target.mouthResonanceHz = mix(360, 860, openness01);
  target.spectralSpread = mix(0.72, 1.16, openness01);
  target.stereoWidth = mix(
    0.055,
    0.34 + naturalness * 0.28,
    openness01,
  );
  target.diffusionMix = mix(
    0.008,
    0.085 + naturalness * 0.075,
    openness01,
  );
  target.roughnessMultiplier = mix(1.12, 0.82, openness01);
};

const PHASES = ["inhale", "inhale-hold", "exhale", "exhale-hold"];
const DURATION_KEYS = [
  "inhaleSeconds",
  "inhaleHoldSeconds",
  "exhaleSeconds",
  "exhaleHoldSeconds",
];

class PinkNoise {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.b = new Float64Array(7);
  }

  white() {
    let value = this.seed;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.seed = value >>> 0;
    return (this.seed / 0x80000000 - 1) || 0.000001;
  }

  next() {
    const white = this.white();
    this.b[0] = 0.99886 * this.b[0] + white * 0.0555179;
    this.b[1] = 0.99332 * this.b[1] + white * 0.0750759;
    this.b[2] = 0.969 * this.b[2] + white * 0.153852;
    this.b[3] = 0.8665 * this.b[3] + white * 0.3104856;
    this.b[4] = 0.55 * this.b[4] + white * 0.5329522;
    this.b[5] = -0.7616 * this.b[5] - white * 0.016898;
    const pink =
      this.b[0] +
      this.b[1] +
      this.b[2] +
      this.b[3] +
      this.b[4] +
      this.b[5] +
      this.b[6] +
      white * 0.5362;
    this.b[6] = white * 0.115926;
    return pink * 0.11;
  }
}

class BreathFilter {
  constructor(seed) {
    this.noise = new PinkNoise(seed);
    this.low1 = 0;
    this.low2 = 0;
    this.dc = 0;
    this.bandLow = 0;
    this.bandHigh = 0;
    this.roughness = 0;
    this.formantLow = 0;
    this.formantBand = 0;
  }

  process(
    cutoffHz,
    bandLowHz,
    bandHighHz,
    mouthResonanceHz,
    naturalness01,
    roughnessMultiplier,
  ) {
    const source = this.noise.next();
    const lowCoefficient = 1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
    const bandLowCoefficient =
      1 - Math.exp((-2 * Math.PI * bandLowHz) / sampleRate);
    const bandHighCoefficient =
      1 - Math.exp((-2 * Math.PI * bandHighHz) / sampleRate);
    const dcCoefficient = 1 - Math.exp((-2 * Math.PI * 75) / sampleRate);
    const roughnessCoefficient =
      1 - Math.exp((-2 * Math.PI * 7) / sampleRate);

    this.low1 += lowCoefficient * (source - this.low1);
    this.low2 += lowCoefficient * (this.low1 - this.low2);
    this.dc += dcCoefficient * (this.low2 - this.dc);
    this.bandLow += bandLowCoefficient * (source - this.bandLow);
    this.bandHigh += bandHighCoefficient * (source - this.bandHigh);
    this.roughness +=
      roughnessCoefficient * (this.noise.white() - this.roughness);

    // A gentle noise-excited first-formant analogue. A more open mouth raises
    // this resonance; damping keeps it breath-like rather than whistle-like.
    const formantCoefficient = 2 * Math.sin(
      (Math.PI * clamp(mouthResonanceHz, 220, 1400)) / sampleRate,
    );
    this.formantLow += formantCoefficient * this.formantBand;
    const formantHigh =
      source - this.formantLow - 0.74 * this.formantBand;
    this.formantBand += formantCoefficient * formantHigh;

    const softAir = this.low2 - this.dc;
    const mouthBand = this.bandHigh - this.bandLow;
    const turbulence =
      1 +
      naturalness01 *
        roughnessMultiplier *
        (0.075 * this.roughness + 0.025 * source);
    return (
      (softAir * 0.68 + mouthBand * 0.39 + this.formantBand * 0.16) *
      turbulence
    );
  }
}

class DiffuseField {
  constructor() {
    this.left = new Float32Array(Math.max(1, Math.round(sampleRate * 0.083)));
    this.right = new Float32Array(Math.max(1, Math.round(sampleRate * 0.109)));
    this.leftIndex = 0;
    this.rightIndex = 0;
    this.outputLeft = 0;
    this.outputRight = 0;
  }

  process(left, right, wet01) {
    const wetLeft = this.left[this.leftIndex];
    const wetRight = this.right[this.rightIndex];
    this.left[this.leftIndex] = left + wetRight * 0.16;
    this.right[this.rightIndex] = right + wetLeft * 0.14;
    this.leftIndex = (this.leftIndex + 1) % this.left.length;
    this.rightIndex = (this.rightIndex + 1) % this.right.length;
    this.outputLeft = mix(left, wetLeft, wet01);
    this.outputRight = mix(right, wetRight, wet01);
  }
}

class ECGamingBreathProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.currentTiming = {
      inhaleSeconds: 1.8,
      inhaleHoldSeconds: 0.15,
      exhaleSeconds: 2.6,
      exhaleHoldSeconds: 0.45,
    };
    this.targetTiming = { ...this.currentTiming };
    this.currentTimbre = {
      intensity01: 0.68,
      brightness01: 0.56,
      naturalness01: 0.72,
    };
    this.targetTimbre = { ...this.currentTimbre };
    this.phaseIndex = 0;
    this.phase01 = 0;
    this.breathNumber = 0;
    this.active = false;
    this.activeGain = 0;
    this.filters = [
      new BreathFilter(0x7f4a7c15),
      new BreathFilter(0x51ed270b),
    ];
    this.diffuseField = new DiffuseField();
    this.soundSpace = {
      openness01: 0,
      cutoffMultiplier: 0.72,
      mouthResonanceHz: 360,
      spectralSpread: 0.72,
      stereoWidth: 0.055,
      diffusionMix: 0.008,
      roughnessMultiplier: 1.12,
    };
    this.external = {
      ageSeconds: Infinity,
      blend: 0,
      confidence01: 0,
      locked: false,
      ready: false,
      volume01: 0,
      flow01: 0,
      phase: "hold",
      phaseTarget01: 0,
    };
    this.reportCountdown = 0;
    this.cycle = {
      phase: "inhale",
      moving: true,
      volume01: 0,
      flow01: 0,
    };
    this.lastFrame = {
      phase: "inhale",
      phase01: 0,
      volume01: 0,
      flow01: 0,
      openness01: 0,
      source: "cycle",
      breathNumber: 0,
    };
    this.port.onmessage = ({ data }) => this.handleMessage(data);
  }

  handleMessage(message) {
    if (!message || typeof message.type !== "string") return;
    if (message.type === "active") {
      this.active = message.value === true;
      return;
    }
    if (message.type === "timing") {
      const value = message.value ?? {};
      this.targetTiming = {
        inhaleSeconds: clamp(Number(value.inhaleSeconds) || 1.8, 0.3, 12),
        inhaleHoldSeconds: clamp(Number(value.inhaleHoldSeconds) || 0, 0, 8),
        exhaleSeconds: clamp(Number(value.exhaleSeconds) || 2.6, 0.3, 16),
        exhaleHoldSeconds: clamp(Number(value.exhaleHoldSeconds) || 0, 0, 8),
      };
      return;
    }
    if (message.type === "timbre") {
      const value = message.value ?? {};
      for (const key of Object.keys(this.targetTimbre))
        this.targetTimbre[key] = clamp(Number(value[key]) || 0, 0, 1);
      return;
    }
    if (message.type === "release-physiology") {
      this.external.ageSeconds = Infinity;
      this.external.confidence01 = 0;
      return;
    }
    if (message.type === "physiology-lock") {
      this.external.locked = message.value === true;
      if (!this.external.locked) this.external.ageSeconds = Infinity;
      return;
    }
    if (message.type !== "physiology") return;

    const value = message.value ?? {};
    const phase = ["inhale", "exhale", "hold"].includes(value.phase)
      ? value.phase
      : "hold";
    const volume01 = clamp(Number(value.volume01) || 0, 0, 1);
    this.external.ageSeconds = 0;
    this.external.confidence01 = clamp(Number(value.confidence01) || 0, 0, 1);
    this.external.ready = value.ready === true;
    this.external.volume01 = volume01;
    this.external.flow01 = clamp(Number(value.flow01) || 0, 0, 1);
    this.external.phase = phase;
    this.external.phaseTarget01 =
      phase === "inhale" ? volume01 : phase === "exhale" ? 1 - volume01 : 0;

    const requestedPhaseIndex =
      phase === "inhale" ? 0 : phase === "exhale" ? 2 : volume01 > 0.5 ? 1 : 3;
    const phaseReady = this.external.locked
      ? this.external.ready
      : this.external.confidence01 > 0.45;
    if (this.phaseIndex !== requestedPhaseIndex && phaseReady) {
      this.phaseIndex = requestedPhaseIndex;
      this.phase01 = phase === "hold" ? 0 : this.external.phaseTarget01;
      if (requestedPhaseIndex === 0) this.breathNumber += 1;
    }
  }

  smoothControls(deltaSeconds) {
    const timingAmount = 1 - Math.exp(-deltaSeconds / 0.35);
    const timbreAmount = 1 - Math.exp(-deltaSeconds / 0.08);
    for (const key of DURATION_KEYS)
      this.currentTiming[key] = mix(
        this.currentTiming[key],
        this.targetTiming[key],
        timingAmount,
      );
    for (const key of Object.keys(this.currentTimbre))
      this.currentTimbre[key] = mix(
        this.currentTimbre[key],
        this.targetTimbre[key],
        timbreAmount,
      );
  }

  updateExternal(deltaSeconds) {
    this.external.ageSeconds += deltaSeconds;
    const freshness = clamp((0.9 - this.external.ageSeconds) / 0.55, 0, 1);
    const targetBlend = this.external.locked
      ? freshness * (this.external.ready ? 1 : 0)
      : freshness * this.external.confidence01;
    const amount = 1 - Math.exp(-deltaSeconds / 0.1);
    this.external.blend = mix(this.external.blend, targetBlend, amount);

    const sameMovingPhase =
      (this.phaseIndex === 0 && this.external.phase === "inhale") ||
      (this.phaseIndex === 2 && this.external.phase === "exhale");
    if (sameMovingPhase && this.external.blend > 0.15) {
      const phaseError = this.external.phaseTarget01 - this.phase01;
      this.phase01 +=
        clamp(phaseError * 4, -0.85, 0.85) *
        deltaSeconds *
        this.external.blend;
    }
  }

  advancePhase(deltaSeconds) {
    const duration = Math.max(
      0.0001,
      this.currentTiming[DURATION_KEYS[this.phaseIndex]],
    );
    this.phase01 += deltaSeconds / duration;
    let guard = 0;
    while (this.phase01 >= 1 && guard < 4) {
      this.phase01 -= 1;
      this.phaseIndex = (this.phaseIndex + 1) % 4;
      if (this.phaseIndex === 0) this.breathNumber += 1;
      const nextDuration = this.currentTiming[DURATION_KEYS[this.phaseIndex]];
      if (nextDuration > 0.001) break;
      guard += 1;
    }
  }

  cycleFrame() {
    const phase = PHASES[this.phaseIndex];
    const moving = this.phaseIndex === 0 || this.phaseIndex === 2;
    let volume01;
    let flow01 = 0;
    if (this.phaseIndex === 0) {
      volume01 = smoothstep(this.phase01);
      flow01 = Math.pow(Math.sin(Math.PI * this.phase01), 0.72);
    } else if (this.phaseIndex === 1) {
      volume01 = 1;
    } else if (this.phaseIndex === 2) {
      volume01 = 1 - smoothstep(this.phase01);
      flow01 = 0.82 * Math.pow(Math.sin(Math.PI * this.phase01), 0.88);
    } else {
      volume01 = 0;
    }
    this.cycle.phase = phase;
    this.cycle.moving = moving;
    this.cycle.volume01 = volume01;
    this.cycle.flow01 = flow01;
    return this.cycle;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output?.length) return true;
    const sampleCount = output[0].length;
    const deltaSeconds = 1 / sampleRate;

    for (let index = 0; index < sampleCount; index += 1) {
      this.smoothControls(deltaSeconds);
      this.updateExternal(deltaSeconds);
      if (!this.external.locked) this.advancePhase(deltaSeconds);
      const cycle = this.cycleFrame();
      const lockedReady =
        this.external.locked &&
        this.external.ageSeconds < 0.65 &&
        this.external.ready;
      const externalFlow = Math.pow(this.external.flow01, 0.83);
      const flow01 = this.external.locked
        ? lockedReady
          ? externalFlow
          : 0
        : mix(cycle.flow01, externalFlow, this.external.blend);
      const volume01 = this.external.locked
        ? this.external.volume01
        : mix(cycle.volume01, this.external.volume01, this.external.blend);
      const isInhale =
        this.external.locked
          ? this.external.phase === "inhale"
          : this.external.blend > 0.5
          ? this.external.phase === "inhale"
          : this.phaseIndex === 0;
      const brightness = this.currentTimbre.brightness01;
      const naturalness = this.currentTimbre.naturalness01;
      updateBreathSonicSpace(this.soundSpace, volume01, naturalness);
      const soundSpace = this.soundSpace;
      const phaseColor = isInhale ? 1.06 : 0.92;
      const baseCutoff = mix(820, 2580, brightness) * phaseColor;
      const cutoff =
        baseCutoff *
        soundSpace.cutoffMultiplier *
        mix(0.82, 1.12, flow01);
      const bandLow = Math.max(
        120,
        cutoff * mix(0.26, 0.16, soundSpace.openness01),
      );
      const bandHigh =
        cutoff *
        mix(0.55, 0.78, soundSpace.openness01) *
        soundSpace.spectralSpread;
      const left = this.filters[0].process(
        cutoff,
        bandLow,
        bandHigh,
        soundSpace.mouthResonanceHz,
        naturalness,
        soundSpace.roughnessMultiplier,
      );
      const right = this.filters[1].process(
        cutoff * 0.985,
        bandLow * 1.02,
        bandHigh * 0.97,
        soundSpace.mouthResonanceHz * 1.018,
        naturalness,
        soundSpace.roughnessMultiplier,
      );
      const center = (left + right) * 0.5;
      const inhaleGain = isInhale ? 1 : 0.74;
      const amplitude =
        Math.pow(flow01, 0.9) *
        inhaleGain *
        mix(0.12, 0.58, this.currentTimbre.intensity01);
      const activeTarget = this.active ? 1 : 0;
      this.activeGain +=
        (activeTarget - this.activeGain) *
        (1 - Math.exp(-deltaSeconds / (this.active ? 0.025 : 0.045)));
      const lockGate = this.external.locked ? this.external.blend : 1;
      const gain = amplitude * this.activeGain * lockGate;
      this.diffuseField.process(
        mix(center, left, soundSpace.stereoWidth),
        mix(center, right, soundSpace.stereoWidth),
        soundSpace.diffusionMix,
      );
      output[0][index] = Math.tanh(
        this.diffuseField.outputLeft * gain * 1.35,
      );
      if (output[1])
        output[1][index] = Math.tanh(
          this.diffuseField.outputRight * gain * 1.35,
        );

      this.lastFrame.phase =
        this.external.locked || this.external.blend > 0.5
          ? this.external.phase === "hold"
            ? volume01 > 0.5
              ? "inhale-hold"
              : "exhale-hold"
            : this.external.phase
          : cycle.phase;
      this.lastFrame.phase01 = this.phase01;
      this.lastFrame.volume01 = volume01;
      this.lastFrame.flow01 = flow01;
      this.lastFrame.openness01 = soundSpace.openness01;
      this.lastFrame.source =
        this.external.locked || this.external.blend > 0.5
          ? "physiology"
          : "cycle";
      this.lastFrame.breathNumber = this.breathNumber;
    }

    this.reportCountdown -= sampleCount;
    if (this.reportCountdown <= 0) {
      this.port.postMessage(this.lastFrame);
      this.reportCountdown += Math.round(sampleRate / 30);
    }
    return true;
  }
}

registerProcessor("ecgaming-breath-generator", ECGamingBreathProcessor);
