import "@fontsource/barlow-condensed/400.css";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/cormorant-garamond/400.css";
import "@fontsource/cormorant-garamond/400-italic.css";
import "./style.css";
import {
  getAudioStatus,
  setSoundControls,
  startAudio,
  stopAudio,
  type AudioStatus,
  type BreathPreset,
  type NativeError,
  type SoundControls,
} from "./native";

function requireElement<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as unknown as T;
}

const elements = {
  startButton: requireElement<HTMLButtonElement>("start-button"),
  startIcon: requireElement<HTMLElement>("start-icon"),
  startLabel: requireElement<HTMLElement>("start-label"),
  bufferSize: requireElement<HTMLSelectElement>("buffer-size"),
  notice: requireElement<HTMLElement>("notice"),
  engineDot: requireElement<HTMLElement>("engine-dot"),
  engineState: requireElement<HTMLElement>("engine-state"),
  deviceName: requireElement<HTMLElement>("device-name"),
  phaseName: requireElement<HTMLElement>("phase-name"),
  paceReadout: requireElement<HTMLElement>("pace-readout"),
  flowReadout: requireElement<HTMLElement>("flow-readout"),
  lungShape: requireElement<SVGPathElement>("lung-shape"),
  lungHalo: requireElement<HTMLElement>("lung-halo"),
  sampleRate: requireElement<HTMLElement>("sample-rate"),
  channels: requireElement<HTMLElement>("channels"),
  callbackFrames: requireElement<HTMLElement>("callback-frames"),
  latency: requireElement<HTMLElement>("latency"),
  callbackLoad: requireElement<HTMLElement>("callback-load"),
  xruns: requireElement<HTMLElement>("xruns"),
  pace: requireElement<HTMLInputElement>("pace"),
  paceValue: requireElement<HTMLOutputElement>("pace-value"),
  inhaleShare: requireElement<HTMLInputElement>("inhale-share"),
  inhaleValue: requireElement<HTMLOutputElement>("inhale-value"),
  intensity: requireElement<HTMLInputElement>("intensity"),
  intensityValue: requireElement<HTMLOutputElement>("intensity-value"),
  brightness: requireElement<HTMLInputElement>("brightness"),
  brightnessValue: requireElement<HTMLOutputElement>("brightness-value"),
  naturalness: requireElement<HTMLInputElement>("naturalness"),
  naturalnessValue: requireElement<HTMLOutputElement>("naturalness-value"),
  output: requireElement<HTMLInputElement>("output"),
  outputValue: requireElement<HTMLOutputElement>("output-value"),
};

let selectedPreset: BreathPreset = "natural";
let running = false;
let controlsDirty = false;
let controlRequestInFlight = false;
let pollTimer: number | undefined;

function numberValue(input: HTMLInputElement): number {
  return Number.parseFloat(input.value);
}

function currentControls(): SoundControls {
  return {
    preset: selectedPreset,
    breathsPerMinute: numberValue(elements.pace),
    inhaleShare: numberValue(elements.inhaleShare) / 100,
    intensity: numberValue(elements.intensity) / 100,
    brightness: numberValue(elements.brightness) / 100,
    naturalness: numberValue(elements.naturalness) / 100,
    outputGain: numberValue(elements.output) / 100,
  };
}

function describeError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const candidate = error as Partial<NativeError>;
    if (typeof candidate.message === "string") return candidate.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function updateControlLabels(): void {
  elements.paceValue.value = `${numberValue(elements.pace).toFixed(1)} bpm`;
  elements.paceReadout.textContent = numberValue(elements.pace).toFixed(1);
  elements.inhaleValue.value = `${Math.round(numberValue(elements.inhaleShare))}%`;
  elements.intensityValue.value = `${Math.round(numberValue(elements.intensity))}%`;
  elements.brightnessValue.value = `${Math.round(numberValue(elements.brightness))}%`;
  elements.naturalnessValue.value = `${Math.round(numberValue(elements.naturalness))}%`;
  elements.outputValue.value = `${Math.round(numberValue(elements.output))}%`;
}

async function flushControls(): Promise<void> {
  controlsDirty = true;
  if (!running || controlRequestInFlight) return;
  controlRequestInFlight = true;
  try {
    while (controlsDirty && running) {
      controlsDirty = false;
      renderStatus(await setSoundControls(currentControls()));
    }
  } catch (error) {
    elements.notice.textContent = describeError(error);
    elements.notice.classList.add("is-error");
  } finally {
    controlRequestInFlight = false;
  }
}

