import { CausalRPeakDetector } from "../signals/rpeak";
// Reused under the Affect Tracker repository's BSD-3-Clause license.
import {
  PolarH10BrowserSession,
  polarWebBluetoothSupport,
} from "../vendor/affect-tracker/polar-stream.js";

const HEART_CHANNEL = "ecgaming-heartbeat-v1";
const DIVE_CHANNEL = "ecgaming-breathing-v1";
const MAX_HEARTBEAT_AGE_MS = 250;
const MAX_TRANSPORT_AGE_MS = 500;
const DIVE_STALE_MS = 600;
const SAMPLE_RATE_HZ = 130;
const ECG_PREVIEW_SAMPLES = SAMPLE_RATE_HZ * 2;

type PolarEvent = {
  kind?: string;
  message?: string;
  connected?: boolean;
  microvolts?: number[];
  sensorTimestampNs?: string;
  beatsPerMinute?: number;
  rrIntervalsMs?: number[];
  streamHealth?: { observedSampleRateHz?: number; sampleCount?: number };
};

type HeartbeatEnvelope = {
  kind?: string;
  version?: number;
  route?: string;
  source?: string;
  beatCounter?: number;
  ageMs?: number;
  confidence?: number;
  physicalPolar?: boolean;
  simulated?: boolean;
  ready?: boolean;
  sentAtEpochMs?: number;
};

type DiveEnvelope = {
  kind?: string;
  version?: number;
  route?: string;
  active?: boolean;
  signalAgeMs?: number;
  physicalPolar?: boolean;
  simulated?: boolean;
  sentAtEpochMs?: number;
  volume01?: number;
  holdProgress01?: number;
  state?: string;
};

const session = new PolarH10BrowserSession();
const detector = new CausalRPeakDetector(SAMPLE_RATE_HZ);
const ecgSamples: number[] = [];

let directConnected = false;
let ecgReady = false;
let connecting = false;
let panelOpen = false;
let beatCounter = 0;
let beatsPerMinute: number | undefined;
let observedRate = 0;
let lastBeatKey = "";
let lastBeatAt = -Infinity;
let relayActive = false;
let statusTitle = "the sensor sleeps";
let statusDetail = "Connect a worn Polar H10 to let each detected R-peak request a jump.";
let diveActive = false;
let lastDiveAt = -Infinity;
let idleTimer: number | undefined;
let titleObserver: MutationObserver | undefined;

const host = document.createElement("div");
host.id = "ecgaming-heart-link-host";
host.innerHTML = `
  <button class="heart-link-orb" type="button" aria-label="Open ECG heart link" aria-expanded="false">
    <i></i><span>heart link</span><b>sleeping</b>
  </button>
  <aside class="heart-link-veil" aria-hidden="true">
    <section class="heart-link-panel" role="dialog" aria-modal="true" aria-labelledby="heart-link-title">
      <button class="heart-link-close" type="button" aria-label="Close heart link">×</button>
      <div class="heart-link-eyes" aria-hidden="true"><i></i><i></i></div>
      <p class="heart-link-kicker">E C G A M E S &nbsp; // &nbsp; C A R D I A C &nbsp; I N P U T</p>
      <h2 id="heart-link-title">H E A R T &nbsp; L I N K</h2>
      <p class="heart-link-sub">drawn by the rhythm</p>
      <div class="heart-link-signal">
        <canvas class="heart-link-wave" width="640" height="112" aria-label="Live Polar ECG preview"></canvas>
        <div class="heart-link-sigil" aria-hidden="true"><i></i></div>
      </div>
      <div class="heart-link-state" role="status" aria-live="polite">
        <strong>the sensor sleeps</strong>
        <span>Connect a worn Polar H10 to let each detected R-peak request a jump.</span>
      </div>
      <dl class="heart-link-metrics">
        <div><dt>heart</dt><dd data-heart>-- bpm</dd></div>
        <div><dt>signal</dt><dd data-rate>-- Hz</dd></div>
        <div><dt>peaks</dt><dd data-beats>0</dd></div>
        <div><dt>dive</dt><dd data-dive>locked</dd></div>
      </dl>
      <div class="heart-link-actions">
        <button class="heart-link-button heart-link-connect" type="button">connect polar h10</button>
        <button class="heart-link-button heart-link-disconnect" type="button" hidden>sever the link</button>
        <button class="heart-link-button heart-link-test" type="button">test pulse <small>simulated</small></button>
      </div>
      <p class="heart-link-note">Raw ECG stays in this browser tab. A detected R-peak uses MOTH's ordinary jump / swim-paddle input. This is experimental game control, not a medical measurement.</p>
      <footer>
        <a href="../../">← ecgames</a>
        <a href="../../ground-control/" target="_blank" rel="noopener">ground control relay ↗</a>
        <a href="https://github.com/ahmedallam222/moth-game" target="_blank" rel="noopener">original source ↗</a>
        <a href="https://github.com/GeorgeFejer91/moth-game" target="_blank" rel="noopener">ecgames fork ↗</a>
      </footer>
    </section>
  </aside>`;
