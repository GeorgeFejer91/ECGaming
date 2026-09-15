import "./styles.css";

const TOTAL_HOLD_MS = 180_000;
const DECAY_SCALE = 6;
const GRACE_MS = 1_200;
const RING_COUNT = 16;
const RING_POINTS = 26;

type InputMode = "manual" | "phone" | "simulate";
type Phase = "start" | "run" | "complete";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (t: number) => t * t * (3 - 2 * t);
const hash2 = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const formatTime = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};
const rgba = (r: number, g: number, b: number, a: number) =>
  `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("tunnel");
const ctx = canvas.getContext("2d")!;
const startScreen = $<HTMLElement>("start-screen");
const endScreen = $<HTMLElement>("end-screen");
const hud = $<HTMLElement>("hud");
const stateLabel = $<HTMLElement>("state-label");
const holdHint = $<HTMLElement>("hold-hint");
const progressFill = $<HTMLElement>("progress-fill");
const progressTrack = $<HTMLElement>("progress-track");
const elapsedLabel = $<HTMLElement>("elapsed-label");
const holdTimer = $<HTMLElement>("hold-timer");
const journeyPct = $<HTMLElement>("journey-pct");
const holdBtn = $<HTMLButtonElement>("hold-btn");
const beginBtn = $<HTMLButtonElement>("begin-btn");
const againBtn = $<HTMLButtonElement>("again-btn");
const muteBtn = $<HTMLButtonElement>("mute-btn");
const senseNote = $<HTMLElement>("sense-note");

let W = 0;
let H = 0;
let DPR = 1;
const resize = () => {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = canvas.clientWidth;
  H = canvas.clientHeight;
  canvas.width = Math.max(1, Math.floor(W * DPR));
  canvas.height = Math.max(1, Math.floor(H * DPR));
};
resize();
window.addEventListener("resize", resize);

interface Mote {
  z: number;
  radial: number;
  angle: number;
  size: number;
  phase: number;
  glint: boolean;
}

interface Wing {
  z: number;
  radial: number;
  angle: number;
  drift: number;
}

const motes: Mote[] = Array.from({ length: 70 }, () => spawnMote(true));
const wings: Wing[] = Array.from({ length: 3 }, (_, i) => ({
  z: 0.34 + i * 0.16,
  radial: 0.5,
  angle: Math.PI * 0.25 * i,
  drift: 0.05 + 0.02 * i,
}));

function spawnMote(anywhere: boolean): Mote {
  return {
    z: anywhere ? Math.random() : 0.02,
    radial: 0.15 + Math.random() * 0.85,
    angle: Math.random() * Math.PI * 2,
    size: 0.5 + Math.random() * 1.4,
    phase: Math.random() * Math.PI * 2,
    glint: Math.random() < 0.16,
  };
}

class StillnessLock {
  private calib: number[] = [];
  private baseline = 0;
  private lastTime = -1;
  private energy = 0;
  private readonly samples = 150;
  calibrated = false;
  holding = false;

  accept(z: number, timeMs: number) {
    if (!this.calibrated) {
      this.calib.push(z);
      if (this.calib.length >= this.samples) {
        this.baseline =
          this.calib.reduce((a, b) => a + b, 0) / this.calib.length;
        this.energy = 0;
        this.calibrated = true;
      }
      return;
    }
    const dt = clamp((timeMs - this.lastTime) / 1000, 0.005, 0.25);
    this.lastTime = timeMs;
    const deviation = Math.abs(z - this.baseline);
    const alpha = Math.min(1, dt / 0.4);
    this.energy = this.energy + (deviation - this.energy) * alpha;
    this.holding = this.energy < 0.055;
  }

  get progress01() {
    return this.calibrated
      ? 1
      : clamp(this.calib.length / this.samples, 0, 0.99);
  }

  get energy01() {
    return clamp(this.energy / 0.25, 0, 1);
  }
}

const phoneSense = new StillnessLock();

class Tone {
  private audio: AudioContext | null = null;
  private master: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private shimmerGain: GainNode | null = null;
  muted = false;

  private ensure() {
    if (this.audio) return;
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    this.audio = new Ctor();
    this.master = this.audio.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.audio.destination);

    this.droneGain = this.audio.createGain();
    this.droneGain.gain.value = 0;
    this.droneFilter = this.audio.createBiquadFilter();
    this.droneFilter.type = "lowpass";
    this.droneFilter.frequency.value = 140;
    for (const freq of [48, 48.9, 96.5]) {
      const osc = this.audio.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.detune.value = Math.random() * 80 - 40;
      osc.connect(this.droneFilter);
      osc.start();
    }
    this.droneFilter.connect(this.droneGain);
    this.droneGain.connect(this.master);

    this.shimmerGain = this.audio.createGain();
    this.shimmerGain.gain.value = 0;
    const shimmerOsc = this.audio.createOscillator();
    shimmerOsc.type = "sine";
    shimmerOsc.frequency.value = 219.5;
    shimmerOsc.connect(this.shimmerGain);
    this.shimmerGain.connect(this.master);
    shimmerOsc.start();
  }

  async start() {
    this.ensure();
    if (!this.audio) return;
    if (this.audio.state === "suspended") {
      try {
        await this.audio.resume();
      } catch {
        return;
      }
    }
  }

  update(progress: number) {
    if (!this.audio || !this.droneGain || !this.droneFilter || !this.shimmerGain)
      return;
    const now = this.audio.currentTime;
    const level = this.muted ? 0 : 1;
    const closeness = 1 - progress;
    this.droneGain.gain.setTargetAtTime(
      0.05 * level + 0.16 * level * closeness,
      now,
      0.6,
    );
    this.droneFilter.frequency.setTargetAtTime(
      120 + 1500 * closeness,
      now,
      0.7,
    );
    this.shimmerGain.gain.setTargetAtTime(
      0.02 * level * closeness * closeness,
      now,
      1.2,
    );
  }

  bell(freq: number, delay: number, gain: number, length: number) {
    if (!this.audio || !this.master) return;
    const now = this.audio.currentTime + delay;
    const osc = this.audio.createOscillator();
    const wave = this.audio.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    wave.type = "sine";
    wave.frequency.value = freq * 2.004;
    const g = this.audio.createGain();
    g.gain.value = 0;
    osc.connect(g);
    wave.connect(g);
    g.connect(this.master);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain * (this.muted ? 0 : 1), now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + length);
    osc.start(now);
    osc.stop(now + length + 0.05);
    wave.start(now);
    wave.stop(now + length + 0.05);
  }

  chime(progress: number) {
    const base = 587 + Math.round(progress * 2) * 4;
    this.bell(base, 0, 0.04, 1.6);
    this.bell(base * 1.5, 0.09, 0.025, 1.3);
  }

  complete() {
    const chords = [523.25, 659.25, 783.99, 1046.5];
    chords.forEach((freq, i) => this.bell(freq, i * 0.22, 0.05, 2.6));
    this.bell(1567.98, 0.9, 0.04, 3.4);
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }
}

const tone = new Tone();

let mode: InputMode = "manual";
let phase: Phase = "start";
let heldMs = 0;
let elapsedMs = 0;
let lastHeldAt = -Infinity;
let holding = false;
let lightPos = 0.96;
let completionT = 0;
let releaseWave = 0;
let runStart = 0;
let revealedEnd = false;
let holdingKey = false;
let holdingPointer = false;
let motionAttached = false;
let motionNoteTimer = 0;
let lastFrame = 0;

const holdingNow = (): boolean => {
  if (phase !== "run") return false;
  if (mode === "manual") return holdingKey || holdingPointer;
  if (mode === "simulate") return true;
  return phoneSense.calibrated && phoneSense.holding;
};

const progress01 = () => (phase === "complete" ? 1 : heldMs / TOTAL_HOLD_MS);

function updateSenseNote() {
  if (mode === "manual") {
    senseNote.textContent = "";
  } else if (mode === "phone") {
    senseNote.textContent = phoneSense.calibrated
      ? "Sensor ready — lying still means holding your breath."
      : "Listening for belly motion… keep the phone still to calibrate.";
  } else {
    senseNote.textContent =
      "Showcase: the crossing plays itself in three minutes.";
  }
}

function attachMotion() {
  if (motionAttached) return;
  motionAttached = true;
  window.addEventListener("devicemotion", onMotion, { passive: true });
}

function onMotion(event: DeviceMotionEvent) {
  const accel = event.accelerationIncludingGravity;
  if (!accel) return;
  const z = accel.z ?? 0;
  phoneSense.accept(z, performance.now());
  if (!phoneSense.calibrated && phase === "start") {
    senseNote.textContent = `Calibrating… ${Math.round(
      phoneSense.progress01 * 100,
    )}%`;
  }
  motionNoteTimer = 0;
}

async function requestMotionPermission(): Promise<boolean> {
  const DME = DeviceMotionEvent as unknown as {
    requestPermission?: () => Promise<string>;
  };
  if (typeof DME.requestPermission === "function") {
    try {
      return (await DME.requestPermission()) === "granted";
    } catch {
      return false;
    }
  }
  return true;
}

async function enablePhoneMode() {
  attachMotion();
  updateSenseNote();
  motionNoteTimer = performance.now();
  const granted = await requestMotionPermission();
  if (!granted) {
    senseNote.textContent =
      "Motion permission blocked — use the hold button instead.";
  }
}

function resetToStart() {
  phase = "start";
  hud.hidden = true;
  endScreen.hidden = true;
  endScreen.setAttribute("aria-hidden", "true");
  startScreen.hidden = false;
  updateSenseNote();
}

function begin() {
  phase = "run";
  runStart = performance.now();
  heldMs = 0;
  elapsedMs = 0;
  completionT = 0;
  revealedEnd = false;
  releaseWave = 0;
  lightPos = 0.96;
  holding = false;
  lastHeldAt = -Infinity;
  endScreen.hidden = true;
  endScreen.setAttribute("aria-hidden", "true");
  startScreen.hidden = true;
  hud.hidden = false;
  void tone.start();
}

function finish() {
  phase = "complete";
  completionT = 0;
  tone.complete();
}

beginBtn.addEventListener("click", begin);
againBtn.addEventListener("click", resetToStart);

const modeRadios = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="mode"]'),
);
modeRadios.forEach((radio) =>
  radio.addEventListener("change", () => {
    mode = radio.value as InputMode;
    if (mode === "phone") void enablePhoneMode();
    updateSenseNote();
  }),
);

window.addEventListener("keydown", (e) => {
  if (e.key !== " ") return;
  if (phase === "run") {
    e.preventDefault();
    holdingKey = true;
  } else if (phase === "start" && document.activeElement === beginBtn) {
    beginBtn.click();
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.key === " ") holdingKey = false;
});

holdBtn.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  holdingPointer = true;
});
window.addEventListener("pointerup", () => {
  holdingPointer = false;
});
window.addEventListener("pointercancel", () => {
  holdingPointer = false;
});

muteBtn.addEventListener("click", () => {
  const muted = tone.toggleMute();
  muteBtn.textContent = muted ? "SOUND OFF" : "SOUND ON";
  muteBtn.setAttribute("aria-pressed", String(muted));
});

function tick(now: number, dt: number) {
  if (phase === "run") {
    elapsedMs = now - runStart;
    const wasHolding = holding;
    holding = holdingNow();
    if (holding) {
      if (!wasHolding) {
        lastHeldAt = now;
        tone.chime(progress01());
        releaseWave = 0;
      }
      heldMs = Math.min(TOTAL_HOLD_MS, heldMs + dt * 1000);
    } else {
      if (wasHolding) releaseWave = 1;
      if (now - lastHeldAt > GRACE_MS) {
        heldMs = Math.max(0, heldMs - (dt * 1000) / DECAY_SCALE);
      }
    }
    if (heldMs >= TOTAL_HOLD_MS) finish();
  }

  if (phase === "complete") {
    completionT = Math.min(1, completionT + dt / 3);
    if (completionT >= 0.98 && !revealedEnd) {
      revealedEnd = true;
      hud.hidden = true;
      endScreen.hidden = false;
      endScreen.setAttribute("aria-hidden", "false");
    }
  }

  const goal = phase === "complete" ? 0.01 : lerp(0.96, 0.06, progress01());
  lightPos += (goal - lightPos) * (1 - Math.pow(0.03, dt));
  releaseWave = Math.max(0, releaseWave - dt * 0.5);

  if (motionNoteTimer && phase === "start" && mode === "phone") {
    if (now - motionNoteTimer > 5000) {
      motionNoteTimer = 0;
      senseNote.textContent =
        "No motion events yet — this needs a phone with the sensor.";
    }
  }

  tone.update(progress01());
}

function updateHud() {
  if (phase !== "run") return;
  const progress = progress01();
  const pct = Math.round(progress * 100);
  progressFill.style.width = `${pct}%`;
  progressTrack.setAttribute("aria-valuenow", String(pct));
  elapsedLabel.textContent = `${formatTime(elapsedMs)} elapsed`;
  holdTimer.textContent = `${formatTime(heldMs)} held`;
  journeyPct.textContent = `${pct}% of the way`;

  stateLabel.classList.remove("holding", "withdrawing");
  holdBtn.classList.toggle("held", holding);

  if (pct >= 100) {
    stateLabel.textContent = "you reached the light";
    holdHint.textContent = "breathe — you are through";
    return;
  }
  if (holding) {
    stateLabel.classList.add("holding");
    stateLabel.textContent = "HOLDING YOUR BREATH";
    holdHint.textContent =
      pct >= 88 ? "the light is almost here — hold" : "hold and the light advances";
    return;
  }
  stateLabel.classList.add("withdrawing");
  stateLabel.textContent = "BREATHING";
  holdHint.textContent =
    heldMs === 0 ? "hold to begin" : "hold again — the light waits";
}

function ringR(z: number) {
  return lerp(1, 0.13, Math.pow(z, 0.62)) * Math.hypot(W, H) * 0.5;
}

let vx = 0;
let vy = 0;
let maxR = 1;

interface StreamRing {
  z: number;
  seed: number;
  speed: number;
}

let streamRings: StreamRing[] = Array.from(
  { length: RING_COUNT },
  (_, i) => ({
    z: (i + 1) / RING_COUNT,
    seed: Math.random(),
    speed: 0.6 + 0.8 * Math.random(),
  }),
);

function drawRing(ring: StreamRing, now: number) {
  const z = ring.z;
  const r = ringR(z);
  const arrival = clamp(1 - lightPos, 0, 1);
  const depth = 0.35 + 0.65 * z;
  const para = 1 + (holding ? 1.5 : 0.4) * smoothstep(arrival);
  const cx =
    lerp(W * 0.5, vx, depth) +
    Math.sin(now * 0.0013 + z * 9) * 0.006 * depth * para * W;
  const cy =
    lerp(H * 0.5, vy, depth) +
    Math.cos(now * 0.0011 + z * 7) * 0.009 * depth * para * H;
  const points: number[][] = [];
  for (let k = 0; k < RING_POINTS; k++) {
    const baseAngle = (k / RING_POINTS) * Math.PI * 2;
    const wobble =
      (hash2(Math.round(ring.seed * 9973), k) * 2 - 1) * 0.05 * (1 - z * 0.55) +
      Math.sin(now * 0.00022 + k * 0.83 + z * 24) * 0.014 * (1 - z * 0.4);
    const rr = r * (1 + wobble);
    points.push([
      cx + Math.cos(baseAngle) * rr,
      cy + Math.sin(baseAngle) * rr * 0.82,
    ]);
  }

  const glow = Math.exp(-Math.abs(z - lightPos) * 3.4);
  const wallFade = clamp(1 - z * 0.7, 0, 1);

  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let k = 1; k < points.length; k++) ctx.lineTo(points[k][0], points[k][1]);
  ctx.closePath();
  ctx.strokeStyle = rgba(200, 191, 141, 0.34 * glow + 0.035 * wallFade);
  ctx.lineWidth = clamp(r * 0.006, 0.5, 3);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(points[0][0] + 1, points[0][1] + 1);
  for (let k = 1; k < points.length; k++)
    ctx.lineTo(points[k][0] + 1, points[k][1] + 1);
  ctx.closePath();
  ctx.strokeStyle = rgba(120, 118, 140, 0.14 * wallFade);
  ctx.lineWidth = clamp(r * 0.012, 1, 5);
  ctx.stroke();
}

function drawWings(now: number) {
  ctx.save();
  for (const wing of wings) {
    const r = ringR(wing.z) * wing.radial;
    const ang = wing.angle + Math.sin(now * 0.00012 + wing.z * 10) * wing.drift;
    const x = vx + Math.cos(ang) * r;
    const y = vy + Math.sin(ang) * r * 0.82;
    const s = r * 0.22;
    const a = 0.035 + 0.05 * clamp(1 - Math.abs(wing.z - lightPos) * 3, 0, 1);
    ctx.translate(x, y);
    ctx.rotate(ang + Math.PI / 2);
    ctx.globalAlpha = a;
    ctx.fillStyle = "#050609";
    ctx.beginPath();
    ctx.moveTo(-s * 0.6, -s);
    ctx.bezierCurveTo(-s * 2.1, -s * 0.4, -s * 1.6, s * 0.7, -s * 0.3, s * 0.85);
    ctx.lineTo(-s * 0.35, s * 1.05);
    ctx.lineTo(-s * 0.05, s * 0.8);
    ctx.lineTo(0, s * 1.25);
    ctx.lineTo(s * 0.05, s * 0.8);
    ctx.lineTo(s * 0.35, s * 1.05);
    ctx.lineTo(s * 0.3, s * 0.85);
    ctx.bezierCurveTo(s * 1.6, s * 0.7, s * 2.1, -s * 0.4, s * 0.6, -s);
    ctx.closePath();
    ctx.fill();
    ctx.rotate(-(ang + Math.PI / 2));
    ctx.translate(-x, -y);
  }
  ctx.restore();
}

function drawLight(now: number, swell: number, arrival: number) {
  const r = ringR(lightPos);
  const coreR = r * (0.5 + 0.62 * smoothstep(arrival)) * (1 + swell);
  const haloR = coreR * (2.4 + 0.5 * Math.sin(now * 0.0004));
  const lightA = 0.3 + 0.7 * smoothstep(clamp(arrival * 2.4, 0, 1));
  const cx = vx;
  const cy = vy;

  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
  halo.addColorStop(0, rgba(243, 231, 168, lightA * 0.8));
  halo.addColorStop(0.35, rgba(243, 231, 168, lightA * 0.4));
  halo.addColorStop(0.7, rgba(141, 135, 94, lightA * 0.18));
  halo.addColorStop(1, rgba(8, 8, 12, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(cx - haloR, cy - haloR, haloR * 2, haloR * 2);

  const mid = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2);
  mid.addColorStop(0, rgba(255, 251, 230, lightA));
  mid.addColorStop(0.45, rgba(243, 231, 168, lightA * 0.75));
  mid.addColorStop(1, rgba(141, 135, 94, 0));
  ctx.fillStyle = mid;
  ctx.fillRect(cx - coreR * 2, cy - coreR * 2, coreR * 4, coreR * 4);

  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
  core.addColorStop(0, rgba(255, 251, 230, 1));
  core.addColorStop(0.5, rgba(255, 248, 214, 0.9));
  core.addColorStop(1, rgba(243, 231, 168, 0.25));
  ctx.fillStyle = core;
  ctx.fillRect(cx - coreR, cy - coreR, coreR * 2, coreR * 2);

  ctx.save();
  ctx.setLineDash([coreR * 0.4, coreR * 0.16]);
  ctx.lineDashOffset = -now * 0.00032;
  ctx.strokeStyle = rgba(255, 251, 230, 0.22 + arrival * 0.45);
  ctx.lineWidth = clamp(coreR * 0.02, 1, 3);
  ctx.beginPath();
  ctx.arc(cx, cy, coreR * 1.18, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  if (holding) {
    const ring = ctx.createRadialGradient(cx, cy, coreR * 1.3, cx, cy, coreR * 2.1);
    ring.addColorStop(0, rgba(255, 251, 230, 0.12));
    ring.addColorStop(1, rgba(3, 3, 5, 0));
    ctx.fillStyle = ring;
    ctx.fillRect(cx - coreR * 2.1, cy - coreR * 2.1, coreR * 4.2, coreR * 4.2);
  }
}

function updateMotes(now: number) {
  for (const mote of motes) {
    if (phase === "complete") {
      mote.z += 0.0012;
      mote.radial += Math.sin(now * 0.0001 + mote.phase) * 0.0004;
      if (mote.z > 1.2) Object.assign(mote, spawnMote(false));
      continue;
    }
    const diff = lightPos - mote.z;
    mote.z += diff * (0.0003 + Math.abs(diff) * 0.02);
    mote.radial += Math.sin(now * 0.00004 + mote.phase) * 0.0006;
    if (Math.abs(diff) < 0.012) Object.assign(mote, spawnMote(false));
  }
}

function drawMotes() {
  for (const mote of motes) {
    const r = ringR(mote.z) * (0.1 + mote.radial * 0.95);
    const x = vx + Math.cos(mote.angle + mote.phase) * r;
    const y = vy + Math.sin(mote.angle + mote.phase) * r * 0.82;
    const proximity = clamp(1 - Math.abs(mote.z - lightPos) * 6, 0, 1);
    ctx.fillStyle = rgba(235, 228, 200, 0.04 + 0.5 * proximity);
    ctx.fillRect(x, y, mote.size, mote.size);
    if (mote.glint && proximity > 0.35) {
      ctx.strokeStyle = rgba(255, 251, 230, proximity * 0.5);
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(x - mote.size * 2, y);
      ctx.lineTo(x + mote.size * 2, y);
      ctx.moveTo(x, y - mote.size * 2);
      ctx.lineTo(x, y + mote.size * 2);
      ctx.stroke();
    }
  }
}

function drawReleaseWave() {
  const t = 1 - releaseWave;
  ctx.strokeStyle = rgba(6, 6, 9, 0.4 * t);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(vx, vy, Math.hypot(W, H) * 0.25 * t, 0, Math.PI * 2);
  ctx.stroke();
}

function drawGrain(now: number) {
  ctx.fillStyle = rgba(230, 227, 207, 0.05);
  for (let i = 0; i < 70; i++) {
    const x = Math.floor((hash2(i, Math.floor(now / 50)) * 997) % W);
    const y = Math.floor((hash2(i, Math.floor(now / 60)) * 877) % H);
    ctx.fillRect(x, y, 1, 1);
  }
}

function drawVignette(arrival: number) {
  const holdInk = holding ? 0.18 : 0;
  const radial = ctx.createRadialGradient(vx, vy, maxR * 0.25, vx, vy, maxR);
  radial.addColorStop(0, rgba(0, 0, 0, 0));
  radial.addColorStop(1, rgba(0, 0, 0, 0.72 + holdInk - arrival * 0.3));
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, W, H);
}

function renderOtherSide() {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#16120c");
  sky.addColorStop(0.55, "#3a2f1d");
  sky.addColorStop(1, "#0c0a07");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  const cx = W * 0.5;
  const cy = H * 0.44;
  const wide = Math.hypot(W, H);
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, wide * 0.7);
  glow.addColorStop(0, rgba(255, 251, 230, 0.95));
  glow.addColorStop(0.3, rgba(243, 231, 168, 0.6));
  glow.addColorStop(0.7, rgba(200, 191, 141, 0.22));
  glow.addColorStop(1, rgba(8, 8, 12, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(cx - wide, cy - wide, wide * 2, wide * 2);

  ctx.globalAlpha = 0.8;
  for (const mote of motes) {
    const x =
      cx + Math.sin(mote.angle + mote.phase * 3) * wide * 0.5 * mote.radial;
    const y = cy + wide * 0.34 - mote.z * wide * 0.9;
    ctx.fillStyle = rgba(255, 248, 214, 0.5 + mote.phase * 0.2);
    ctx.fillRect(x, y, mote.size * 1.4, mote.size * 1.4);
  }
  ctx.globalAlpha = 1;
}

function render(now: number, dt: number) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (W === 0 || H === 0) return;

  vx = W * (0.5 + Math.sin(now * 0.00006) * 0.015);
  vy = H * (0.5 + Math.sin(now * 0.00005) * 0.02);
  maxR = Math.hypot(W, H) * 0.5;

  if (completionT >= 1) {
    renderOtherSide();
    return;
  }

  const breathSwell =
    Math.sin(now * (holding ? 0.0007 : 0.0014)) * (holding ? 0.015 : 0.04);
  const arrival = clamp(1 - lightPos, 0, 1);

  const zoomK =
    (phase === "complete"
      ? 0.03
      : 0.12 + 1.7 * smoothstep(arrival) + (holding ? 1.5 : 0)) *
    0.09;

  for (const ring of streamRings) {
    ring.z -= dt * zoomK * ring.speed;
    if (ring.z <= 0) {
      ring.z = 1.015;
      ring.seed = Math.random();
      ring.speed = 0.6 + 0.8 * Math.random();
    }
  }
  for (const wing of wings) {
    wing.z -= dt * 0.012 * zoomK;
    if (wing.z <= 0) wing.z = 0.96;
  }

  ctx.fillStyle = "#030305";
  ctx.fillRect(0, 0, W, H);

  const fogR = ringR(lightPos) * 7;
  const fog = ctx.createRadialGradient(vx, vy, 0, vx, vy, fogR);
  const fogAlpha = 0.05 + 0.3 * smoothstep(arrival);
  fog.addColorStop(0, rgba(243, 231, 168, fogAlpha));
  fog.addColorStop(0.5, rgba(141, 135, 94, fogAlpha * 0.35));
  fog.addColorStop(1, rgba(3, 3, 5, 0));
  ctx.fillStyle = fog;
  ctx.fillRect(0, 0, W, H);

  drawWings(now);
  for (const ring of streamRings) drawRing(ring, now);
  drawLight(now, breathSwell, arrival);
  updateMotes(now);
  drawMotes();
  if (releaseWave > 0) drawReleaseWave();
  drawGrain(now);
  drawVignette(arrival);
}

function frame(now: number) {
  const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000));
  lastFrame = now;
  tick(now, dt);
  render(now, dt);
  updateHud();
  requestAnimationFrame(frame);
}

requestAnimationFrame((now) => {
  lastFrame = now;
  frame(now);
});