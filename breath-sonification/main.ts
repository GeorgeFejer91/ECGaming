import { BreathSonifier, type SonifierFrame } from "./breath-engine";
import {
  getBreathsPerMinute,
  getCycleSeconds,
  interpolateBreathTiming,
  normalizeBreathTiming,
  type BreathTiming,
} from "./breath-model";
import { lungSilhouettePath } from "./lung-visual";
import {
  sonicMotionForPhase,
  sonicQualities,
} from "./breath-sonic-space";
import {
  PolarBreathLock,
  type PolarLockFrame,
} from "./polar-breath-lock";
import {
  PolarH10BrowserSession,
  polarWebBluetoothSupport,
} from "../src/vendor/affect-tracker/polar-stream.js";
import "./styles.css";

const PRESETS: Record<string, BreathTiming> = {
  fast: {
    inhaleSeconds: 0.75,
    inhaleHoldSeconds: 0.05,
    exhaleSeconds: 1.05,
    exhaleHoldSeconds: 0.15,
  },
  paced: {
    inhaleSeconds: 2.1,
    inhaleHoldSeconds: 0.15,
    exhaleSeconds: 3.2,
    exhaleHoldSeconds: 0.55,
  },
  slow: {
    inhaleSeconds: 4,
    inhaleHoldSeconds: 0.3,
    exhaleSeconds: 6,
    exhaleHoldSeconds: 0.6,
  },
};

const sonifier = new BreathSonifier();
const polarSession = new PolarH10BrowserSession();
const polarBreathLock = new PolarBreathLock();

const byId = <ElementType extends Element>(id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as ElementType;
};

const inputs = {
  inhaleSeconds: byId<HTMLInputElement>("inhale-seconds"),
  inhaleHoldSeconds: byId<HTMLInputElement>("inhale-hold-seconds"),
  exhaleSeconds: byId<HTMLInputElement>("exhale-seconds"),
  exhaleHoldSeconds: byId<HTMLInputElement>("exhale-hold-seconds"),
};
const intensity = byId<HTMLInputElement>("intensity");
const brightness = byId<HTMLInputElement>("brightness");
const naturalness = byId<HTMLInputElement>("naturalness");
const master = byId<HTMLInputElement>("master");
const playButton = byId<HTMLButtonElement>("play-toggle");
const rampButton = byId<HTMLButtonElement>("pace-ramp");
const statusText = byId("audio-status");
const phaseText = byId("phase-text");
const sourceText = byId("source-text");
const bpmText = byId("bpm-value");
const cycleText = byId("cycle-value");
const sensorEnabled = byId<HTMLInputElement>("sensor-enabled");
const sensorVolume = byId<HTMLInputElement>("sensor-volume");
const sensorConfidence = byId<HTMLInputElement>("sensor-confidence");
const lungSilhouette = byId<SVGPathElement>("lung-silhouette");
const polarLockCard = byId("polar-lock-card");
const polarLockButton = byId<HTMLButtonElement>("polar-lock-toggle");
const polarLockState = byId("polar-lock-state");
const polarLockCopy = byId("polar-lock-copy");
const polarPhase = byId("polar-phase");
const polarCalibration = byId("polar-calibration");
const polarConfidence = byId("polar-confidence");
const polarHeartRate = byId("polar-heart-rate");
const polarEcgRate = byId("polar-ecg-rate");
const polarLinkStep = byId("polar-link-step");
const polarEcgStep = byId("polar-ecg-step");
const polarAccStep = byId("polar-acc-step");
const polarLinkChannel = byId("polar-link-channel");
const polarEcgChannel = byId("polar-ecg-channel");
const polarAccChannel = byId("polar-acc-channel");
const sonicAperture = byId("sonic-aperture");
const sonicApertureValue = byId("sonic-aperture-value");
const sonicApertureQualities = byId("sonic-aperture-qualities");