document.body.append(host);

const style = document.createElement("style");
style.textContent = `
  #ecgaming-heart-link-host{--hl-bone:#d8d8d3;--hl-dim:#797975;--hl-faint:rgba(255,255,255,.09);position:relative;z-index:10000;font-family:'Cormorant Garamond',Georgia,serif;color:var(--hl-bone);direction:ltr}
  .heart-link-orb{position:fixed;z-index:10001;left:max(18px,env(safe-area-inset-left));top:max(16px,env(safe-area-inset-top));display:flex;align-items:center;gap:8px;min-height:34px;padding:7px 11px;border:1px solid rgba(255,255,255,.11);border-radius:2px;background:rgba(7,7,7,.66);backdrop-filter:blur(8px);color:#aaa9a3;font:11px/1 Georgia,serif;letter-spacing:.16em;text-transform:lowercase;cursor:pointer;transition:.3s ease}
  .heart-link-orb:hover,.heart-link-orb:focus-visible{border-color:rgba(255,255,255,.3);color:#ecece7}
  .heart-link-orb>i{width:6px;height:6px;border-radius:50%;background:#62625e;box-shadow:0 0 0 1px rgba(255,255,255,.05)}
  .heart-link-orb>b{font-weight:400;color:#63635f}.heart-link-orb.live>i{background:#e6e6df;box-shadow:0 0 12px 3px rgba(255,255,255,.6)}.heart-link-orb.live>b{color:#c9c9c3}.heart-link-orb.beat>i{animation:heartLinkBeat .38s ease-out}.heart-link-orb.relay>i{background:#b8b09b;box-shadow:0 0 10px rgba(226,213,173,.45)}
  @keyframes heartLinkBeat{0%{transform:scale(2.4);box-shadow:0 0 24px 8px rgba(255,255,255,.85)}100%{transform:scale(1)}}
  .heart-link-veil{position:fixed;z-index:10002;inset:0;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 50% 42%,rgba(30,30,29,.76),rgba(2,2,2,.94) 68%);opacity:0;visibility:hidden;transition:opacity .45s ease,visibility .45s;overflow:auto}
  .heart-link-veil::before{content:'';position:fixed;inset:-80px;pointer-events:none;opacity:.035;background-image:repeating-conic-gradient(#fff 0 .6deg,#000 .6deg 1.9deg);background-size:7px 7px;animation:heartLinkGrain .7s steps(3) infinite}
  @keyframes heartLinkGrain{33%{transform:translate(-24px,14px)}66%{transform:translate(18px,-20px)}}
  .heart-link-veil.open{opacity:1;visibility:visible}.heart-link-panel{position:relative;width:min(720px,calc(100vw - 38px));padding:36px 42px 28px;border:1px solid rgba(255,255,255,.13);border-radius:3px;background:linear-gradient(145deg,rgba(31,31,30,.94),rgba(7,7,7,.96));box-shadow:0 34px 100px #000,inset 0 0 80px rgba(255,255,255,.018);text-align:center}
  .heart-link-panel::after{content:'';position:absolute;inset:7px;pointer-events:none;border:1px solid rgba(255,255,255,.035)}
  .heart-link-close{position:absolute;z-index:2;right:17px;top:12px;border:0;background:none;color:#777;font:300 24px/1 Georgia,serif;cursor:pointer}.heart-link-close:hover{color:#eee}
  .heart-link-eyes{display:flex;justify-content:center;gap:12px;height:12px;margin-bottom:9px}.heart-link-eyes i{width:5px;height:5px;border-radius:50%;background:#f5f5ef;box-shadow:0 0 13px 2px #fff}
  .heart-link-kicker{margin:0;color:#666662;font:9px/1.4 Arial,sans-serif;letter-spacing:.27em}.heart-link-panel h2{margin:8px 0 0;color:#e6e6e1;font-size:clamp(26px,4vw,39px);font-weight:300;letter-spacing:.25em}.heart-link-sub{margin:3px 0 20px;color:#70706d;font-size:13px;font-style:italic;letter-spacing:.38em}
  .heart-link-signal{position:relative;height:96px;border-block:1px solid rgba(255,255,255,.075);overflow:hidden;background:linear-gradient(90deg,transparent,rgba(255,255,255,.014),transparent)}
  .heart-link-signal::before{content:'';position:absolute;left:0;right:0;top:50%;height:1px;background:rgba(255,255,255,.045)}.heart-link-wave{position:absolute;inset:0;width:100%;height:100%}.heart-link-sigil{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;opacity:.14}.heart-link-sigil i{width:8px;height:8px;border-radius:50%;background:#fff;box-shadow:0 0 34px 14px rgba(255,255,255,.22)}
  .heart-link-state{min-height:55px;padding:16px 10px 10px}.heart-link-state strong,.heart-link-state span{display:block}.heart-link-state strong{font-size:17px;font-weight:400;letter-spacing:.22em;color:#d2d2cc}.heart-link-state span{margin-top:7px;color:#777773;font:11px/1.45 Arial,sans-serif;letter-spacing:.045em}
  .heart-link-metrics{display:grid;grid-template-columns:repeat(4,1fr);margin:3px 0 20px;border-block:1px solid rgba(255,255,255,.07)}.heart-link-metrics>div{padding:12px 7px}.heart-link-metrics>div+div{border-left:1px solid rgba(255,255,255,.055)}.heart-link-metrics dt{color:#595956;font-size:10px;letter-spacing:.2em}.heart-link-metrics dd{margin:5px 0 0;color:#aaa9a4;font:12px/1 Arial,sans-serif;letter-spacing:.07em}
  .heart-link-actions{display:flex;justify-content:center;flex-wrap:wrap;gap:8px}.heart-link-button{min-width:172px;padding:11px 15px;border:1px solid rgba(255,255,255,.13);border-radius:2px;background:rgba(255,255,255,.025);color:#aaa9a4;font:13px/1 Georgia,serif;letter-spacing:.13em;cursor:pointer;transition:.25s ease}.heart-link-button:hover:not(:disabled){color:#f0f0ea;border-color:rgba(255,255,255,.35);background:rgba(255,255,255,.055)}.heart-link-button:disabled{opacity:.35;cursor:wait}.heart-link-button small{display:block;margin-top:4px;color:#666;font:8px Arial,sans-serif;letter-spacing:.15em}
  .heart-link-note{max-width:590px;margin:17px auto 0;color:#5f5f5c;font:9px/1.55 Arial,sans-serif;letter-spacing:.055em}.heart-link-panel footer{position:relative;z-index:2;display:flex;justify-content:center;flex-wrap:wrap;gap:8px 18px;margin-top:18px}.heart-link-panel footer a{color:#77736a;font-size:10px;letter-spacing:.09em;text-decoration:none}.heart-link-panel footer a:hover{color:#d8d1be}
  .ecgaming-heart-menu-button{color:#aaa9a4!important}.ecgaming-heart-menu-button::before{content:'◇';margin-right:10px;color:#5f5f5b}.ecgaming-heart-menu-button.live::before{content:'◆';color:#dcdcd6;text-shadow:0 0 12px #fff}.ecgaming-heart-menu-note{margin:0;color:#5d5d59;font:9px/1.4 Arial,sans-serif;letter-spacing:.1em}
  body:has(.title-screen .game-title) .heart-link-orb{opacity:0;pointer-events:none;transform:translateY(-8px)}
  @media(max-width:620px){.heart-link-panel{padding:31px 20px 22px}.heart-link-metrics{grid-template-columns:repeat(2,1fr)}.heart-link-metrics>div:nth-child(3){border-left:0;border-top:1px solid rgba(255,255,255,.055)}.heart-link-metrics>div:nth-child(4){border-top:1px solid rgba(255,255,255,.055)}.heart-link-button{width:100%}.heart-link-panel h2{letter-spacing:.17em}.heart-link-sub{letter-spacing:.22em}}
  @media(max-height:700px) and (orientation:landscape){.heart-link-veil{place-items:start center;padding:12px}.heart-link-panel{padding:20px 34px 17px}.heart-link-eyes,.heart-link-sub{margin-bottom:6px}.heart-link-signal{height:58px}.heart-link-state{padding:8px;min-height:42px}.heart-link-metrics{margin-bottom:9px}.heart-link-metrics>div{padding:7px}.heart-link-note{margin-top:8px}.heart-link-panel footer{margin-top:8px}}
  @media(prefers-reduced-motion:reduce){.heart-link-veil,.heart-link-orb{transition:none}.heart-link-veil::before{animation:none}}
`;
document.head.append(style);

