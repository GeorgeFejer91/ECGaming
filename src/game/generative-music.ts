import type { MetricId } from "../protocol/types";
import { METRIC_RANGE_DEFAULTS } from "../signals/mappings";
import { getSharedAudioContext } from "./sound";

const clamp01 = (value: number | undefined) =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value as number)) : 0;
const lerp = (from: number, to: number, amount: number) =>
  from + (to - from) * clamp01(amount);

/* ------------------------------------------------------------------ */
/*  Drone                                                              */
/* ------------------------------------------------------------------ */
export const MUSIC_DRONE_MIN_CUTOFF_HZ = 220;
export const MUSIC_DRONE_MAX_CUTOFF_HZ = 2_600;
export const MUSIC_DRONE_LEVEL = 0.16;
const DRONE_FILTER_RAMP_S = 0.8;

/* ------------------------------------------------------------------ */
/*  Sub-bass pulse                                                     */
/* ------------------------------------------------------------------ */
export const MUSIC_PULSE_MIN_PERIOD_MS = 260;
export const MUSIC_PULSE_MAX_PERIOD_MS = 1_500;
export const MUSIC_PULSE_LEVEL = 0.07;

/* ------------------------------------------------------------------ */
/*  Melody (Moody-style pentatonic sine voice)                         */
/* ------------------------------------------------------------------ */
const MELODY_NOTES_HZ = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25] as const;
const MELODY_MIN_PERIOD_S = 1.4;
const MELODY_MAX_PERIOD_S = 5.5;
const MELODY_LEVEL = 0.09;
const MELODY_ATTACK_S = 0.04;
const MELODY_DECAY_S = 1.4;
const MELODY_FILTER_MIN_HZ = 400;
const MELODY_FILTER_MAX_HZ = 2_200;
const DELAY_TIME_S = 0.75;
const DELAY_FEEDBACK = 0.32;
const DELAY_FILTER_HZ = 1_800;

/* ------------------------------------------------------------------ */
/*  Chords (sustained pentatonic triads)                               */
/* ------------------------------------------------------------------ */
const CHORD_NOTES_HZ = [261.63, 293.66, 329.63, 392.0, 440.0] as const;
const CHORD_TRIADS: readonly (readonly number[])[] = [
  [0, 2, 4],
  [1, 3, 0],
  [2, 4, 1],
  [3, 0, 2],
  [4, 1, 3],
];
const CHORD_MIN_PERIOD_S = 3.0;
const CHORD_MAX_PERIOD_S = 8.0;
const CHORD_LEVEL = 0.06;
const CHORD_ATTACK_S = 0.15;
const CHORD_DECAY_S = 2.5;
const CHORD_FILTER_MIN_HZ = 300;
const CHORD_FILTER_MAX_HZ = 1_800;

/* ------------------------------------------------------------------ */
/*  Scheduling / lifecycle                                             */
/* ------------------------------------------------------------------ */
const SCHEDULE_HORIZON_S = 0.12;
const SCHEDULE_TICK_MS = 50;
const DISCONNECT_DELAY_MS = 420;
const GAIN_OFF = 0.0001;
const GAIN_ON = 1.0;
const VARIANT_RAMP_S = 0.6;
const MUSIC_VARIANT_KEY = "ecgaming-music-variant-v1";

/* ------------------------------------------------------------------ */
/*  Variant                                                            */
/* ------------------------------------------------------------------ */
export type GenerativeVariant = "drone" | "melody" | "chords";
export const VARIANT_LIST: readonly GenerativeVariant[] = [
  "drone",
  "melody",
  "chords",
];
export const VARIANT_LABELS: Record<GenerativeVariant, string> = {
  drone: "DRONE",
  melody: "MELODY",
  chords: "CHORDS",
};

/* ------------------------------------------------------------------ */
/*  Public signal interface                                            */
/* ------------------------------------------------------------------ */
export interface GenerativeMusicSignal {
  /** 0–1 → drone lowpass cutoff (dark ↔ bright). */
  drone01?: number;
  /** 0–1 → pulse interval + melody/chord tempo. */
  pulse01?: number;
}