let playing = false;
let rampFrame = 0;
let sensorTimer = 0;
let polarWatchTimer = 0;
let polarConnecting = false;
let polarConnected = false;
let polarLockRequested = false;
let polarBreathReady = false;
let polarFrameWasStale = false;
let lungAnimationFrame = 0;
let visualVolume = 0;
let visualFlow = 0;
let targetVolume = 0;
let targetFlow = 0;

function setVisualTarget(volume01: number, flow01: number): void {
  targetVolume = Math.max(0, Math.min(1, volume01));
  targetFlow = Math.max(0, Math.min(1, flow01));
}

function animateLung(): void {
  visualVolume += (targetVolume - visualVolume) * 0.14;
  visualFlow += (targetFlow - visualFlow) * 0.2;
  lungSilhouette.setAttribute("d", lungSilhouettePath(visualVolume));
  document.documentElement.style.setProperty(
    "--breath-volume",
    visualVolume.toFixed(4),
  );
  document.documentElement.style.setProperty(
    "--breath-flow",
    visualFlow.toFixed(4),
  );
  lungAnimationFrame = requestAnimationFrame(animateLung);
}

function readTiming(): BreathTiming {
  return normalizeBreathTiming({
    inhaleSeconds: inputs.inhaleSeconds.valueAsNumber,
    inhaleHoldSeconds: inputs.inhaleHoldSeconds.valueAsNumber,
    exhaleSeconds: inputs.exhaleSeconds.valueAsNumber,
    exhaleHoldSeconds: inputs.exhaleHoldSeconds.valueAsNumber,
  });
}

function setInputTiming(timing: BreathTiming): void {
  for (const key of Object.keys(inputs) as Array<keyof BreathTiming>)
    inputs[key].value = timing[key].toFixed(2);
  applyTiming();
}

function applyTiming(): void {
  const timing = sonifier.setTiming(readTiming());
  bpmText.textContent = getBreathsPerMinute(timing).toFixed(1);
  cycleText.textContent = `${getCycleSeconds(timing).toFixed(2)} s`;
  for (const [key, input] of Object.entries(inputs)) {
    const output = document.querySelector<HTMLOutputElement>(
      `output[for="${input.id}"]`,
    );
    if (output) output.value = `${timing[key as keyof BreathTiming].toFixed(2)} s`;
  }
}

function applyTimbre(): void {
  sonifier.setTimbre({
    intensity01: intensity.valueAsNumber,
    brightness01: brightness.valueAsNumber,
    naturalness01: naturalness.valueAsNumber,
  });
  sonifier.setMaster(master.valueAsNumber);
  for (const input of [intensity, brightness, naturalness, master]) {
    const output = document.querySelector<HTMLOutputElement>(
      `output[for="${input.id}"]`,
    );
    if (output) output.value = `${Math.round(input.valueAsNumber * 100)}%`;
  }
}

function renderFrame(frame: SonifierFrame): void {
  const label = frame.phase.replace("-", " ");
  phaseText.textContent = label;
  sourceText.textContent =
    frame.source === "cycle"
      ? "timed cycle"
      : polarLockRequested
        ? polarBreathReady
          ? "polar acc · locked"
          : "polar acc · armed"
        : "manual input";
  sourceText.dataset.source = polarLockRequested ? "polar" : frame.source;
  setVisualTarget(frame.volume01, frame.flow01);
  document.documentElement.style.setProperty(
    "--phase-progress",
    frame.phase01.toFixed(4),
  );
  document.documentElement.style.setProperty(
    "--sound-openness",
    frame.openness01.toFixed(4),
  );
  const sonicMotion = sonicMotionForPhase(frame.phase, frame.openness01);
  const qualities = sonicQualities(frame.openness01);
  sonicAperture.dataset.motion = sonicMotion;
  sonicAperture.dataset.openness = frame.openness01.toFixed(3);
  sonicAperture.setAttribute(
    "aria-valuenow",
    String(Math.round(frame.openness01 * 100)),
  );
  sonicAperture.setAttribute(
    "aria-valuetext",
    `${sonicMotion}, ${qualities.replaceAll(" · ", ", ")}`,
  );
  sonicApertureValue.textContent = `${sonicMotion} · ${Math.round(frame.openness01 * 100)}%`;
  sonicApertureQualities.textContent = qualities;
  document.body.dataset.phase = frame.phase;
}

