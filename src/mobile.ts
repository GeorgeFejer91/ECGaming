import "./styles.css";
import { createFlightScene } from "./game/flight-scene";
import {
  AIRCRAFT_CATALOG,
  DEFAULT_AIRCRAFT_ID,
  isAircraftId,
  type AircraftId,
} from "./game/aircraft";
import { FlightSound } from "./game/sound";
import { SessionCsvLog } from "./logging/session-log";
import { FlightFlags } from "./protocol/flight-frame";
import type { FlightFrame } from "./protocol/types";
import { AttackReleaseSmoother, commandValue } from "./signals/mappings";
import {
  buildMobileMappings,
  mobileReadiness,
  sanitizeMobileSettings,
} from "./signals/mobile-control";
import { CausalRPeakDetector } from "./signals/rpeak";
import { GameHeartbeatPublisher } from "./game/heartbeat-channel";
import { GameDivePublisher } from "./game/dive-intent-channel";
// Reused under the Affect Tracker repository's BSD-3-Clause license.
import {
  PolarH10BrowserSession,
  polarWebBluetoothSupport,
} from "./vendor/affect-tracker/polar-stream.js";

const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const setText = (id: string, value: string) => {
  element(id).textContent = value;
};
const clamp = (value: number, minimum = 0, maximum = 1) =>
  Math.max(minimum, Math.min(maximum, value));

const SETTINGS_KEY = "ecgaming-mobile-settings-v1";
const AIRCRAFT_KEY = "ecgaming-aircraft-v1";
const persistedAircraftId = localStorage.getItem(AIRCRAFT_KEY);
const session = new PolarH10BrowserSession();
const detector = new CausalRPeakDetector(130);
const gameHeartbeatPublisher = new GameHeartbeatPublisher("mobile-direct");
const gameDivePublisher = new GameDivePublisher("mobile-direct");
const game = createFlightScene(element("game-canvas"));
const sound = new FlightSound();
const log = new SessionCsvLog();
const metrics: Record<string, number> = {};
const ecgSamples: number[] = [];
const steeringPointers = new Map<
  number,
  { axis: -1 | 1; button: HTMLButtonElement }
>();
const smoothers = {
  altitude: new AttackReleaseSmoother(0),
  throttle: new AttackReleaseSmoother(0.5),
  traffic: new AttackReleaseSmoother(0.5),
};

let settings = sanitizeMobileSettings(
    JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null"),
  ),
  mappings = buildMobileMappings(settings),
  physicalConnected = false,
  ecgReady = false,
  breathingReady = false,
  simulated = false,
  started = false,
  signalHeld = false,
  currentReady = false,
  beatCounter = 0,
  lastBeatAt = -Infinity,
  lastFrameAt = performance.now(),
  lastLogAt = -Infinity,
  simNextBeat = performance.now(),
  sequence = 0,
  detectorConfidence = 0,
  ecgRate = 0,
  lastBreathingAt = -Infinity,
  excitementPairs = 0,
  stateOverride: string | undefined,
  wakeLock: { release?: () => Promise<void> } | undefined,
  resumeTimer: number | undefined,
  latestCommands = { altitude: 0, throttle: 0.5, traffic: 0.5 };
let selectedAircraftId: AircraftId =
  persistedAircraftId && isAircraftId(persistedAircraftId)
    ? persistedAircraftId
    : DEFAULT_AIRCRAFT_ID,
  aircraftReady: Promise<void> = Promise.resolve(),
  aircraftRequest = 0,
  rewardTimer: number | undefined;

function selectAircraft(rawId: string) {
  const id = isAircraftId(rawId) ? rawId : DEFAULT_AIRCRAFT_ID;
  const request = ++aircraftRequest;
  const select = element<HTMLSelectElement>("mobile-aircraft");
  select.disabled = true;
  setText("mobile-aircraft-status", "Loading aircraft…");
  aircraftReady = game
    .setAircraft(id)
    .then((actualId) => {
      if (request !== aircraftRequest) return;
      selectedAircraftId = actualId;
      select.value = actualId;
      localStorage.setItem(AIRCRAFT_KEY, actualId);
      setText("mobile-aircraft-status", "Propeller ready · sized for every ring");
    })
    .catch((error) => {
      if (request !== aircraftRequest) return;
      console.error(error);
      setText("mobile-aircraft-status", "Aircraft could not be loaded");
    })
    .finally(() => {
      if (request === aircraftRequest) select.disabled = false;
    });
  return aircraftReady;
}

