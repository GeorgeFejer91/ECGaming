import { BreathSonifier, type SonifierFrame } from "./breath-engine";
import {
  getBreathsPerMinute,
  getCycleSeconds,
  interpolateBreathTiming,
  normalizeBreathTiming,
  type BreathTiming,
} from "./breath-model";
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

const byId = <ElementType extends HTMLElement>(id: string) => {
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

let playing = false;
let rampFrame = 0;
let sensorTimer = 0;

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
  sourceText.textContent = frame.source === "cycle" ? "timed cycle" : "live input";
  sourceText.dataset.source = frame.source;
  document.documentElement.style.setProperty(
    "--breath-volume",
    frame.volume01.toFixed(4),
  );
  document.documentElement.style.setProperty(
    "--breath-flow",
    frame.flow01.toFixed(4),
  );
  document.documentElement.style.setProperty(
    "--phase-progress",
    frame.phase01.toFixed(4),
  );
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
      statusText.textContent = "Audio running";
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
    sonifier.releasePhysiology();
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
sonifier.onFrame(renderFrame);

applyTiming();
applyTimbre();
updateSensorStream();

window.addEventListener("pagehide", () => {
  window.clearInterval(sensorTimer);
  void sonifier.destroy();
});
