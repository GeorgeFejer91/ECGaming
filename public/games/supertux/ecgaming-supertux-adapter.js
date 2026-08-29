const CHANNEL = 'ecgaming-heartbeat-v1';
const MAX_BEAT_AGE_MS = 250;
const MAX_TRANSPORT_AGE_MS = 500;
let lastBeatKey = '';
let releaseTimer;
let idleTimer;

const bar = document.createElement('aside');
bar.id = 'ecgaming-heartbeat-bar';
bar.innerHTML = `
  <a href="../../">← ECGAMES</a>
  <span id="ecgaming-heartbeat-dot"></span>
  <strong id="ecgaming-heartbeat-state">WAITING FOR ECGAMES HEARTBEATS</strong>
  <small id="ecgaming-heartbeat-detail">Keyboard controls remain available.</small>
  <a href="../../ground-control/" target="_blank" rel="noopener">GROUND CONTROL ↗</a>
  <a href="https://github.com/SuperTux/supertux" target="_blank" rel="noopener">SOURCE ↗</a>`;
document.body.append(bar);

const style = document.createElement('style');
style.textContent = `
  #ecgaming-heartbeat-bar{position:fixed;z-index:100;left:10px;right:10px;top:10px;display:grid;grid-template-columns:auto auto minmax(190px,1fr) auto auto auto;align-items:center;gap:10px;padding:9px 12px;color:#d9ecf0;border:1px solid #426071;background:rgba(7,19,31,.9);font:700 11px/1.2 monospace;letter-spacing:.04em}
  #ecgaming-heartbeat-bar a{color:#f4b33a;text-decoration:none}#ecgaming-heartbeat-bar small{color:#8ca3ad}
  #ecgaming-heartbeat-dot{width:9px;height:9px;border-radius:50%;background:#60717a}#ecgaming-heartbeat-dot.live{background:#6fdb9b;box-shadow:0 0 12px #6fdb9b}#ecgaming-heartbeat-dot.sim{background:#f4b33a;box-shadow:0 0 12px #f4b33a}
  @media(max-width:760px){#ecgaming-heartbeat-bar{grid-template-columns:auto auto 1fr auto}#ecgaming-heartbeat-bar small,#ecgaming-heartbeat-bar a:last-child{display:none}}
`;
document.head.append(style);

const state = document.getElementById('ecgaming-heartbeat-state');
const detail = document.getElementById('ecgaming-heartbeat-detail');
const dot = document.getElementById('ecgaming-heartbeat-dot');

function valid(message) {
  if (!message || typeof message !== 'object') return false;
  const transit = Date.now() - Number(message.sentAtEpochMs);
  return message.kind === 'ecgaming-heartbeat' &&
    message.version === 1 && message.ready === true &&
    Number.isFinite(message.beatCounter) &&
    Number.isFinite(message.ageMs) && message.ageMs >= 0 &&
    message.ageMs <= MAX_BEAT_AGE_MS && transit >= 0 &&
    transit <= MAX_TRANSPORT_AGE_MS;
}

function setStatus(message, simulated) {
  state.textContent = simulated ? 'SIMULATED BEAT → JUMP' : 'POLAR BEAT → JUMP';
  detail.textContent = `${message.source.toUpperCase()} · beat ${message.beatCounter} · ${Math.round(message.ageMs)} ms`;
  dot.className = simulated ? 'sim' : 'live';
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    state.textContent = 'ECG LINK READY';
    detail.textContent = 'Waiting for the next fresh R-peak.';
  }, 320);
}

function jump() {
  const canvas = document.getElementById('canvas');
  canvas?.focus();
  clearTimeout(releaseTimer);
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true,
  }));
  releaseTimer = setTimeout(() => {
    window.dispatchEvent(new KeyboardEvent('keyup', {
      key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true,
    }));
  }, 110);
}

if (typeof BroadcastChannel === 'undefined') {
  state.textContent = 'ECG LINK UNAVAILABLE';
} else {
  const channel = new BroadcastChannel(CHANNEL);
  channel.addEventListener('message', ({ data }) => {
    if (!valid(data)) return;
    const key = `${data.route}:${data.beatCounter}`;
    if (key === lastBeatKey) return;
    lastBeatKey = key;
    jump();
    setStatus(data, data.simulated === true);
  });
  addEventListener('beforeunload', () => channel.close(), { once: true });
}
