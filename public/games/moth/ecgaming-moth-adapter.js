const HEART_CHANNEL = "ecgaming-heartbeat-v1";
const DIVE_CHANNEL = "ecgaming-breathing-v1";
const MAX_HEARTBEAT_AGE_MS = 250;
const MAX_TRANSPORT_AGE_MS = 500;
const DIVE_STALE_MS = 600;
let lastBeatKey = "";
let diveActive = false;
let lastDiveAt = -Infinity;
let idleTimer;

const bar = document.createElement("aside");
bar.id = "ecgaming-heartbeat-bar";
bar.innerHTML = `
  <a href="../../">← ECGAMES</a>
  <span id="ecgaming-heartbeat-dot"></span>
  <strong id="ecgaming-heartbeat-state">WAITING FOR ECGAMES SIGNALS</strong>
  <small id="ecgaming-heartbeat-detail">R-peak jumps · inhale crest + hold arms swimming.</small>
  <b id="ecgaming-dive-state">DIVE LOCKED</b>
  <a href="../../ground-control/" target="_blank" rel="noopener">GROUND CONTROL ↗</a>
  <a href="https://github.com/ahmedallam222/moth-game" target="_blank" rel="noopener">SOURCE ↗</a>`;
document.body.append(bar);

const style = document.createElement("style");
style.textContent = `
  #ecgaming-heartbeat-bar{position:fixed;z-index:10000;left:10px;right:10px;top:10px;display:grid;grid-template-columns:auto auto minmax(175px,1fr) minmax(180px,auto) auto auto auto;align-items:center;gap:10px;padding:9px 12px;color:#eee9d3;border:1px solid #57594e;background:rgba(5,5,5,.9);font:700 11px/1.2 monospace;letter-spacing:.04em;direction:ltr}
  #ecgaming-heartbeat-bar a{color:#e9dc99;text-decoration:none}#ecgaming-heartbeat-bar small{color:#aaa997}#ecgaming-dive-state{color:#b7b6a8}#ecgaming-dive-state.active{color:#78d9a1;text-shadow:0 0 12px #78d9a1}
  #ecgaming-heartbeat-dot{width:9px;height:9px;border-radius:50%;background:#68685f}#ecgaming-heartbeat-dot.live{background:#78d9a1;box-shadow:0 0 12px #78d9a1}#ecgaming-heartbeat-dot.sim{background:#e0b85b;box-shadow:0 0 12px #e0b85b}
  @media(max-width:880px){#ecgaming-heartbeat-bar{grid-template-columns:auto auto 1fr auto auto}#ecgaming-heartbeat-bar small,#ecgaming-heartbeat-bar a:last-child{display:none}}
`;
document.head.append(style);

const state = document.getElementById("ecgaming-heartbeat-state");
const detail = document.getElementById("ecgaming-heartbeat-detail");
const dot = document.getElementById("ecgaming-heartbeat-dot");
const diveState = document.getElementById("ecgaming-dive-state");

function freshEnvelope(message) {
  if (!message || typeof message !== "object") return false;
  const transit = Date.now() - Number(message.sentAtEpochMs);
  return transit >= 0 && transit <= MAX_TRANSPORT_AGE_MS;
}

function validHeartbeat(message) {
  return (
    freshEnvelope(message) &&
    message.kind === "ecgaming-heartbeat" &&
    message.version === 1 &&
    message.ready === true &&
    Number.isFinite(message.beatCounter) &&
    Number.isFinite(message.ageMs) &&
    message.ageMs >= 0 &&
    message.ageMs <= MAX_HEARTBEAT_AGE_MS
  );
}

function validDive(message) {
  return (
    freshEnvelope(message) &&
    message.kind === "ecgaming-dive-intent" &&
    message.version === 1 &&
    ["ground-control", "mobile-direct"].includes(message.route) &&
    typeof message.active === "boolean" &&
    Number.isFinite(message.signalAgeMs) &&
    message.signalAgeMs >= 0 &&
    message.signalAgeMs <= 500 &&
    message.physicalPolar === true &&
    message.simulated === false
  );
}

function dispatchDive(active, message) {
  diveActive = active;
  window.dispatchEvent(
    new CustomEvent("ecgaming:moth-dive-state", {
      detail: { active, state: message?.state ?? "unavailable" },
    }),
  );
}

function showDive(message) {
  const volume = Number.isFinite(message.volume01)
    ? `${Math.round(message.volume01 * 100)}%`
    : "--";
  const progress = Math.round(Number(message.holdProgress01 || 0) * 100);
  if (message.active) {
    diveState.textContent = `DIVE ARMED · ${volume}`;
    diveState.className = "active";
  } else if (message.state === "hold") {
    diveState.textContent = `HOLD CREST · ${progress}%`;
    diveState.className = "";
  } else if (message.state === "recovery") {
    diveState.textContent = "RECOVER · BREATHE NORMALLY";
    diveState.className = "";
  } else if (message.state === "inhale") {
    diveState.textContent = `INHALE TO CREST · ${volume}`;
    diveState.className = "";
  } else {
    diveState.textContent = "DIVE LOCKED · PHYSICAL ACC REQUIRED";
    diveState.className = "";
  }
}

function pulse(message) {
  window.focus();
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

function showHeartbeat(message) {
  const simulated = message.simulated === true;
  state.textContent = simulated
    ? "SIMULATED BEAT → LAND JUMP"
    : "POLAR BEAT → MOVE";
  detail.textContent = `${String(message.source).toUpperCase()} · beat ${message.beatCounter} · ${Math.round(message.ageMs)} ms`;
  dot.className = simulated ? "sim" : "live";
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    state.textContent = "ECG LINK READY";
    detail.textContent = "Fresh R-peaks jump; swimming also requires DIVE ARMED.";
  }, 320);
}

if (typeof BroadcastChannel === "undefined") {
  state.textContent = "ECG LINK UNAVAILABLE";
} else {
  const heartChannel = new BroadcastChannel(HEART_CHANNEL);
  const diveChannel = new BroadcastChannel(DIVE_CHANNEL);
  heartChannel.addEventListener("message", ({ data }) => {
    if (!validHeartbeat(data)) return;
    const key = `${data.route}:${data.beatCounter}`;
    if (key === lastBeatKey) return;
    lastBeatKey = key;
    pulse(data);
    showHeartbeat(data);
  });
  diveChannel.addEventListener("message", ({ data }) => {
    if (!validDive(data)) return;
    lastDiveAt = performance.now();
    dispatchDive(data.active, data);
    showDive(data);
  });
  const staleTimer = setInterval(() => {
    if (diveActive && performance.now() - lastDiveAt > DIVE_STALE_MS) {
      dispatchDive(false);
      showDive({ state: "unavailable", active: false });
    }
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