const orb = host.querySelector<HTMLButtonElement>(".heart-link-orb")!;
const orbLabel = orb.querySelector<HTMLElement>("b")!;
const veil = host.querySelector<HTMLElement>(".heart-link-veil")!;
const closeButton = host.querySelector<HTMLButtonElement>(".heart-link-close")!;
const connectButton = host.querySelector<HTMLButtonElement>(".heart-link-connect")!;
const disconnectButton = host.querySelector<HTMLButtonElement>(".heart-link-disconnect")!;
const testButton = host.querySelector<HTMLButtonElement>(".heart-link-test")!;
const stateTitle = host.querySelector<HTMLElement>(".heart-link-state strong")!;
const stateDetail = host.querySelector<HTMLElement>(".heart-link-state span")!;
const heartMetric = host.querySelector<HTMLElement>("[data-heart]")!;
const rateMetric = host.querySelector<HTMLElement>("[data-rate]")!;
const beatsMetric = host.querySelector<HTMLElement>("[data-beats]")!;
const diveMetric = host.querySelector<HTMLElement>("[data-dive]")!;
const wave = host.querySelector<HTMLCanvasElement>(".heart-link-wave")!;

function setStatus(title: string, detail: string) {
  statusTitle = title;
  statusDetail = detail;
  renderStatus();
}