async function togglePlayback(): Promise<void> {
  playButton.disabled = true;
  try {
    if (playing) {
      sonifier.stop();
      playing = false;
      playButton.textContent = "Start breathing";
      playButton.setAttribute("aria-pressed", "false");
      statusText.textContent = "Audio paused";
    } else {
      await sonifier.start();
      playing = true;
      playButton.textContent = "Pause breathing";
      playButton.setAttribute("aria-pressed", "true");
      statusText.textContent = polarLockRequested
        ? "Audio armed for Polar ACC"
        : "Audio running";
    }
  } catch (error) {
    statusText.textContent =
      error instanceof Error ? error.message : "Audio could not start.";
    statusText.dataset.error = "true";
  } finally {
    playButton.disabled = false;
  }
}

function cancelRamp(): void {
  if (rampFrame) cancelAnimationFrame(rampFrame);
  rampFrame = 0;
  rampButton.textContent = "Run fast → slow · 30 s";
  rampButton.setAttribute("aria-pressed", "false");
}

function startRamp(): void {
  if (rampFrame) {
    cancelRamp();
    return;
  }
  const startedAt = performance.now();
  rampButton.textContent = "Stop pace transition";
  rampButton.setAttribute("aria-pressed", "true");

  const tick = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / 30_000);
    const timing =
      progress < 0.5
        ? interpolateBreathTiming(PRESETS.fast, PRESETS.paced, progress * 2)
        : interpolateBreathTiming(
            PRESETS.paced,
            PRESETS.slow,
            (progress - 0.5) * 2,
          );
    setInputTiming(timing);
    if (progress < 1) rampFrame = requestAnimationFrame(tick);
    else cancelRamp();
  };
  rampFrame = requestAnimationFrame(tick);
}

function updateSensorStream(): void {
  window.clearInterval(sensorTimer);
  if (!sensorEnabled.checked) {
    if (!polarLockRequested) sonifier.releasePhysiology();
    sensorVolume.disabled = true;
    sensorConfidence.disabled = true;
    return;
  }
  if (polarLockRequested) {
    sensorEnabled.checked = false;
    sensorVolume.disabled = true;
    sensorConfidence.disabled = true;
    return;
  }
  sensorVolume.disabled = false;
  sensorConfidence.disabled = false;
  const push = () =>
    sonifier.pushPhysiology({
      volume01: sensorVolume.valueAsNumber,
      confidence01: sensorConfidence.valueAsNumber,
    });
  push();
  sensorTimer = window.setInterval(push, 33);
}

function setPolarPanel(
  state: string,
  title: string,
  copy: string,
): void {
  polarLockCard.dataset.state = state;
  polarLockState.textContent = title;
  polarLockCopy.textContent = copy;
  polarLockButton.setAttribute("aria-pressed", String(polarLockRequested));
  polarLockButton.textContent = polarConnecting
    ? "Connecting Polar H10…"
    : polarLockRequested
      ? "Disconnect Polar H10"
      : "Connect Polar H10";
  polarLockButton.disabled = polarConnecting;
}

function setPolarChannel(
  step: Element,
  output: Element,
  state:
    | "idle"
    | "starting"
    | "waiting"
    | "live"
    | "lost"
    | "error"
    | "unsupported",
  label: string,
): void {
  step.setAttribute("data-state", state);
  output.textContent = label;
}

function resetPolarChannels(): void {
  setPolarChannel(polarLinkStep, polarLinkChannel, "idle", "standby");
  setPolarChannel(polarEcgStep, polarEcgChannel, "idle", "awaiting samples");
  setPolarChannel(polarAccStep, polarAccChannel, "idle", "awaiting samples");
  polarHeartRate.textContent = "-- bpm";
  polarEcgRate.textContent = "-- Hz";
}