function setPreset(preset: BreathPreset): void {
  selectedPreset = preset;
  document.querySelectorAll<HTMLButtonElement>(".preset-card").forEach((card) => {
    const selected = card.dataset.preset === preset;
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-checked", String(selected));
  });
  void flushControls();
}

function renderStatus(status: AudioStatus): void {
  running = status.running;
  elements.engineDot.classList.toggle("is-running", running);
  elements.engineState.textContent = running ? "NATIVE ENGINE LIVE" : "ENGINE RESTING";
  elements.deviceName.textContent = status.deviceName ?? "native output not started";
  elements.startIcon.textContent = running ? "■" : "▶";
  elements.startLabel.textContent = running ? "STOP BREATH" : "START NATIVE BREATH";
  elements.startButton.classList.toggle("is-running", running);
  elements.bufferSize.disabled = running;

  elements.sampleRate.textContent = status.sampleRate ? `${(status.sampleRate / 1000).toFixed(1)} kHz` : "—";
  elements.channels.textContent = status.channels ? String(status.channels) : "—";
  elements.callbackFrames.textContent = status.callbackFrames ? `${status.callbackFrames} fr` : "—";
  elements.latency.textContent = status.callbackSliceMs ? `${status.callbackSliceMs.toFixed(2)} ms` : "—";
  elements.callbackLoad.textContent = status.running ? `${Math.round(status.callbackLoad * 100)}%` : "—";
  elements.xruns.textContent = String(status.streamErrors);
  elements.phaseName.textContent = status.phase;
  elements.flowReadout.textContent = `${Math.round(status.flow * 100)}%`;

  const scale = 0.91 + status.lungVolume * 0.105;
  elements.lungShape.style.transform = `scale(${scale})`;
  elements.lungShape.style.opacity = String(0.55 + status.flow * 0.45);
  elements.lungHalo.style.transform = `translate(-50%, -50%) scale(${0.78 + status.lungVolume * 0.32})`;
  elements.lungHalo.style.opacity = String(0.1 + status.flow * 0.55);

  if (status.lastError) {
    elements.notice.textContent = status.lastError;
    elements.notice.classList.add("is-error");
  } else if (running) {
    elements.notice.textContent = `${selectedPreset.toUpperCase()} · ${status.bufferMode ?? "system buffer"} · direct native synthesis`;
    elements.notice.classList.remove("is-error");
  }
}

async function toggleAudio(): Promise<void> {
  elements.startButton.disabled = true;
  elements.notice.classList.remove("is-error");
  try {
    if (running) {
      renderStatus(await stopAudio());
      elements.notice.textContent = "Native engine stopped.";
    } else {
      const bufferFrames = Number.parseInt(elements.bufferSize.value, 10);
      await setSoundControls(currentControls());
      renderStatus(await startAudio(bufferFrames));
      await flushControls();
    }
  } catch (error) {
    elements.notice.textContent = describeError(error);
    elements.notice.classList.add("is-error");
  } finally {
    elements.startButton.disabled = false;
  }
}

async function pollStatus(): Promise<void> {
  window.clearTimeout(pollTimer);
  if (document.visibilityState === "hidden") {
    pollTimer = window.setTimeout(() => void pollStatus(), 1000);
    return;
  }
  try {
    renderStatus(await getAudioStatus());
  } catch (error) {
    elements.engineState.textContent = "NATIVE BRIDGE UNAVAILABLE";
    elements.notice.textContent = `Launch with npm run native:dev. ${describeError(error)}`;
    elements.notice.classList.add("is-error");
  }
  pollTimer = window.setTimeout(() => void pollStatus(), running ? 250 : 1000);
}

document.querySelectorAll<HTMLButtonElement>(".preset-card").forEach((card) => {
  card.addEventListener("click", () => setPreset(card.dataset.preset as BreathPreset));
});

[
  elements.pace,
  elements.inhaleShare,
  elements.intensity,
  elements.brightness,
  elements.naturalness,
  elements.output,
].forEach((input) => {
  input.addEventListener("input", () => {
    updateControlLabels();
    void flushControls();
  });
});

elements.startButton.addEventListener("click", () => void toggleAudio());
document.addEventListener("keydown", (event) => {
  if (event.code === "Space" && event.target === document.body) {
    event.preventDefault();
    void toggleAudio();
  }
});
document.addEventListener("visibilitychange", () => void pollStatus());

updateControlLabels();
void pollStatus();
