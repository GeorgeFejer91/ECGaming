import "./styles.css";
import { FlightFlags, isFreshBeat } from "./protocol/flight-frame";
import { FlightReceiver } from "./protocol/remote";
import type { FlightReceiverSnapshot } from "./protocol/types";
import { createFlightScene } from "./game/flight-scene";
import { FlightSound } from "./game/sound";
import { SessionCsvLog } from "./logging/session-log";

const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const setText = (id: string, value: string) => {
  element(id).textContent = value;
};
const receiver = new FlightReceiver(),
  game = createFlightScene(element("game-canvas")),
  sound = new FlightSound(),
  log = new SessionCsvLog();
let started = false,
  muted = false,
  lastBeatCounter: number | undefined,
  countdownTimer: number | undefined,
  resumeCountdown = 0,
  lastLogAt = -Infinity,
  sourceSignature = "";

function renderSources(state: FlightReceiverSnapshot) {
  const nextSignature = state.sources
    .map((source) => `${source.streamId}:${source.uuid}`)
    .join("|");
  if (nextSignature === sourceSignature) return;
  sourceSignature = nextSignature;
  const host = element("source-list");
  host.replaceChildren();
  for (const source of state.sources) {
    const button = document.createElement("button");
    button.className = "source-button";
    button.type = "button";
    button.innerHTML = `<span>${source.label}</span><i>CONNECT →</i>`;
    button.addEventListener(
      "click",
      () => void receiver.selectSource(source.streamId),
    );
    host.append(button);
  }
}
function isReady(state: FlightReceiverSnapshot) {
  return Boolean(
    state.config &&
    state.latest &&
    (state.latest.flags & FlightFlags.controlReady) !== 0 &&
    (state.packetAgeMs ?? Infinity) < 2000,
  );
}
function updateConnection(state: FlightReceiverSnapshot, message?: string) {
  renderSources(state);
  const live = state.phase === "live" && isReady(state);
  element("link-dot").classList.toggle("is-live", live);
  const simulated = Boolean(
    (state.latest?.flags ?? 0) & FlightFlags.simulation,
  );
  setText(
    "link-state",
    live
      ? `${simulated ? "SIMULATED" : "GROUND"} LINK LIVE`
      : state.phase === "stale"
        ? "GROUND LINK LOST"
        : state.phase === "connecting"
          ? "CONNECTING TO TOWER"
          : "GROUND LINK OFFLINE",
  );
  setText("hud-route", state.route.toUpperCase());
  setText(
    "hud-latency",
    state.rttMs === undefined ? "— MS" : `${state.rttMs} MS`,
  );
  if (state.sourceLabel) setText("connection-title", state.sourceLabel);
  if (message) setText("connection-copy", message);
  const ready = isReady(state);
  if (ready && !started) {
    element("connection-panel").hidden = true;
    element("start-panel").hidden = false;
  } else if (!started) {
    element("connection-panel").hidden = false;
    element("start-panel").hidden = true;
  }
  if (state.phase === "stale" && started) pauseForSignal();
  if (state.phase === "live" && started && game.snapshot().paused)
    beginResumeCountdown();
}
function acceptFrame(state: FlightReceiverSnapshot) {
  const frame = state.latest;
  if (!frame) return;
  game.setControls(frame);
  const signal = (frame.altitude + 1) / 2;
  setText("hud-excitement", signal.toFixed(2));
  document.querySelector<HTMLElement>("#hud-bar b")!.style.width =
    `${Math.round(signal * 100)}%`;
  if (isFreshBeat(frame, lastBeatCounter)) {
    lastBeatCounter = frame.beatCounter;
    game.heartbeat();
    sound.beat();
    if (element<HTMLInputElement>("flight-log-enabled").checked)
      log.add({
        event: "beat",
        source_id: state.selectedStreamId,
        session_id: state.config?.sessionId ?? "",
        sequence: frame.sequence,
        beat_counter: frame.beatCounter,
        beat_age_ms: frame.beatAgeMs,
      });
  } else if (frame.beatCounter !== lastBeatCounter)
    lastBeatCounter = frame.beatCounter;
  const now = performance.now();
  if (
    element<HTMLInputElement>("flight-log-enabled").checked &&
    now - lastLogAt >= 100
  ) {
    lastLogAt = now;
    log.add({
      event: "command",
      source_id: state.selectedStreamId,
      session_id: state.config?.sessionId ?? "",
      sequence: frame.sequence,
      mode: game.snapshot().immersive ? "webxr" : "flat",
      route: state.route,
      rtt_ms: state.rttMs ?? "",
      altitude: frame.altitude,
      throttle: frame.throttle,
      traffic: frame.traffic,
      beat_counter: frame.beatCounter,
      beat_age_ms: frame.beatAgeMs,
      quality: frame.quality,
      flags: frame.flags,
      score: game.snapshot().score,
      lives: game.snapshot().lives,
    });
    element<HTMLButtonElement>("flight-log-export").disabled = log.size === 0;
  }
}
function pauseForSignal() {
  if (!started) return;
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = undefined;
  game.setPaused(true);
  element("pause-panel").hidden = false;
  setText("pause-copy", "Waiting for three fresh command frames…");
}
function beginResumeCountdown() {
  if (countdownTimer || !started) return;
  resumeCountdown = 3;
  element("pause-panel").hidden = false;
  setText("pause-copy", `Link recovered. Resuming in ${resumeCountdown}…`);
  countdownTimer = window.setInterval(() => {
    resumeCountdown -= 1;
    if (resumeCountdown <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = undefined;
      element("pause-panel").hidden = true;
      game.setPaused(false);
      return;
    }
    setText("pause-copy", `Link recovered. Resuming in ${resumeCountdown}…`);
  }, 1000);
}
async function findGround() {
  element<HTMLButtonElement>("find-ground").disabled = true;
  setText("connection-title", "Scanning the airwaves…");
  try {
    await receiver.startDiscovery();
  } catch (error) {
    setText("connection-title", "Could not open the data link");
    setText(
      "connection-copy",
      error instanceof Error ? error.message : String(error),
    );
    element<HTMLButtonElement>("find-ground").disabled = false;
  }
}
async function startFlight() {
  const state = receiver.snapshot();
  if (!isReady(state)) return;
  await sound.unlock();
  started = true;
  element("start-panel").hidden = true;
  element("connection-panel").hidden = true;
  element("game-over").hidden = true;
  game.restart();
  if (element<HTMLInputElement>("flight-log-enabled").checked)
    log.add({
      event: "start",
      source_id: state.selectedStreamId,
      session_id: state.config?.sessionId ?? "",
      mode: "flat",
      simulation: Boolean(state.latest!.flags & FlightFlags.simulation),
    });
}
function restart() {
  started = false;
  lastBeatCounter = undefined;
  const state = receiver.snapshot();
  element("game-over").hidden = true;
  if (isReady(state)) {
    started = true;
    game.restart();
  } else {
    element("connection-panel").hidden = false;
  }
}

