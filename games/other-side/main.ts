import QRCode from "qrcode";
import { BreathLink, type BreathState } from "../../src/phone-breather/link";
import {
  createBreathInvitation,
  breathControllerUrl,
} from "../../src/phone-breather/invitation";

const TOTAL_STILL_MS = 180_000;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smoothstep = (v: number) => {
  const t = clamp(v, 0, 1);
  return t * t * (3 - 2 * t);
};
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const formatTime = (ms: number) => {
  const total = Math.floor(Math.max(0, ms) / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

document.body.dataset.mode = "desktop";

const canvas = byId<HTMLCanvasElement>("tunnel");
const ctx = canvas.getContext("2d")!;
const pairScreen = byId("pair-screen");
const qr = byId<HTMLCanvasElement>("pair-qr");
const pairLink = byId<HTMLAnchorElement>("pair-link");
const pairStatus = byId("pair-status");
const hud = byId("hud");
const stateLabel = byId("state-label");
const stateCopy = byId("state-copy");
const progressTrack = byId("progress-track");
const progressFill = byId("progress-fill");
const sessionTime = byId("session-time");
const stillTime = byId("still-time");
const journeyPct = byId("journey-pct");
const endScreen = byId("end-screen");
const again = byId<HTMLButtonElement>("again-btn");
const sound = byId<HTMLButtonElement>("sound-btn");

let width = 1;
let height = 1;
let dpr = 1;
let lastFrame = performance.now();
let startedAt = 0;
let sessionMs = 0;
let stillMs = 0;
let running = false;
let complete = false;
let remote: BreathState | null = null;
let remoteAt = -Infinity;
let autoStartAt = 0;
let stillCandidateAt = 0;
let confirmedStill = false;
let scroll = 0;

let audio: AudioContext | null = null;
let audioGain: GainNode | null = null;
let audioFilter: BiquadFilterNode | null = null;
let audioOn = false;

const resize = () => {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  width = canvas.clientWidth;
  height = canvas.clientHeight;
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
};
resize();
addEventListener("resize", resize);

const invitation = createBreathInvitation();
const controllerUrl = new URL(breathControllerUrl(location.href, invitation));
controllerUrl.searchParams.set("experience", "other-side");
const url = controllerUrl.href;
pairLink.href = url;

void QRCode.toCanvas(qr, url, {
  width: 260,
  margin: 2,
  errorCorrectionLevel: "M",
  color: { dark: "#11110f", light: "#f1eee3" },
}).catch(() => {
  pairStatus.textContent = "QR RENDERING FAILED · USE THE LINK BUTTON";
  pairStatus.classList.add("is-error");
});

const link = new BreathLink("target");
const fresh = (now = performance.now()) =>
  !!remote && link.ready && now - remoteAt < 1200;
const progress = () => clamp(stillMs / TOTAL_STILL_MS, 0, 1);

const milestone = (p: number) => {
  if (p >= 0.94) return "THE LIGHT HAS OPENED A SUPPORT TICKET";
  if (p >= 0.78) return "ANCESTRAL CUSTOMER SERVICE IS STILL BUFFERING";
  if (p >= 0.58) return "TUNNEL VISION UPGRADED TO PREMIUM";
  if (p >= 0.36) return "METAPHYSICAL LATENCY: ACCEPTABLE";
  if (p >= 0.16) return "THE VOID HAS ACKNOWLEDGED YOUR REQUEST";
  return "RESPIRATORY STILLNESS MOVES THE SIMULATION";
};

const begin = () => {
  running = true;
  complete = false;
  startedAt = performance.now();
  sessionMs = 0;
  stillMs = 0;
  confirmedStill = false;
  stillCandidateAt = 0;
  pairScreen.hidden = true;
  endScreen.hidden = true;
  hud.hidden = false;
};

const finish = () => {
  running = false;
  complete = true;
  hud.hidden = true;
  endScreen.hidden = false;
};

link.addEventListener("ready", () => {
  pairStatus.textContent = "PHONE CONNECTED · PLACE IT FLAT ON YOUR BELLY";
  pairStatus.classList.add("is-ready");
});

link.addEventListener(
  "status",
  ((event: CustomEvent<{ active: boolean; ready: boolean }>) => {
    if (event.detail.ready) return;
    pairStatus.textContent = event.detail.active
      ? "OPENING PRIVATE BODY-SENSOR LINK…"
      : "PHONE LINK INTERRUPTED · RESCAN IF NEEDED";
    pairStatus.classList.toggle("is-error", !event.detail.active);
  }) as EventListener,
);

link.addEventListener(
  "state",
  ((event: CustomEvent<BreathState>) => {
    if (!link.ready) return;
    remote = event.detail;
    remoteAt = performance.now();

    if (!running && !complete && event.detail.confidence01 > 0.28) {
      pairStatus.textContent = "BODY SIGNAL ACQUIRED · PREPARING TRANSCENDENCE";
      pairStatus.classList.add("is-ready");
      if (!autoStartAt) autoStartAt = performance.now() + 1300;
    }
  }) as EventListener,
);

void link.start(invitation).catch(() => {
  pairStatus.textContent = "COULD NOT OPEN PRIVATE LINK · REFRESH TO RETRY";
  pairStatus.classList.add("is-error");
});

sound.addEventListener("click", async () => {
  if (!audio) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    audio = new Ctor();
    audioGain = audio.createGain();
    audioGain.gain.value = 0;
    audioFilter = audio.createBiquadFilter();
    audioFilter.type = "lowpass";
    audioFilter.frequency.value = 210;
    audioFilter.connect(audioGain);
    audioGain.connect(audio.destination);

    for (const frequency of [43.65, 65.41, 87.31]) {
      const osc = audio.createOscillator();
      osc.type = "sine";
      osc.frequency.value = frequency;
      osc.connect(audioFilter);
      osc.start();
    }
  }

  if (audio.state === "suspended") await audio.resume();
  audioOn = !audioOn;
  audioGain?.gain.setTargetAtTime(audioOn ? 0.08 : 0, audio.currentTime, 0.35);
  sound.textContent = audioOn ? "SOUND ON" : "ENABLE SOUND";
  sound.setAttribute("aria-pressed", String(audioOn));
});

again.addEventListener("click", () => {
  endScreen.hidden = true;
  if (fresh()) {
    begin();
  } else {
    complete = false;
    autoStartAt = 0;
    pairScreen.hidden = false;
    pairStatus.textContent = "PHONE SIGNAL LOST · RESCAN TO RE-ENTER";
    pairStatus.classList.add("is-error");
  }
});

const updateStillness = (now: number) => {
  if (!running || !fresh(now) || !remote) {
    confirmedStill = false;
    stillCandidateAt = 0;
    return;
  }

  const candidate =
    remote.connected &&
    remote.confidence01 >= 0.28 &&
    remote.phase === 0 &&
    remote.flow01 <= 0.14;

  if (candidate) {
    if (!stillCandidateAt) stillCandidateAt = now;
    confirmedStill = now - stillCandidateAt >= 650;
  } else {
    confirmedStill = false;
    stillCandidateAt = 0;
  }
};

const updateHud = (now: number) => {
  if (!running) return;

  const p = progress();
  const pct = Math.round(p * 100);
  progressFill.style.width = `${pct}%`;
  progressTrack.setAttribute("aria-valuenow", String(pct));
  sessionTime.textContent = `${formatTime(sessionMs)} SESSION`;
  stillTime.textContent = `${formatTime(stillMs)} STILL`;
  journeyPct.textContent = `${pct}% TOWARD THE LIGHT`;
  stateLabel.classList.remove("is-still", "is-lost");

  if (!fresh(now)) {
    stateLabel.classList.add("is-lost");
    stateLabel.textContent = "BODY SIGNAL LOST";
    stateCopy.textContent = "PHONE ON BELLY · SCREEN UP · KEEP BREATHING";
    return;
  }

  if (confirmedStill) {
    stateLabel.classList.add("is-still");
    stateLabel.textContent = "THE LIGHT HAS NOTICED YOU";
    stateCopy.textContent = milestone(p);
    return;
  }

  stateLabel.textContent = "RESPIRATION DETECTED";
  stateCopy.textContent =
    stillMs > 0
      ? "GOOD DECISION · BREATHE WHENEVER YOU NEED · PROGRESS IS CUMULATIVE"
      : "GOOD · STAY ALIVE · STILLNESS WILL START THE CROSSING";
};

const render = (now: number, dt: number) => {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const p = progress();
  const cx = width * (0.5 + Math.sin(now * 0.00008) * 0.012);
  const cy = height * (0.5 + Math.cos(now * 0.00007) * 0.016);
  const maxR = Math.hypot(width, height) * 0.62;

  const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
  bg.addColorStop(0, "rgba(11,17,13,1)");
  bg.addColorStop(0.36, "rgba(5,8,6,1)");
  bg.addColorStop(1, "rgba(1,2,1,1)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  scroll += dt * (0.18 + p * 0.35 + (confirmedStill ? 0.3 : 0));

  for (let i = 0; i < 26; i++) {
    const z = ((i / 26 + scroll * 0.075) % 1 + 1) % 1;
    const radius = 20 + maxR * Math.pow(z, 1.7);
    const alpha = 0.025 + z * 0.11 + p * 0.06;

    ctx.beginPath();
    for (let k = 0; k <= 36; k++) {
      const a = (k / 36) * Math.PI * 2;
      const wobble =
        1 +
        Math.sin(a * 3 + now * 0.00024 + i * 0.7) * 0.025 * (1 - z) +
        Math.sin(a * 7 - now * 0.00015) * 0.012;
      const x = cx + Math.cos(a) * radius * wobble;
      const y = cy + Math.sin(a) * radius * 0.72 * wobble;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(188,227,201,${alpha})`;
    ctx.lineWidth = clamp(radius * 0.0035, 0.45, 2.2);
    ctx.stroke();
  }

  ctx.strokeStyle = `rgba(188,227,201,${0.035 + p * 0.04})`;
  ctx.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + now * 0.000015;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 26, cy + Math.sin(a) * 26 * 0.72);
    ctx.lineTo(cx + Math.cos(a) * maxR, cy + Math.sin(a) * maxR * 0.72);
    ctx.stroke();
  }

  const lightR =
    13 + Math.pow(smoothstep(p), 1.3) * Math.min(width, height) * 0.26;
  const haloR = lightR * (4.3 + p * 2);
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
  halo.addColorStop(0, `rgba(245,255,239,${0.82 + p * 0.18})`);
  halo.addColorStop(0.16, `rgba(214,242,221,${0.34 + p * 0.34})`);
  halo.addColorStop(0.52, `rgba(118,150,132,${0.08 + p * 0.15})`);
  halo.addColorStop(1, "rgba(2,3,2,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(cx - haloR, cy - haloR, haloR * 2, haloR * 2);

  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, lightR);
  core.addColorStop(0, "rgba(255,255,247,1)");
  core.addColorStop(0.5, "rgba(239,255,240,.92)");
  core.addColorStop(1, "rgba(188,227,201,0)");
  ctx.fillStyle = core;
  ctx.fillRect(cx - lightR, cy - lightR, lightR * 2, lightR * 2);

  const vignette = ctx.createRadialGradient(
    cx,
    cy,
    Math.min(width, height) * 0.18,
    cx,
    cy,
    maxR,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, `rgba(0,0,0,${0.78 - p * 0.24})`);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
};

const frame = (now: number) => {
  const dt = clamp((now - lastFrame) / 1000, 0.001, 0.05);
  lastFrame = now;

  if (!running && !complete && autoStartAt && now >= autoStartAt && fresh(now)) {
    autoStartAt = 0;
    begin();
  }

  updateStillness(now);

  if (running) {
    sessionMs = now - startedAt;
    if (confirmedStill) {
      stillMs = Math.min(TOTAL_STILL_MS, stillMs + dt * 1000);
    }
    if (stillMs >= TOTAL_STILL_MS) finish();

    if (audioOn && audio && audioFilter) {
      audioFilter.frequency.setTargetAtTime(
        180 + progress() * 1150 + (confirmedStill ? 140 : 0),
        audio.currentTime,
        0.8,
      );
    }
    updateHud(now);
  }

  render(now, dt);
  requestAnimationFrame(frame);
};

requestAnimationFrame((now) => {
  lastFrame = now;
  frame(now);
});

addEventListener("pagehide", () => {
  void link.stop({ emitStatus: false });
});