function applyPolarFrame(frame: PolarLockFrame): void {
  const connectorReady = frame.ready && polarConnected;
  polarBreathReady = connectorReady;
  polarCalibration.textContent = `${Math.round(frame.calibration01 * 100)}%`;
  polarConfidence.textContent = `${Math.round(frame.confidence01 * 100)}%`;
  polarPhase.textContent = frame.phase;
  phaseText.textContent = frame.phase;
  sourceText.textContent = connectorReady
    ? "polar acc · locked"
    : "polar acc · armed";
  sourceText.dataset.source = "polar";
  setVisualTarget(frame.volume01, frame.flow01);
  sonifier.pushPhysiology({
    volume01: frame.volume01,
    flow01: frame.flow01,
    phase: frame.phaseValue,
    confidence01: connectorReady ? frame.confidence01 : 0,
    ready: connectorReady,
    timestampMs: frame.receivedAtMs,
  });

  if (frame.stale) {
    setPolarChannel(polarAccStep, polarAccChannel, "lost", "signal stale");
    setPolarPanel(
      "lost",
      "ACC SIGNAL LOST",
      "The connector is holding the breath sound silent. Keep this tab visible while it attempts a bounded stream restart.",
    );
  } else if (frame.ready && !polarConnected) {
    setPolarChannel(polarAccStep, polarAccChannel, "live", "200 Hz · phase ready");
    setPolarPanel(
      "waiting",
      "VERIFYING POLAR CHANNELS",
      "Breath motion is ready, but audio stays silent until live HR, ECG, and ACC channels are all confirmed.",
    );
  } else if (connectorReady) {
    setPolarChannel(polarAccStep, polarAccChannel, "live", "200 Hz · phase live");
    setPolarPanel(
      "locked",
      "BREATH MIRROR LINKED",
      "The mouth-breath sound now mirrors ACC-derived inhale, hold, and exhale. ECG remains live as a separate cardiac channel.",
    );
  } else if (!frame.calibrated) {
    setPolarChannel(polarAccStep, polarAccChannel, "live", "200 Hz · calibrating");
    setPolarPanel(
      "calibrating",
      "CALIBRATING CHEST AXIS",
      "Stay still and breathe normally while Polar collects the 12-second PCA calibration window.",
    );
  } else {
    setPolarChannel(polarAccStep, polarAccChannel, "live", "200 Hz · low confidence");
    setPolarPanel(
      "waiting",
      "SIGNAL NOT READY",
      "The classifier rejected this interval as unreliable motion. Audio remains silent until readiness returns.",
    );
  }
  if (playing)
    statusText.textContent = connectorReady
      ? `Audio locked to Polar · ${frame.phase}`
      : "Audio armed · waiting for Polar readiness";
}