function renderStatus() {
  const live = directConnected && ecgReady;
  stateTitle.textContent = statusTitle;
  stateDetail.textContent = statusDetail;
  heartMetric.textContent = beatsPerMinute ? `${Math.round(beatsPerMinute)} bpm` : "-- bpm";
  rateMetric.textContent = observedRate ? `${Math.round(observedRate)} Hz` : "-- Hz";
  beatsMetric.textContent = String(beatCounter);
  diveMetric.textContent = diveActive ? "armed" : "locked";
  orb.classList.toggle("live", live);
  orb.classList.toggle("relay", !directConnected && relayActive);
  orbLabel.textContent = live ? `${Math.round(observedRate || SAMPLE_RATE_HZ)} Hz` : relayActive ? "relay" : "sleeping";
  connectButton.hidden = directConnected;
  disconnectButton.hidden = !directConnected;
  connectButton.disabled = connecting;
  connectButton.textContent = connecting ? "finding the heart…" : "connect polar h10";
  document.querySelectorAll<HTMLElement>(".ecgaming-heart-menu-button").forEach((button) => {
    button.classList.toggle("live", live);
    button.textContent = live ? `heart link — ${Math.round(observedRate || SAMPLE_RATE_HZ)} hz` : relayActive ? "heart link — relay awake" : "link the heart";
  });
  document.querySelectorAll<HTMLElement>(".ecgaming-heart-menu-note").forEach((note) => {
    note.textContent = live ? "each detected R-peak requests a jump" : relayActive ? "ground control peaks are reaching this game" : "polar h10 · r-peak jump control";
  });
}