receiver.addEventListener("statechange", ((event: CustomEvent) =>
  updateConnection(event.detail, event.detail.message)) as EventListener);
receiver.addEventListener("config", ((event: CustomEvent) =>
  updateConnection(
    event.detail,
    "Configuration received. Waiting for a fresh, ready command frame…",
  )) as EventListener);
receiver.addEventListener("frame", ((event: CustomEvent) => {
  updateConnection(event.detail);
  acceptFrame(event.detail);
}) as EventListener);
game.addEventListener("score", ((event: CustomEvent) => {
  const { score, lives, kind } = event.detail;
  setText("score", String(score).padStart(3, "0"));
  setText(
    "lives",
    Array.from({ length: 3 }, (_, index) => (index < lives ? "♥" : "·")).join(
      " ",
    ),
  );
  element("lives").setAttribute("aria-label", `${lives} lives`);
  if (kind === "pass") sound.ring(true);
  if (kind === "miss") sound.ring(false);
  if (element<HTMLInputElement>("flight-log-enabled").checked)
    log.add({
      event: kind,
      score,
      lives,
      mode: game.snapshot().immersive ? "webxr" : "flat",
    });
}) as EventListener);
game.addEventListener("gameover", ((event: CustomEvent) => {
  started = false;
  setText("final-score", String(event.detail.score));
  element("game-over").hidden = false;
  if (element<HTMLInputElement>("flight-log-enabled").checked)
    log.add({
      event: "game_over",
      score: event.detail.score,
      lives: 0,
      mode: event.detail.immersive ? "webxr" : "flat",
    });
}) as EventListener);

element("find-ground").addEventListener("click", () => void findGround());
element("start-flight").addEventListener("click", () => void startFlight());
element("restart-flight").addEventListener("click", restart);
element<HTMLButtonElement>("mute").addEventListener("click", (event) => {
  muted = !muted;
  sound.setMuted(muted);
  const button = event.currentTarget as HTMLButtonElement;
  button.textContent = muted ? "SOUND OFF" : "SOUND ON";
  button.setAttribute("aria-pressed", String(muted));
});
element("flight-log-export").addEventListener("click", () =>
  log.download("ecgaming-flight.csv"),
);
element<HTMLInputElement>("flight-log-enabled").addEventListener(
  "change",
  (event) => {
    if (!(event.target as HTMLInputElement).checked) {
      element<HTMLButtonElement>("flight-log-export").disabled = log.size === 0;
    }
  },
);
const xrButton = element<HTMLButtonElement>("enter-xr");
void game.immersiveSupported().then((supported) => {
  xrButton.hidden = !supported;
});
xrButton.addEventListener("click", async () => {
  try {
    await sound.unlock();
    await game.enterImmersive();
    xrButton.textContent = "IMMERSIVE ACTIVE";
    if (element<HTMLInputElement>("flight-log-enabled").checked)
      log.add({ event: "mode", mode: "webxr" });
  } catch (error) {
    xrButton.textContent = "WEBXR FAILED";
    console.error(error);
  }
});
addEventListener("beforeunload", () => {
  if (countdownTimer) clearInterval(countdownTimer);
  void receiver.stop();
  game.dispose();
});