function hydrateAircraftSelector() {
  const select = element<HTMLSelectElement>("mobile-aircraft");
  select.replaceChildren(
    ...AIRCRAFT_CATALOG.map(({ id, label }) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = label;
      return option;
    }),
  );
  select.value = selectedAircraftId;
  select.addEventListener("change", () => void selectAircraft(select.value));
  void selectAircraft(selectedAircraftId);
}

function updateSteering() {
  const latest = Array.from(steeringPointers.values()).at(-1);
  game.setSteering(latest?.axis ?? 0);
}

function releaseSteering(pointerId?: number) {
  if (pointerId === undefined) {
    for (const { button } of steeringPointers.values()) {
      button.classList.remove("is-held");
      button.setAttribute("aria-pressed", "false");
    }
    steeringPointers.clear();
  } else {
    const active = steeringPointers.get(pointerId);
    steeringPointers.delete(pointerId);
    if (
      active &&
      !Array.from(steeringPointers.values()).some(
        ({ button }) => button === active.button,
      )
    ) {
      active.button.classList.remove("is-held");
      active.button.setAttribute("aria-pressed", "false");
    }
  }
  updateSteering();
}

function bindSteeringButton(id: string, axis: -1 | 1) {
  const button = element<HTMLButtonElement>(id);
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    steeringPointers.set(event.pointerId, { axis, button });
    button.classList.add("is-held");
    button.setAttribute("aria-pressed", "true");
    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      /* Pointer capture is optional on older mobile browsers. */
    }
    updateSteering();
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    button.addEventListener(type, (event) =>
      releaseSteering((event as PointerEvent).pointerId),
    );
}

function celebrate(points: number, score: number) {
  const reward = element("mobile-reward");
  const scoreCard = element("mobile-score-card");
  const cheers = ["RING CLEARED!", "YAY!", "BEAUTIFUL!", "NICE FLYING!"];
  setText("mobile-reward-copy", cheers[score % cheers.length]);
  setText("mobile-reward-points", `+${Math.max(1, points)}`);
  if (rewardTimer) clearTimeout(rewardTimer);
  reward.hidden = false;
  reward.classList.remove("is-visible");
  scoreCard.classList.remove("is-rewarded");
  void reward.offsetWidth;
  reward.classList.add("is-visible");
  scoreCard.classList.add("is-rewarded");
  rewardTimer = window.setTimeout(() => {
    reward.classList.remove("is-visible");
    scoreCard.classList.remove("is-rewarded");
    reward.hidden = true;
    rewardTimer = undefined;
  }, 1_450);
}

