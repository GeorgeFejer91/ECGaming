import { queueJump } from './input.js';

const CHANNEL = 'ecgaming-heartbeat-v1';
const MAX_BEAT_AGE_MS = 250;
const MAX_TRANSPORT_AGE_MS = 500;
const status = document.getElementById('ecgStatus');
const detail = document.getElementById('ecgDetail');
const dot = document.getElementById('ecgDot');
let lastBeatKey = '';
let received = 0;
let statusTimer;

function setState(label, copy, live = false, simulated = false) {
  status.textContent = label;
  detail.textContent = copy;
  dot.classList.toggle('is-live', live);
  dot.classList.toggle('is-simulated', simulated);
}

function validHeartbeat(message) {
  if (!message || typeof message !== 'object') return false;
  const transportAge = Date.now() - Number(message.sentAtEpochMs);
  return message.kind === 'ecgaming-heartbeat' &&
    message.version === 1 &&
    message.ready === true &&
    Number.isFinite(message.beatCounter) &&
    Number.isFinite(message.ageMs) &&
    message.ageMs >= 0 &&
    message.ageMs <= MAX_BEAT_AGE_MS &&
    transportAge >= 0 &&
    transportAge <= MAX_TRANSPORT_AGE_MS;
}

if (typeof BroadcastChannel === 'undefined') {
  setState('ECG LINK UNAVAILABLE', 'This browser does not support same-origin game channels.');
} else {
  const channel = new BroadcastChannel(CHANNEL);
  channel.addEventListener('message', (event) => {
    const beat = event.data;
    if (!validHeartbeat(beat)) return;
    const key = `${beat.route}:${beat.beatCounter}`;
    if (key === lastBeatKey) return;
    lastBeatKey = key;
    received += 1;
    queueJump();
    const simulated = beat.simulated === true;
    setState(
      simulated ? 'SIMULATED BEAT → JUMP' : 'POLAR BEAT → JUMP',
      `${beat.source.toUpperCase()} · beat ${beat.beatCounter} · ${Math.round(beat.ageMs)} ms · ${received} received`,
      true,
      simulated,
    );
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      setState('ECG LINK READY', 'Waiting for the next fresh R-peak.', true, simulated);
    }, 320);
  });
  addEventListener('beforeunload', () => channel.close(), { once: true });
}