function handlePolarEvent(event: any): void {
  if (event.kind === "status") {
    setPolarChannel(polarLinkStep, polarLinkChannel, "starting", "setting up");
    setPolarPanel(
      "connecting",
      "POLAR CONNECTING",
      event.message ?? "Opening the Polar signal path…",
    );
  }
  if (event.kind === "connection") {
    polarConnected = event.connected === true;
    if (polarConnected) {
      setPolarChannel(polarLinkStep, polarLinkChannel, "live", "connected");
      const currentFrame = polarBreathLock.read(performance.now());
      if (currentFrame) applyPolarFrame(currentFrame);
      else
        setPolarPanel(
          "calibrating",
          event.recovered
            ? "POLAR STREAMS RECOVERED"
            : "POLAR CHANNELS VERIFIED",
          "Live HR, ECG, and ACC packets are confirmed. Breathe normally and stay still while the breath axis calibrates.",
        );
    } else if (event.recovering && polarLockRequested) {
      polarBreathReady = false;
      setPolarChannel(polarLinkStep, polarLinkChannel, "starting", "restarting");
      setPolarChannel(polarEcgStep, polarEcgChannel, "waiting", "restarting");
      setPolarChannel(polarAccStep, polarAccChannel, "waiting", "restarting");
      sonifier.releasePhysiology();
      setPolarPanel(
        "connecting",
        "RESTARTING POLAR STREAMS",
        event.message ??
          "The connector is restarting the selected H10 without reopening the chooser.",
      );
    } else if (!polarConnected && polarLockRequested) {
      polarBreathReady = false;
      setPolarChannel(polarLinkStep, polarLinkChannel, "lost", "disconnected");
      setPolarChannel(polarEcgStep, polarEcgChannel, "lost", "offline");
      setPolarChannel(polarAccStep, polarAccChannel, "lost", "offline");
      sonifier.releasePhysiology();
      setPolarPanel(
        "lost",
        "POLAR LINK LOST",
        "The lock is silent and fail-closed. Release it, then connect again.",
      );
    }
  }
  if (event.kind === "ecg" && polarLockRequested) {
    const observedRate = Number(event.streamHealth?.observedSampleRateHz);
    const rate = Number.isFinite(observedRate) ? Math.round(observedRate) : 130;
    setPolarChannel(polarEcgStep, polarEcgChannel, "live", `${rate} Hz · live`);
    polarEcgRate.textContent = `${rate} Hz`;
  }
  if (event.kind === "heart-rate" && polarLockRequested) {
    const beatsPerMinute = Number(event.beatsPerMinute);
    if (Number.isFinite(beatsPerMinute) && beatsPerMinute > 0)
      polarHeartRate.textContent = `${Math.round(beatsPerMinute)} bpm`;
  }
  if (event.kind === "accelerometer" && polarLockRequested) {
    setPolarChannel(polarAccStep, polarAccChannel, "live", "200 Hz · live");
    const frame = polarBreathLock.accept(
      event.breathing ?? {},
      performance.now(),
    );
    polarFrameWasStale = false;
    applyPolarFrame(frame);
  }
  if (event.kind === "warning" || event.kind === "error") {
    if (event.kind === "error" && /ECG frame/i.test(event.message ?? ""))
      setPolarChannel(polarEcgStep, polarEcgChannel, "error", "packet rejected");
    setPolarPanel(
      "error",
      event.kind === "error" ? "POLAR SIGNAL ERROR" : "POLAR WARNING",
      event.message ?? "The Polar breathing stream is unavailable.",
    );
  }
}

function renderPolarAvailability(): void {
  const support = polarWebBluetoothSupport();
  if (!support.supported) {
    setPolarChannel(polarLinkStep, polarLinkChannel, "unsupported", "unavailable");
    setPolarChannel(polarEcgStep, polarEcgChannel, "unsupported", "offline");
    setPolarChannel(polarAccStep, polarAccChannel, "unsupported", "offline");
    polarLockCard.dataset.state = "unsupported";
    polarLockState.textContent = "DIRECT POLAR UNAVAILABLE";
    polarLockCopy.textContent = support.reason;
    polarLockButton.disabled = true;
    return;
  }
  resetPolarChannels();
  setPolarPanel(
    "idle",
    "POLAR CONNECTOR READY",
    "Choose a worn Polar H10. Live ECG and ACC must both be verified before the 12-second breathing calibration begins.",
  );
}