/* ------------------------------------------------------------------ */
/*  Pure helpers (exported for testing)                                */
/* ------------------------------------------------------------------ */
export function musicDroneCutoffHz(drone01: number): number {
  return lerp(MUSIC_DRONE_MIN_CUTOFF_HZ, MUSIC_DRONE_MAX_CUTOFF_HZ, drone01);
}
export function musicPulsePeriodMs(pulse01: number): number {
  return lerp(MUSIC_PULSE_MAX_PERIOD_MS, MUSIC_PULSE_MIN_PERIOD_MS, pulse01);
}
export function normalizeMusicMetric(
  metric: MetricId,
  value: number | undefined,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const range = METRIC_RANGE_DEFAULTS[metric];
  if (!range || range.maximum <= range.minimum) return undefined;
  return clamp01((value - range.minimum) / (range.maximum - range.minimum));
}

function pickNextMelodyNote(lastIdx: number): number {
  const step = Math.floor(Math.random() * 3) - 1;
  return Math.max(
    0,
    Math.min(MELODY_NOTES_HZ.length - 1, lastIdx + step),
  );
}

/* ------------------------------------------------------------------ */
/*  GenerativeMusic                                                    */
/* ------------------------------------------------------------------ */
export class GenerativeMusic {
  private context?: AudioContext;
  private enabled = false;
  private drone01 = 0;
  private pulse01 = 0;
  private variant: GenerativeVariant;
  private masterGain?: GainNode;
  private pendingDisconnect?: number;

  /* drone layer */
  private droneFilter?: BiquadFilterNode;
  private droneLayerGain?: GainNode;

  /* melody layer */
  private melodyFilter?: BiquadFilterNode;
  private melodySendGain?: GainNode;
  private melodyLayerGain?: GainNode;
  private delayNode?: DelayNode;
  private delayFilter?: BiquadFilterNode;
  private delayFeedback?: GainNode;
  private melodyTimer?: number;
  private nextMelodyAtS = 0;
  private lastMelodyIdx = 2;

  /* chord layer */
  private chordFilter?: BiquadFilterNode;
  private chordSendGain?: GainNode;
  private chordLayerGain?: GainNode;
  private chordTimer?: number;
  private nextChordAtS = 0;

  /* pulse (always active) */
  private pulseTimer?: number;
  private nextPulseAtS = 0;

  constructor() {
    let v: GenerativeVariant = "drone";
    try {
      const saved = localStorage.getItem(MUSIC_VARIANT_KEY);
      if (saved && (VARIANT_LIST as readonly string[]).includes(saved))
        v = saved as GenerativeVariant;
    } catch { /* storage unavailable */ }
    this.variant = v;
  }