function drawEcg() {
  const canvas = element<HTMLCanvasElement>("mobile-ecg"),
    context = canvas.getContext("2d")!;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (ecgSamples.length < 2) return;
  const mean =
      ecgSamples.reduce((sum, value) => sum + value, 0) / ecgSamples.length,
    peak = Math.max(100, ...ecgSamples.map((value) => Math.abs(value - mean)));
  context.strokeStyle = simulated ? "#f4b33a" : "#69d4de";
  context.lineWidth = 2;
  context.shadowColor = context.strokeStyle;
  context.shadowBlur = 5;
  context.beginPath();
  ecgSamples.forEach((value, index) => {
    const x = (index / (ecgSamples.length - 1)) * canvas.width,
      y = canvas.height / 2 - ((value - mean) / peak) * canvas.height * 0.42;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  context.shadowBlur = 0;
}

function appendEcg(samples: number[]) {
  ecgSamples.push(...samples);
  if (ecgSamples.length > 390) ecgSamples.splice(0, ecgSamples.length - 390);
  drawEcg();
}

function registerBeat(source: "ecg-rpeak" | "polar-rr", confidence: number) {
  if (mappings.beatSource !== source || mappings.beatAction === "off") return;
  beatCounter = (beatCounter + 1) >>> 0;
  lastBeatAt = performance.now();
  detectorConfidence = confidence;
  gameHeartbeatPublisher.publish({
    source,
    beatCounter,
    ageMs: 0,
    confidence,
    physicalPolar: physicalConnected,
    simulated,
    ready: simulated || (physicalConnected && ecgReady),
  });
  if (started && !signalHeld) {
    game.heartbeat();
    sound.beat();
  }
  if (element<HTMLInputElement>("mobile-log-enabled").checked)
    log.add({ event: "beat", source, beat_counter: beatCounter, confidence });
}

function showMetrics() {
  setText(
    "mobile-hr",
    Number.isFinite(metrics.heart_rate)
      ? Math.round(metrics.heart_rate).toString()
      : "--",
  );
  setText(
    "mobile-rr",
    Number.isFinite(metrics.rr_interval)
      ? Math.round(metrics.rr_interval).toString()
      : "--",
  );
  setText(
    "mobile-excitement",
    Number.isFinite(metrics.excitement_score)
      ? metrics.excitement_score.toFixed(2)
      : "--",
  );
  setText(
    "mobile-breathing",
    Number.isFinite(metrics.breathing_volume)
      ? metrics.breathing_volume.toFixed(2)
      : "--",
  );
  setText(
    "mobile-ecg-rate",
    simulated ? "SIM" : ecgRate ? ecgRate.toFixed(0) : "--",
  );
}

function handlePolarEvent(event: any) {
  if (event.kind === "status") {
    stateOverride = "POLAR CONNECTING";
    setText("mobile-support-copy", event.message ?? "Connecting…");
  }
  if (event.kind === "connection") {
    physicalConnected = event.connected === true;
    stateOverride = physicalConnected ? undefined : "POLAR OFFLINE";
    if (!physicalConnected) {
      ecgReady = false;
      breathingReady = false;
      lastBreathingAt = -Infinity;
      ecgRate = 0;
    }
    element<HTMLButtonElement>("mobile-connect").disabled = physicalConnected;
    element<HTMLButtonElement>("mobile-disconnect").disabled =
      !physicalConnected;
    setText("mobile-support-copy", event.message ?? "");
  }
  if (event.kind === "metrics") {
    Object.assign(metrics, event.snapshot?.values ?? {});
    if (event.snapshot?.breathing)
      breathingReady = event.snapshot.breathing.ready === true;
    excitementPairs = Number(event.snapshot?.readiness?.excitementPairs ?? 0);
    showMetrics();
  }
  if (event.kind === "heart-rate") {
    for (const rr of event.rrIntervalsMs ?? []) {
      detector.setReferenceRr(rr);
      registerBeat("polar-rr", 0.75);
    }
  }
  if (event.kind === "ecg") {
    ecgRate = Number(event.streamHealth?.observedSampleRateHz ?? 130);
    ecgReady = ecgRate >= 110;
    const samples = Array.from(event.microvolts ?? [], Number).filter(
      Number.isFinite,
    );
    appendEcg(samples);
    for (const beat of detector.pushFrame(samples, event.sensorTimestampNs)) {
      detectorConfidence = beat.confidence;
      if (detector.ready) registerBeat("ecg-rpeak", beat.confidence);
    }
    showMetrics();
  }
  if (event.kind === "accelerometer") {
    lastBreathingAt = performance.now();
    breathingReady = event.breathing?.ready === true;
  }
  if (event.kind === "warning")
    setText("mobile-support-copy", event.message ?? "Breathing input unavailable");
  if (event.kind === "error") {
    stateOverride = "SIGNAL ERROR";
    setText("mobile-support-copy", event.message ?? "Unknown Polar error");
  }
}

async function connectPolar() {
  const support = polarWebBluetoothSupport();
  if (!support.supported) {
    setText("mobile-support", "DIRECT BLUETOOTH UNAVAILABLE");
    setText("mobile-support-copy", support.reason);
    return;
  }
  if (simulated) {
    simulated = false;
    element<HTMLInputElement>("mobile-simulated").checked = false;
  }
  for (const key of Object.keys(metrics)) delete metrics[key];
  detector.reset();
  beatCounter = 0;
  lastBeatAt = -Infinity;
  ecgSamples.length = 0;
  breathingReady = false;
  lastBreathingAt = -Infinity;
  drawEcg();
  stateOverride = "POLAR CONNECTING";
  try {
    await session.connect(handlePolarEvent);
  } catch (error) {
    stateOverride = "PAIRING FAILED";
    setText(
      "mobile-support-copy",
      error instanceof Error ? error.message : String(error),
    );
    element<HTMLButtonElement>("mobile-connect").disabled = false;
  }
}

async function disconnectPolar() {
  await session.disconnect();
  physicalConnected = false;
  ecgReady = false;
  breathingReady = false;
  lastBreathingAt = -Infinity;
  ecgRate = 0;
  detector.reset();
  stateOverride = undefined;
  showMetrics();
}

function simulatedSignals(now: number) {
  if (!simulated) return;
  const bpm = Number(element<HTMLInputElement>("mobile-sim-bpm").value),
    excitement = Number(element<HTMLInputElement>("mobile-sim-excite").value),
    breath = Number(element<HTMLInputElement>("mobile-sim-breath").value);
  metrics.heart_rate = bpm;
  metrics.rr_interval = 60_000 / bpm;
  metrics.excitement_score = excitement;
  metrics.excitometer = clamp(excitement * 0.85 + 0.08);
  metrics.breathing_volume = breath;
  ecgRate = 130;
  if (now >= simNextBeat) {
    simNextBeat = now + 60_000 / bpm;
    appendEcg(
      Array.from({ length: 34 }, (_, index) => {
        const phase = index / 34;
        return (
          Math.sin(phase * Math.PI * 4) * 50 +
          Math.exp(-((phase - 0.48) ** 2) / 0.0015) * 1_100 -
          Math.exp(-((phase - 0.57) ** 2) / 0.004) * 240
        );
      }),
    );
    if (mappings.beatSource !== "off")
      registerBeat(
        mappings.beatSource === "polar-rr" ? "polar-rr" : "ecg-rpeak",
        1,
      );
  }
  showMetrics();
}

function setCheck(id: string, ready: boolean, readyText = "READY") {
  const row = element(id);
  row.classList.toggle("is-ready", ready);
  row.querySelector("b")!.textContent = ready ? readyText : "WAIT";
}

function renderReadiness() {
  const readiness = mobileReadiness({
    simulated,
    connected: physicalConnected,
    ecgReady,
    breathingReady:
      simulated ||
      (breathingReady && performance.now() - lastBreathingAt <= 2_000),
    detectorReady: detector.ready,
    metrics,
    mappings,
  });
  currentReady = readiness.ready;
  setCheck("ready-source", readiness.checks.source, simulated ? "SIM" : "LIVE");
  setCheck("ready-heart", readiness.checks.heartRate);
  setCheck("ready-rr", readiness.checks.rr);
  setCheck("ready-ecg", readiness.checks.ecg, simulated ? "SIM" : "LIVE");
  setCheck("ready-mapping", readiness.checks.mappedMetric);
  setCheck("ready-beat", readiness.checks.beat);
  const start = element<HTMLButtonElement>("mobile-start");
  start.disabled = !currentReady;
  start.textContent = started ? "Return to flight" : "Start flight";
  element("mobile-state-dot").classList.toggle("is-live", currentReady);
  element("mobile-shell").classList.toggle("is-simulated", simulated);
  setText(
    "mobile-state",
    stateOverride ??
      (currentReady
        ? simulated
          ? "SIMULATED READY"
          : "POLAR CONTROL READY"
        : physicalConnected
          ? "SIGNAL WARMING UP"
          : "SIGNAL SETUP"),
  );
  const mapped = mappings.altitude.metric;
  setText(
    "mobile-ready-copy",
    currentReady
      ? `${simulated ? "Simulated" : "Physical Polar"} control is ready.`
      : mapped === "excitement_score" &&
          physicalConnected &&
          excitementPairs < 10
        ? `Excitement is warming up (${excitementPairs}/10 calibration pairs).`
        : mapped === "breathing_volume" && physicalConnected
          ? "Breathing control calibrates from about 12 seconds of normal chest motion."
        : "Connect a worn H10 or enable the simulator.",
  );
  return readiness.ready;
}

function pauseForSignal() {
  if (!started || signalHeld) return;
  signalHeld = true;
  if (resumeTimer) clearInterval(resumeTimer);
  resumeTimer = undefined;
  game.setPaused(true);
  element("mobile-pause").hidden = false;
  setText("mobile-pause-copy", "Waiting for the selected body signal…");
}

function recoverSignal() {
  if (!started || !signalHeld || resumeTimer) return;
  let remaining = 3;
  setText("mobile-pause-copy", `Signal recovered. Resuming in ${remaining}…`);
  resumeTimer = window.setInterval(() => {
    if (!currentReady) {
      clearInterval(resumeTimer);
      resumeTimer = undefined;
      setText("mobile-pause-copy", "Waiting for the selected body signal…");
      return;
    }
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(resumeTimer);
      resumeTimer = undefined;
      signalHeld = false;
      element("mobile-pause").hidden = true;
      game.setPaused(false);
      return;
    }
    setText("mobile-pause-copy", `Signal recovered. Resuming in ${remaining}…`);
  }, 1_000);
}

function updateLoop(now: number) {
  const deltaMs = Math.min(100, Math.max(0, now - lastFrameAt));
  lastFrameAt = now;
  simulatedSignals(now);
  let commandsValid = true;
  for (const command of ["altitude", "throttle", "traffic"] as const) {
    const target = commandValue(command, metrics, mappings);
    if (target === undefined) commandsValid = false;
    else
      latestCommands[command] = smoothers[command].update(
        target,
        deltaMs,
        mappings[command].attackMs,
        mappings[command].releaseMs,
      );
  }
  const ready = renderReadiness() && commandsValid;
  currentReady = ready;
  gameDivePublisher.update(
    {
      volume01: metrics.breathing_volume,
      ready:
        breathingReady && performance.now() - lastBreathingAt <= 500,
      physicalPolar: physicalConnected,
      simulated,
      signalAgeMs: Number.isFinite(lastBreathingAt)
        ? Math.max(0, now - lastBreathingAt)
        : 999_999,
    },
    now,
  );
  const frame: FlightFrame = {
    sequence: (sequence = (sequence + 1) >>> 0),
    beatCounter,
    altitude: latestCommands.altitude,
    throttle: latestCommands.throttle,
    traffic: latestCommands.traffic,
    beatAgeMs: Number.isFinite(lastBeatAt)
      ? Math.max(0, now - lastBeatAt)
      : 999_999,
    quality: simulated ? 1 : clamp(detectorConfidence || (ecgReady ? 0.6 : 0)),
    flags:
      (ready ? FlightFlags.controlReady : 0) |
      (physicalConnected ? FlightFlags.physicalPolar : 0) |
      (detector.ready ? FlightFlags.beatDetectorReady : 0) |
      (simulated ? FlightFlags.simulation : 0),
  };
  game.setControls(frame);
  const displayValue = (frame.altitude + 1) / 2;
  setText("mobile-signal-value", displayValue.toFixed(2));
  if (started && !ready) pauseForSignal();
  if (started && ready && signalHeld) recoverSignal();
  if (
    started &&
    element<HTMLInputElement>("mobile-log-enabled").checked &&
    now - lastLogAt >= 100
  ) {
    lastLogAt = now;
    log.add({
      event: "command",
      mode: "mobile-direct",
      session_mode: simulated ? "simulation" : "polar",
      heart_rate: metrics.heart_rate ?? "",
      rr_interval: metrics.rr_interval ?? "",
      excitement_score: metrics.excitement_score ?? "",
      breathing_volume: metrics.breathing_volume ?? "",
      altitude: frame.altitude,
      throttle: frame.throttle,
      traffic: frame.traffic,
      beat_counter: frame.beatCounter,
      quality: frame.quality,
      flags: frame.flags,
      score: game.snapshot().score,
    });
    element<HTMLButtonElement>("mobile-log-export").disabled = log.size === 0;
  }
  requestAnimationFrame(updateLoop);
}

function saveSettings() {
  settings = sanitizeMobileSettings({
    altitudeMode: element<HTMLSelectElement>("mobile-altitude-mode").value,
    beatSource: element<HTMLSelectElement>("mobile-beat-source").value,
    manualAltitude: element<HTMLInputElement>("mobile-altitude").value,
    throttle: element<HTMLInputElement>("mobile-throttle").value,
    traffic: element<HTMLInputElement>("mobile-traffic").value,
  });
  mappings = buildMobileMappings(settings);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  const isManual = settings.altitudeMode === "manual";
  element("mobile-altitude-field").classList.toggle("is-disabled", !isManual);
  element<HTMLInputElement>("mobile-altitude").disabled = !isManual;
  setText(
    "mobile-altitude-output",
    `${Math.round(settings.manualAltitude * 100)}%`,
  );
  setText("mobile-throttle-output", `${Math.round(settings.throttle * 100)}%`);
  setText("mobile-traffic-output", `${Math.round(settings.traffic * 100)}%`);
}

function hydrateSettings() {
  element<HTMLSelectElement>("mobile-altitude-mode").value =
    settings.altitudeMode;
  element<HTMLSelectElement>("mobile-beat-source").value = settings.beatSource;
  element<HTMLInputElement>("mobile-altitude").value = String(
    settings.manualAltitude,
  );
  element<HTMLInputElement>("mobile-throttle").value = String(
    settings.throttle,
  );
  element<HTMLInputElement>("mobile-traffic").value = String(settings.traffic);
  saveSettings();
}

function setDrawer(open: boolean) {
  if (open) releaseSteering();
  element("mobile-controls").classList.toggle("is-open", open);
  element("mobile-shell").classList.toggle("has-open-controls", open);
  const toggle = element<HTMLButtonElement>("mobile-controls-toggle");
  toggle.setAttribute("aria-expanded", String(open));
}

async function requestWakeLock() {
  try {
    wakeLock = await (navigator as any).wakeLock?.request?.("screen");
  } catch {
    /* Optional on mobile browsers. */
  }
}

async function startFlight() {
  if (!currentReady) return;
  if (started) {
    setDrawer(false);
    return;
  }
  await aircraftReady;
  await sound.unlock();
  void requestWakeLock();
  started = true;
  signalHeld = false;
  element("mobile-pause").hidden = true;
  element("mobile-steering").hidden = false;
  game.restart();
  setDrawer(false);
  if (element<HTMLInputElement>("mobile-log-enabled").checked)
    log.add({
      event: "start",
      mode: "mobile-direct",
      simulation: simulated,
      altitude_metric: mappings.altitude.metric,
      beat_source: mappings.beatSource,
      aircraft: selectedAircraftId,
    });
}

function renderCompatibility() {
  const support = polarWebBluetoothSupport();
  const status = element("mobile-support");
  status.classList.toggle("is-supported", support.supported);
  status.classList.toggle("is-unsupported", !support.supported);
  status.textContent = support.supported
    ? "DIRECT BLUETOOTH AVAILABLE"
    : "DIRECT BLUETOOTH UNAVAILABLE";
  setText(
    "mobile-support-copy",
    support.supported
      ? "Tap Connect and choose your worn Polar H10. Keep this tab visible while playing."
      : `${support.reason} On iPhone or iPad, use Ground Control on another compatible device and open the network Flight Deck below.`,
  );
  element<HTMLButtonElement>("mobile-connect").disabled = !support.supported;
}

function bindActions() {
  element("mobile-connect").addEventListener(
    "click",
    () => void connectPolar(),
  );
  element("mobile-disconnect").addEventListener(
    "click",
    () => void disconnectPolar(),
  );
  element("mobile-controls-toggle").addEventListener("click", () =>
    setDrawer(!element("mobile-controls").classList.contains("is-open")),
  );
  element("mobile-controls-close").addEventListener("click", () =>
    setDrawer(false),
  );
  element("mobile-open-controls").addEventListener("click", () =>
    setDrawer(true),
  );
  element("mobile-start").addEventListener("click", () => void startFlight());
  bindSteeringButton("mobile-steer-left", -1);
  bindSteeringButton("mobile-steer-right", 1);
  for (const id of [
    "mobile-altitude-mode",
    "mobile-beat-source",
    "mobile-altitude",
    "mobile-throttle",
    "mobile-traffic",
  ])
    element(id).addEventListener("input", saveSettings);
  element<HTMLInputElement>("mobile-simulated").addEventListener(
    "change",
    async (event) => {
      const enabled = (event.target as HTMLInputElement).checked;
      if (enabled && physicalConnected) await disconnectPolar();
      simulated = enabled;
      if (simulated) {
        simNextBeat = performance.now();
        detector.reset();
        stateOverride = undefined;
        const status = element("mobile-support");
        status.classList.remove("is-supported", "is-unsupported");
        status.textContent = "SIMULATED SIGNAL ACTIVE";
        setText(
          "mobile-support-copy",
          "Test data is generated locally and is never presented as a physical Polar connection.",
        );
      } else renderCompatibility();
    },
  );
  for (const id of [
    "mobile-sim-bpm",
    "mobile-sim-excite",
    "mobile-sim-breath",
  ])
    element(id).addEventListener("input", () => {
      setText(
        "mobile-sim-bpm-output",
        `${element<HTMLInputElement>("mobile-sim-bpm").value} bpm`,
      );
      setText(
        "mobile-sim-excite-output",
        Number(element<HTMLInputElement>("mobile-sim-excite").value).toFixed(2),
      );
      setText(
        "mobile-sim-breath-output",
        Number(element<HTMLInputElement>("mobile-sim-breath").value).toFixed(2),
      );
    });
  element("mobile-log-export").addEventListener("click", () =>
    log.download("ecgaming-mobile-flight.csv"),
  );
  const fullscreen = element<HTMLButtonElement>("mobile-fullscreen");
  const root = document.documentElement as HTMLElement & {
    requestFullscreen?: () => Promise<void>;
  };
  fullscreen.hidden = typeof root.requestFullscreen !== "function";
  fullscreen.addEventListener("click", async () => {
    try {
      await root.requestFullscreen?.();
      await (screen.orientation as any)?.lock?.("landscape");
    } catch {
      fullscreen.textContent = "FULLSCREEN UNAVAILABLE";
    }
  });
}

game.addEventListener("score", ((event: CustomEvent) => {
  const { score, points = 1, kind } = event.detail;
  setText("score", String(score).padStart(3, "0"));
  if (kind === "pass") {
    sound.ring(true);
    celebrate(points, score);
  }
  if (
    kind !== "restart" &&
    element<HTMLInputElement>("mobile-log-enabled").checked
  )
    log.add({ event: kind, score, points, mode: "mobile-direct" });
}) as EventListener);

addEventListener("beforeunload", () => {
  gameHeartbeatPublisher.close();
  gameDivePublisher.close();
  if (resumeTimer) clearInterval(resumeTimer);
  if (rewardTimer) clearTimeout(rewardTimer);
  releaseSteering();
  void wakeLock?.release?.();
  void session.disconnect({ emit: false });
  game.dispose();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && started) void requestWakeLock();
});

hydrateSettings();
hydrateAircraftSelector();
renderCompatibility();
bindActions();
setDrawer(true);
showMetrics();
requestAnimationFrame(updateLoop);