async function connectPolarLock(): Promise<void> {
  const support = polarWebBluetoothSupport();
  if (!support.supported) {
    renderPolarAvailability();
    return;
  }
  polarConnecting = true;
  polarLockRequested = true;
  polarConnected = false;
  polarBreathReady = false;
  polarFrameWasStale = false;
  polarBreathLock.reset();
  sensorEnabled.checked = false;
  sensorEnabled.disabled = true;
  updateSensorStream();
  sonifier.releasePhysiology();
  sonifier.setPhysiologyLock(true);
  setPolarPanel(
    "connecting",
    "OPENING POLAR",
    "Choose your H10 in the browser Bluetooth prompt.",
  );
  setPolarChannel(polarLinkStep, polarLinkChannel, "starting", "chooser");
  setPolarChannel(polarEcgStep, polarEcgChannel, "waiting", "awaiting samples");
  setPolarChannel(polarAccStep, polarAccChannel, "waiting", "awaiting samples");
  try {
    // connect() invokes requestDevice before its first await so the chooser
    // retains this click's browser user activation.
    await polarSession.connect(handlePolarEvent);
    polarConnected = true;
  } catch (error) {
    polarLockRequested = false;
    polarConnected = false;
    polarBreathReady = false;
    sensorEnabled.disabled = false;
    sonifier.setPhysiologyLock(false);
    sonifier.releasePhysiology();
    sourceText.textContent = "timed cycle";
    sourceText.dataset.source = "cycle";
    setPolarChannel(polarLinkStep, polarLinkChannel, "error", "connection failed");
    setPolarChannel(polarEcgStep, polarEcgChannel, "idle", "offline");
    setPolarChannel(polarAccStep, polarAccChannel, "idle", "offline");
    setPolarPanel(
      "error",
      "POLAR CONNECTOR FAILED",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    polarConnecting = false;
    polarLockButton.disabled = false;
    polarLockButton.textContent = polarLockRequested
      ? "Disconnect Polar H10"
      : "Connect Polar H10";
  }
}

async function releasePolarLock(): Promise<void> {
  polarConnecting = true;
  polarLockButton.disabled = true;
  try {
    await polarSession.disconnect();
  } finally {
    polarConnecting = false;
    polarConnected = false;
    polarLockRequested = false;
    polarBreathReady = false;
    polarFrameWasStale = false;
    polarBreathLock.reset();
    sonifier.setPhysiologyLock(false);
    sonifier.releasePhysiology();
    sourceText.textContent = "timed cycle";
    sourceText.dataset.source = "cycle";
    phaseText.textContent = "inhale";
    setVisualTarget(0, 0);
    sensorEnabled.disabled = false;
    polarCalibration.textContent = "0%";
    polarConfidence.textContent = "0%";
    polarPhase.textContent = "hold";
    renderPolarAvailability();
  }
}

function togglePolarLock(): void {
  if (polarConnecting) return;
  if (polarLockRequested) void releasePolarLock();
  else void connectPolarLock();
}

for (const input of Object.values(inputs)) input.addEventListener("input", applyTiming);
for (const input of [intensity, brightness, naturalness, master])
  input.addEventListener("input", applyTimbre);

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
  button.addEventListener("click", () => {
    cancelRamp();
    const preset = PRESETS[button.dataset.preset ?? "paced"];
    setInputTiming(preset);
  });
}

playButton.addEventListener("click", () => void togglePlayback());
rampButton.addEventListener("click", startRamp);
sensorEnabled.addEventListener("change", updateSensorStream);
sensorVolume.addEventListener("input", updateSensorStream);
sensorConfidence.addEventListener("input", updateSensorStream);
polarLockButton.addEventListener("click", togglePolarLock);
sonifier.onFrame(renderFrame);

lungSilhouette.setAttribute("d", lungSilhouettePath(0));
lungAnimationFrame = requestAnimationFrame(animateLung);
polarWatchTimer = window.setInterval(() => {
  if (!polarLockRequested || !polarConnected) return;
  const frame = polarBreathLock.read(performance.now());
  if (frame?.stale && !polarFrameWasStale) {
    polarFrameWasStale = true;
    applyPolarFrame(frame);
  }
}, 200);
applyTiming();
applyTimbre();
updateSensorStream();
renderPolarAvailability();

window.addEventListener("pagehide", () => {
  window.clearInterval(sensorTimer);
  window.clearInterval(polarWatchTimer);
  cancelAnimationFrame(lungAnimationFrame);
  void polarSession.disconnect({ emit: false });
  void sonifier.destroy();
});