function drawEcg() {
  const context = wave.getContext("2d");
  if (!context) return;
  const width = wave.width;
  const height = wave.height;
  context.clearRect(0, 0, width, height);
  if (ecgSamples.length < 2) return;
  const mean = ecgSamples.reduce((sum, sample) => sum + sample, 0) / ecgSamples.length;
  const scale = Math.max(100, ...ecgSamples.map((sample) => Math.abs(sample - mean)));
  context.beginPath();
  context.strokeStyle = "rgba(231,231,225,.78)";
  context.shadowColor = "rgba(255,255,255,.6)";
  context.shadowBlur = 5;
  context.lineWidth = 1.25;
  ecgSamples.forEach((sample, index) => {
    const x = (index / (ecgSamples.length - 1)) * width;
    const y = height / 2 - ((sample - mean) / scale) * height * 0.39;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  context.shadowBlur = 0;
}

function appendEcg(samples: number[]) {
  ecgSamples.push(...samples);
  if (ecgSamples.length > ECG_PREVIEW_SAMPLES)
    ecgSamples.splice(0, ecgSamples.length - ECG_PREVIEW_SAMPLES);
  drawEcg();
}

function openPanel() {
  panelOpen = true;
  veil.classList.add("open");
  veil.setAttribute("aria-hidden", "false");
  orb.setAttribute("aria-expanded", "true");
  window.setTimeout(() => (directConnected ? disconnectButton : connectButton).focus(), 50);
}

function closePanel() {
  panelOpen = false;
  veil.classList.remove("open");
  veil.setAttribute("aria-hidden", "true");
  orb.setAttribute("aria-expanded", "false");
}

function pulse(message: { beatCounter?: number; source?: string }) {
  window.dispatchEvent(
    new CustomEvent("ecgaming:moth-pulse", {
      detail: {
        diveActive,
        beatCounter: message.beatCounter,
        source: message.source,
      },
    }),
  );
}

function showBeat(source: string, confidence: number, simulated = false, relayed = false) {
  lastBeatAt = performance.now();
  if (relayed) relayActive = true;
  orb.classList.remove("beat");
  void orb.offsetWidth;
  orb.classList.add("beat");
  clearTimeout(idleTimer);
  setStatus(
    simulated ? "a borrowed beat" : "the heart moves the moth",
    simulated
      ? "Simulated test pulse → jump request. No sensor signal was claimed."
      : `${source.toUpperCase()} · peak ${beatCounter} · ${Math.round(confidence * 100)}% detector confidence → jump request`,
  );
  idleTimer = window.setTimeout(() => {
    if (directConnected && ecgReady)
      setStatus("the link is awake", "Live 130 Hz ECG is local to this tab; the next detected R-peak requests a jump.");
    else if (relayActive)
      setStatus("a distant heart is heard", "Fresh R-peaks are arriving from ECGames Ground Control.");
  }, 900);
}

function registerDirectBeat(confidence: number) {
  if (!directConnected || !ecgReady || !detector.ready) return;
  beatCounter = (beatCounter + 1) >>> 0;
  pulse({ beatCounter, source: "ecg-rpeak" });
  showBeat("ecg-rpeak", confidence);
}

function handlePolarEvent(event: PolarEvent) {
  if (event.kind === "status") setStatus("seeking the heart", event.message ?? "Preparing the Polar ECG stream…");
  if (event.kind === "connection") {
    directConnected = event.connected === true;
    connecting = false;
    if (!directConnected) {
      ecgReady = false;
      observedRate = 0;
      setStatus("the link has faded", event.message ?? "Polar H10 disconnected.");
    } else {
      setStatus("warming the signal", "Polar H10 is connected; learning the ECG baseline before accepting R-peaks.");
    }
  }
  if (event.kind === "heart-rate") {
    if (Number.isFinite(event.beatsPerMinute)) beatsPerMinute = event.beatsPerMinute;
    for (const rr of event.rrIntervalsMs ?? []) detector.setReferenceRr(rr);
  }
  if (event.kind === "ecg") {
    observedRate = Number(event.streamHealth?.observedSampleRateHz ?? SAMPLE_RATE_HZ);
    const samples = Array.from(event.microvolts ?? [], Number).filter(Number.isFinite);
    appendEcg(samples);
    ecgReady = samples.length > 0 && observedRate >= 110 && observedRate <= 150;
    const beats = detector.pushFrame(samples, event.sensorTimestampNs ?? String(BigInt(Date.now()) * 1_000_000n));
    for (const beat of beats) registerDirectBeat(beat.confidence);
    if (ecgReady && detector.ready && performance.now() - lastBeatAt > 900)
      setStatus("the link is awake", "Live 130 Hz ECG is local to this tab; the next detected R-peak requests a jump.");
  }
  if (event.kind === "warning") setStatus("the signal trembles", event.message ?? "A Polar signal needs attention.");
  if (event.kind === "error") setStatus("the signal was lost", event.message ?? "The Polar stream reported an error.");
  renderStatus();
}

async function connectPolar() {
  const support = polarWebBluetoothSupport();
  if (!support.supported) {
    setStatus("this path is closed", `${support.reason} Use Chrome or Edge over HTTPS, or open the Ground Control relay.`);
    return;
  }
  connecting = true;
  directConnected = false;
  ecgReady = false;
  observedRate = 0;
  beatsPerMinute = undefined;
  beatCounter = 0;
  relayActive = false;
  detector.reset();
  ecgSamples.length = 0;
  drawEcg();
  setStatus("opening the passage", "Choose the worn Polar H10 in the browser Bluetooth prompt.");
  try {
    await session.connect(handlePolarEvent);
  } catch (error) {
    connecting = false;
    setStatus("the heart was not found", error instanceof Error ? error.message : String(error));
  }
  renderStatus();
}

async function disconnectPolar() {
  await session.disconnect();
  directConnected = false;
  connecting = false;
  ecgReady = false;
  observedRate = 0;
  beatsPerMinute = undefined;
  detector.reset();
  ecgSamples.length = 0;
  drawEcg();
  setStatus("the sensor sleeps", "The direct Polar link is closed. Keyboard, touch, or Ground Control can still move the moth.");
}

function freshEnvelope(message: HeartbeatEnvelope | DiveEnvelope) {
  const sentAt = Number(message?.sentAtEpochMs);
  const transit = Date.now() - sentAt;
  return Number.isFinite(sentAt) && transit >= 0 && transit <= MAX_TRANSPORT_AGE_MS;
}

function validHeartbeat(message: HeartbeatEnvelope) {
  return (
    freshEnvelope(message) &&
    message.kind === "ecgaming-heartbeat" &&
    message.version === 1 &&
    message.ready === true &&
    Number.isFinite(message.beatCounter) &&
    Number.isFinite(message.ageMs) &&
    Number(message.ageMs) >= 0 &&
    Number(message.ageMs) <= MAX_HEARTBEAT_AGE_MS
  );
}

function validDive(message: DiveEnvelope) {
  return (
    freshEnvelope(message) &&
    message.kind === "ecgaming-dive-intent" &&
    message.version === 1 &&
    ["ground-control", "mobile-direct"].includes(String(message.route)) &&
    typeof message.active === "boolean" &&
    Number.isFinite(message.signalAgeMs) &&
    Number(message.signalAgeMs) >= 0 &&
    Number(message.signalAgeMs) <= 500 &&
    message.physicalPolar === true &&
    message.simulated === false
  );
}

function dispatchDive(active: boolean, message?: DiveEnvelope) {
  diveActive = active;
  window.dispatchEvent(
    new CustomEvent("ecgaming:moth-dive-state", {
      detail: { active, state: message?.state ?? "unavailable" },
    }),
  );
  renderStatus();
}

function installTitleMenuControl() {
  const title = document.querySelector(".title-screen .game-title");
  const menu = title?.parentElement?.querySelector(".menu");
  if (!menu || menu.querySelector(".ecgaming-heart-menu-button")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "menu-btn ecgaming-heart-menu-button";
  button.addEventListener("click", openPanel);
  const note = document.createElement("p");
  note.className = "ecgaming-heart-menu-note";
  menu.append(button, note);
  renderStatus();
}

orb.addEventListener("click", openPanel);
closeButton.addEventListener("click", closePanel);
veil.addEventListener("click", (event) => {
  if (event.target === veil) closePanel();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && panelOpen) closePanel();
});
connectButton.addEventListener("click", () => void connectPolar());
disconnectButton.addEventListener("click", () => void disconnectPolar());
testButton.addEventListener("click", () => {
  beatCounter = (beatCounter + 1) >>> 0;
  pulse({ beatCounter, source: "simulated-test" });
  showBeat("simulated-test", 1, true);
});

if (typeof BroadcastChannel !== "undefined") {
  const heartChannel = new BroadcastChannel(HEART_CHANNEL);
  const diveChannel = new BroadcastChannel(DIVE_CHANNEL);
  heartChannel.addEventListener("message", ({ data }: MessageEvent<HeartbeatEnvelope>) => {
    if (!validHeartbeat(data)) return;
    const key = `${data.route}:${data.beatCounter}`;
    if (key === lastBeatKey) return;
    lastBeatKey = key;
    beatCounter = Number(data.beatCounter) >>> 0;
    pulse(data);
    showBeat(String(data.source ?? "ecg-rpeak"), Number(data.confidence ?? 0), data.simulated === true, true);
  });
  diveChannel.addEventListener("message", ({ data }: MessageEvent<DiveEnvelope>) => {
    if (!validDive(data)) return;
    lastDiveAt = performance.now();
    dispatchDive(data.active === true, data);
  });
  const staleTimer = window.setInterval(() => {
    if (diveActive && performance.now() - lastDiveAt > DIVE_STALE_MS) dispatchDive(false);
  }, 200);
  addEventListener(
    "beforeunload",
    () => {
      clearInterval(staleTimer);
      heartChannel.close();
      diveChannel.close();
    },
    { once: true },
  );
}

titleObserver = new MutationObserver(installTitleMenuControl);
titleObserver.observe(document.body, { childList: true, subtree: true });
installTitleMenuControl();
renderStatus();

addEventListener(
  "beforeunload",
  () => {
    titleObserver?.disconnect();
    clearTimeout(idleTimer);
    void session.disconnect({ emit: false });
  },
  { once: true },
);