  /* ---------------------------------------------------------------- */
  /*  Public API                                                       */
  /* ---------------------------------------------------------------- */
  async unlock(): Promise<void> {
    try {
      const ctx = getSharedAudioContext();
      if (ctx.state === "suspended") await ctx.resume();
      this.context = ctx;
      if (this.enabled) this.ensureGraph();
    } catch {
      this.context = undefined;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(value: boolean) {
    this.enabled = Boolean(value);
    if (this.pendingDisconnect !== undefined) {
      window.clearTimeout(this.pendingDisconnect);
      this.pendingDisconnect = undefined;
    }
    if (!this.enabled) {
      this.shutdownGraph();
      return;
    }
    if (!this.context) {
      void this.unlock();
      return;
    }
    this.ensureGraph();
  }

  setSignal(signal: GenerativeMusicSignal) {
    if (Number.isFinite(signal.drone01)) this.drone01 = clamp01(signal.drone01);
    if (Number.isFinite(signal.pulse01)) this.pulse01 = clamp01(signal.pulse01);
    this.applySignal();
  }

  variantLabel(): GenerativeVariant {
    return this.variant;
  }

  setVariant(v: GenerativeVariant) {
    this.variant = v;
    this.applyVariant();
    try {
      localStorage.setItem(MUSIC_VARIANT_KEY, v);
    } catch { /* storage unavailable */ }
  }

  cycleVariant() {
    const idx = VARIANT_LIST.indexOf(this.variant);
    this.setVariant(VARIANT_LIST[(idx + 1) % VARIANT_LIST.length]);
  }

  /* ---------------------------------------------------------------- */
  /*  Graph lifecycle                                                  */
  /* ---------------------------------------------------------------- */
  private ensureGraph() {
    if (!this.context) return;
    if (this.masterGain) {
      this.rampMasterTo(MUSIC_DRONE_LEVEL);
      this.applyVariant();
      return;
    }

    const ctx = this.context;
    const master = ctx.createGain();
    master.gain.value = 0.0001;

    /* ---- DRONE LAYER ---- */
    const droneLayer = ctx.createGain();
    droneLayer.gain.value = GAIN_ON;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = MUSIC_DRONE_MIN_CUTOFF_HZ;
    droneFilter.Q.value = 0.6;
    const droneOscGain = ctx.createGain();
    droneOscGain.gain.value = 0.05;
    for (const freq of [110, 165]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      osc.detune.value = Math.random() * 8 - 4;
      osc.connect(droneFilter);
      osc.start();
    }
    droneFilter.connect(droneOscGain);
    droneOscGain.connect(droneLayer);
    droneLayer.connect(master);

    /* ---- MELODY LAYER (pentatonic sine + delay reverb) ---- */
    const melodyLayer = ctx.createGain();
    melodyLayer.gain.value = GAIN_OFF;
    const melodyFilter = ctx.createBiquadFilter();
    melodyFilter.type = "lowpass";
    melodyFilter.frequency.value = MELODY_FILTER_MAX_HZ;
    melodyFilter.Q.value = 0.7;
    const melodySend = ctx.createGain();
    melodySend.gain.value = MELODY_LEVEL;
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = DELAY_TIME_S;
    const dFilter = ctx.createBiquadFilter();
    dFilter.type = "lowpass";
    dFilter.frequency.value = DELAY_FILTER_HZ;
    const dFeedback = ctx.createGain();
    dFeedback.gain.value = DELAY_FEEDBACK;
    delay.connect(dFilter);
    dFilter.connect(dFeedback);
    dFeedback.connect(delay);
    melodyFilter.connect(melodySend);
    melodySend.connect(melodyLayer);
    melodySend.connect(delay);
    delay.connect(melodyLayer);
    melodyLayer.connect(master);

    /* ---- CHORD LAYER (sustained triads) ---- */
    const chordLayer = ctx.createGain();
    chordLayer.gain.value = GAIN_OFF;
    const chordFilter = ctx.createBiquadFilter();
    chordFilter.type = "lowpass";
    chordFilter.frequency.value = CHORD_FILTER_MAX_HZ;
    chordFilter.Q.value = 0.7;
    const chordSend = ctx.createGain();
    chordSend.gain.value = CHORD_LEVEL;
    chordFilter.connect(chordSend);
    chordSend.connect(chordLayer);
    chordLayer.connect(master);

    master.connect(ctx.destination);

    this.masterGain = master;
    this.droneFilter = droneFilter;
    this.droneLayerGain = droneLayer;
    this.melodyFilter = melodyFilter;
    this.melodySendGain = melodySend;
    this.melodyLayerGain = melodyLayer;
    this.delayNode = delay;
    this.delayFilter = dFilter;
    this.delayFeedback = dFeedback;
    this.chordFilter = chordFilter;
    this.chordSendGain = chordSend;
    this.chordLayerGain = chordLayer;

    this.applySignal();
    this.rampMasterTo(MUSIC_DRONE_LEVEL);
    const now = ctx.currentTime;
    this.nextPulseAtS = now + this.pulsePeriodS;
    this.nextMelodyAtS = now + this.melodyPeriodS;
    this.nextChordAtS = now + this.chordPeriodS;
    this.armPulseScheduler();
    this.applyVariant();
  }

  private shutdownGraph() {
    const ctx = this.context;
    if (!ctx) return;
    for (const t of [this.pulseTimer, this.melodyTimer, this.chordTimer])
      if (t !== undefined) window.clearInterval(t);
    this.pulseTimer = undefined;
    this.melodyTimer = undefined;
    this.chordTimer = undefined;
    const master = this.masterGain;
    if (!master) return;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    this.pendingDisconnect = window.setTimeout(() => {
      this.masterGain?.disconnect();
      this.droneFilter?.disconnect();
      this.droneLayerGain?.disconnect();
      this.melodyFilter?.disconnect();
      this.melodySendGain?.disconnect();
      this.melodyLayerGain?.disconnect();
      this.delayNode?.disconnect();
      this.delayFilter?.disconnect();
      this.delayFeedback?.disconnect();
      this.chordFilter?.disconnect();
      this.chordSendGain?.disconnect();
      this.chordLayerGain?.disconnect();
      this.masterGain = undefined;
      this.droneFilter = undefined;
      this.droneLayerGain = undefined;
      this.melodyFilter = undefined;
      this.melodySendGain = undefined;
      this.melodyLayerGain = undefined;
      this.delayNode = undefined;
      this.delayFilter = undefined;
      this.delayFeedback = undefined;
      this.chordFilter = undefined;
      this.chordSendGain = undefined;
      this.chordLayerGain = undefined;
      this.pendingDisconnect = undefined;
    }, DISCONNECT_DELAY_MS);
  }

  private rampMasterTo(level: number) {
    const ctx = this.context;
    const master = this.masterGain;
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
    master.gain.exponentialRampToValueAtTime(level, now + 0.6);
  }

  /* ---------------------------------------------------------------- */
  /*  Signal / variant application                                     */
  /* ---------------------------------------------------------------- */
  private applySignal() {
    const ctx = this.context;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (this.droneFilter) {
      const cutoff = musicDroneCutoffHz(this.drone01);
      this.droneFilter.frequency.cancelScheduledValues(now);
      this.droneFilter.frequency.setTargetAtTime(cutoff, now, DRONE_FILTER_RAMP_S);
    }
    if (this.melodyFilter) {
      const cutoff = lerp(MELODY_FILTER_MIN_HZ, MELODY_FILTER_MAX_HZ, this.drone01);
      this.melodyFilter.frequency.cancelScheduledValues(now);
      this.melodyFilter.frequency.setTargetAtTime(cutoff, now, 1.0);
    }
    if (this.chordFilter) {
      const cutoff = lerp(CHORD_FILTER_MIN_HZ, CHORD_FILTER_MAX_HZ, this.drone01);
      this.chordFilter.frequency.cancelScheduledValues(now);
      this.chordFilter.frequency.setTargetAtTime(cutoff, now, 1.2);
    }
  }

  private applyVariant() {
    const ctx = this.context;
    if (!ctx) return;
    const now = ctx.currentTime;
    const tc = VARIANT_RAMP_S / 3;
    const mel = this.variant === "melody";
    const chd = this.variant === "chords";

    this.droneLayerGain?.gain.setTargetAtTime(
      mel || chd ? 0.5 : GAIN_ON, now, tc,
    );
    this.melodyLayerGain?.gain.setTargetAtTime(
      mel ? GAIN_ON : GAIN_OFF, now, tc,
    );
    this.chordLayerGain?.gain.setTargetAtTime(
      chd ? GAIN_ON : GAIN_OFF, now, tc,
    );

    if (mel && this.melodyTimer === undefined) this.armMelodyScheduler();
    else if (!mel && this.melodyTimer !== undefined) {
      window.clearInterval(this.melodyTimer);
      this.melodyTimer = undefined;
    }
    if (chd && this.chordTimer === undefined) this.armChordScheduler();
    else if (!chd && this.chordTimer !== undefined) {
      window.clearInterval(this.chordTimer);
      this.chordTimer = undefined;
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Pulse scheduler                                                  */
  /* ---------------------------------------------------------------- */
  private get pulsePeriodS(): number {
    return musicPulsePeriodMs(this.pulse01) / 1_000;
  }
  private get melodyPeriodS(): number {
    return lerp(MELODY_MAX_PERIOD_S, MELODY_MIN_PERIOD_S, this.pulse01);
  }
  private get chordPeriodS(): number {
    return lerp(CHORD_MAX_PERIOD_S, CHORD_MIN_PERIOD_S, this.pulse01);
  }
  private restProbability(): number {
    return lerp(0.45, 0.10, this.pulse01);
  }

  private armPulseScheduler() {
    if (this.pulseTimer !== undefined) return;
    this.pulseTimer = window.setInterval(() => this.flushPulse(), SCHEDULE_TICK_MS);
  }
  private armMelodyScheduler() {
    if (this.melodyTimer !== undefined) return;
    this.melodyTimer = window.setInterval(() => this.flushMelody(), SCHEDULE_TICK_MS);
  }
  private armChordScheduler() {
    if (this.chordTimer !== undefined) return;
    this.chordTimer = window.setInterval(() => this.flushChord(), SCHEDULE_TICK_MS);
  }

  private flushPulse() {
    const ctx = this.context;
    if (!ctx) return;
    while (this.nextPulseAtS <= ctx.currentTime + SCHEDULE_HORIZON_S) {
      this.emitPulse(this.nextPulseAtS);
      this.nextPulseAtS += this.pulsePeriodS;
    }
  }
  private flushMelody() {
    const ctx = this.context;
    if (!ctx) return;
    while (this.nextMelodyAtS <= ctx.currentTime + SCHEDULE_HORIZON_S) {
      this.emitMelodyNote(this.nextMelodyAtS);
      this.nextMelodyAtS += this.melodyPeriodS;
    }
  }
  private flushChord() {
    const ctx = this.context;
    if (!ctx) return;
    while (this.nextChordAtS <= ctx.currentTime + SCHEDULE_HORIZON_S) {
      this.emitChord(this.nextChordAtS);
      this.nextChordAtS += this.chordPeriodS;
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Voice emitters                                                   */
  /* ---------------------------------------------------------------- */
  private emitPulse(atS: number) {
    const ctx = this.context;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(70, atS);
    osc.frequency.exponentialRampToValueAtTime(40, atS + 0.1);
    gain.gain.setValueAtTime(0.0001, atS);
    gain.gain.exponentialRampToValueAtTime(MUSIC_PULSE_LEVEL, atS + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, atS + 0.16);
    osc.connect(gain);
    gain.connect(this.masterGain ?? ctx.destination);
    osc.start(atS);
    osc.stop(atS + 0.2);
  }

  private emitMelodyNote(atS: number) {
    const ctx = this.context;
    const filter = this.melodyFilter;
    if (!ctx || !filter) return;
    if (Math.random() < this.restProbability()) return;

    this.lastMelodyIdx = pickNextMelodyNote(this.lastMelodyIdx);
    const freq = MELODY_NOTES_HZ[this.lastMelodyIdx];

    const osc1 = ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.value = freq;
    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = freq * 1.003;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, atS);
    env.gain.exponentialRampToValueAtTime(1, atS + MELODY_ATTACK_S);
    env.gain.setTargetAtTime(0.0001, atS + MELODY_ATTACK_S, MELODY_DECAY_S / 3);

    osc1.connect(env);
    osc2.connect(env);
    env.connect(filter);
    osc1.start(atS);
    osc2.start(atS);
    osc1.stop(atS + MELODY_DECAY_S + 0.5);
    osc2.stop(atS + MELODY_DECAY_S + 0.5);
  }

  private emitChord(atS: number) {
    const ctx = this.context;
    const filter = this.chordFilter;
    if (!ctx || !filter) return;

    const triad =
      CHORD_TRIADS[Math.floor(Math.random() * CHORD_TRIADS.length)];
    for (const idx of triad) {
      const freq = CHORD_NOTES_HZ[idx];
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, atS);
      env.gain.exponentialRampToValueAtTime(1, atS + CHORD_ATTACK_S);
      env.gain.setTargetAtTime(0.0001, atS + CHORD_ATTACK_S, CHORD_DECAY_S / 3);
      osc.connect(env);
      env.connect(filter);
      osc.start(atS);
      osc.stop(atS + CHORD_DECAY_S + 0.5);
    }
  }
}
