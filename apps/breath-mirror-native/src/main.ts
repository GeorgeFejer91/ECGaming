import "@fontsource/barlow-condensed/400.css";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/cormorant-garamond/400.css";
import "@fontsource/cormorant-garamond/400-italic.css";
import "./style.css";
import {
  autoConnectPolar,
  connectPolar,
  disconnectPolar,
  getAudioDevices,
  getAudioStatus,
  getPolarStatus,
  setSoundControls,
  startAudio,
  stopAudio,
  type AudioStatus,
  type AudioDeviceSummary,
  type BreathPreset,
  type BreathSource,
  type NativeError,
  type PolarStatus,
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
  outputDevice: requireElement<HTMLSelectElement>("output-device"),
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
  polarConnect: requireElement<HTMLButtonElement>("polar-connect"),
  polarDevice: requireElement<HTMLSelectElement>("polar-device"),
  polarDot: requireElement<HTMLElement>("polar-dot"),
  polarState: requireElement<HTMLElement>("polar-state"),
  polarMessage: requireElement<HTMLElement>("polar-message"),
  polarAcc: requireElement<HTMLElement>("polar-acc"),
  polarEcg: requireElement<HTMLElement>("polar-ecg"),
  polarCalibration: requireElement<HTMLElement>("polar-calibration"),
  polarConfidence: requireElement<HTMLElement>("polar-confidence"),
  polarHeart: requireElement<HTMLElement>("polar-heart"),
  polarFreshness: requireElement<HTMLElement>("polar-freshness"),
  parametersPanel: document.querySelector<HTMLElement>(".parameters-panel")!,
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

let selectedPreset: BreathPreset = "aperture";
let selectedSource: BreathSource = "polar";
let running = false;
let polarConnected = false;
let polarRequestInFlight = false;
let polarAutoRetry = true;
let lastPolarAttemptAt = 0;
let controlsDirty = false;
let controlRequestInFlight = false;
let pollTimer: number | undefined;

function numberValue(input: HTMLInputElement): number {
  return Number.parseFloat(input.value);
}

function currentControls(): SoundControls {
  return {
    preset: selectedPreset,
    source: selectedSource,
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
  elements.paceReadout.textContent = selectedSource === "polar" ? "LIVE" : numberValue(elements.pace).toFixed(1);
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

function setSource(source: BreathSource): void {
  selectedSource = source;
  document.querySelectorAll<HTMLButtonElement>(".source-button").forEach((button) => {
    const selected = button.dataset.source === source;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-checked", String(selected));
  });
  elements.parametersPanel.classList.toggle("is-polar", source === "polar");
  updateControlLabels();
  void flushControls();
}

function renderStatus(status: AudioStatus): void {
  running = status.running;
  elements.engineDot.classList.toggle("is-running", running);
  elements.engineState.textContent = running ? "NATIVE ENGINE LIVE" : "ENGINE RESTING";
  elements.deviceName.textContent = status.deviceName ?? "native output not started";
  elements.startIcon.textContent = running ? "■" : "▶";
  elements.startLabel.textContent = running ? "STOP FIELD" : "START MUSICAL FIELD";
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
    const driver = status.source === "polar"
      ? status.physiologyReady && status.physiologyFresh
        ? "live Polar phase + flow"
        : "Polar selected · waiting for a fresh calibrated signal"
      : "guided cycle";
    elements.notice.textContent = `${selectedPreset.toUpperCase()} · ${driver} · ${status.bufferMode ?? "system buffer"}`;
    elements.notice.classList.remove("is-error");
  }
}

function renderAudioDevices(
  devices: AudioDeviceSummary[],
  activeDeviceId: string | null,
): void {
  const previous = activeDeviceId ?? elements.outputDevice.value;
  elements.outputDevice.replaceChildren();
  if (devices.length === 0) {
    elements.outputDevice.add(new Option("NO ACTIVE OUTPUTS", ""));
    elements.outputDevice.disabled = true;
    return;
  }
  for (const device of devices) {
    const suffix = device.isDefault ? " · WINDOWS DEFAULT" : "";
    elements.outputDevice.add(new Option(`${device.name}${suffix}`, device.id));
  }
  elements.outputDevice.disabled = false;
  const selected = devices.find((device) => device.id === previous)
    ?? devices.find((device) => device.isDefault)
    ?? devices[0];
  elements.outputDevice.value = selected.id;
}

function renderPolarStatus(status: PolarStatus): void {
  polarConnected = status.connected;
  elements.polarState.textContent = status.state.toUpperCase();
  elements.polarMessage.textContent = status.message;
  elements.polarDot.classList.toggle("is-polar-live", status.locked);
  elements.polarDot.classList.toggle(
    "is-polar-busy",
    ["scanning", "detected", "connecting", "calibrating"].includes(status.state),
  );
  elements.polarCalibration.textContent = `${Math.round(status.calibrationProgress * 100)}%`;
  elements.polarConfidence.textContent = `${Math.round(status.confidence * 100)}%`;
  elements.polarHeart.textContent = status.heartRate ? `${status.heartRate} bpm` : "—";
  elements.polarEcg.textContent = status.ecgSamples > 0 ? `${status.ecgSamples} smp` : "—";
  elements.polarFreshness.textContent = status.freshnessMs === null ? "—" : `${status.freshnessMs} ms`;
  elements.polarAcc.textContent = status.estimatedAccHz
    ? `${status.estimatedAccHz.toFixed(1)} Hz`
    : status.accSamples > 0
      ? `${status.accSamples} samples`
      : "—";
  elements.polarConnect.textContent = status.connected ? "DISCONNECT POLAR" : "CONNECT + CALIBRATE";

  const selectedId = elements.polarDevice.value;
  const signature = status.devices.map((device) => `${device.id}:${device.name}`).join("|");
  if (elements.polarDevice.dataset.signature !== signature) {
    elements.polarDevice.replaceChildren();
    const automatic = document.createElement("option");
    automatic.value = "";
    automatic.textContent = "AUTO-DETECT WORN H10";
    elements.polarDevice.append(automatic);
    for (const device of status.devices) {
      const option = document.createElement("option");
      option.value = device.id;
      option.textContent = device.rssi === null ? device.name : `${device.name} · ${device.rssi} dBm`;
      elements.polarDevice.append(option);
    }
    if (status.devices.some((device) => device.id === selectedId)) {
      elements.polarDevice.value = selectedId;
    } else if (status.devices.length === 1) {
      elements.polarDevice.value = status.devices[0].id;
    }
    elements.polarDevice.dataset.signature = signature;
  }

  if (status.locked && selectedSource !== "polar") setSource("polar");
}

async function togglePolar(): Promise<void> {
  if (polarRequestInFlight) return;
  polarRequestInFlight = true;
  elements.polarConnect.disabled = true;
  try {
    polarAutoRetry = !polarConnected;
    lastPolarAttemptAt = Date.now();
    const status = polarConnected
      ? await disconnectPolar()
      : elements.polarDevice.value
        ? await connectPolar(elements.polarDevice.value)
        : await autoConnectPolar();
    renderPolarStatus(status);
    if (status.connected || status.state === "connecting" || status.state === "calibrating") {
      setSource("polar");
    }
  } catch (error) {
    elements.polarState.textContent = "CONNECTION ERROR";
    elements.polarMessage.textContent = describeError(error);
    elements.polarDot.classList.remove("is-polar-live", "is-polar-busy");
  } finally {
    polarRequestInFlight = false;
    elements.polarConnect.disabled = false;
  }
}

async function beginPolarAutoConnect(): Promise<void> {
  if (polarRequestInFlight || polarConnected || !polarAutoRetry) return;
  polarRequestInFlight = true;
  lastPolarAttemptAt = Date.now();
  elements.polarConnect.disabled = true;
  try {
    renderPolarStatus(await autoConnectPolar());
    setSource("polar");
  } catch (error) {
    elements.polarState.textContent = "H10 NOT FOUND";
    elements.polarMessage.textContent = describeError(error);
    elements.polarDot.classList.remove("is-polar-live", "is-polar-busy");
  } finally {
    polarRequestInFlight = false;
    elements.polarConnect.disabled = false;
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
      renderStatus(await startAudio(bufferFrames, elements.outputDevice.value || null));
      await flushControls();
    }
  } catch (error) {
    elements.notice.textContent = describeError(error);
    elements.notice.classList.add("is-error");
  } finally {
    elements.startButton.disabled = false;
  }
}

async function switchAudioOutput(): Promise<void> {
  if (!running) return;
  elements.outputDevice.disabled = true;
  elements.notice.classList.remove("is-error");
  try {
    const bufferFrames = Number.parseInt(elements.bufferSize.value, 10);
    renderStatus(await stopAudio());
    await setSoundControls(currentControls());
    renderStatus(await startAudio(bufferFrames, elements.outputDevice.value || null));
    elements.notice.textContent = `Now playing through ${elements.outputDevice.selectedOptions[0]?.textContent ?? "selected output"}.`;
  } catch (error) {
    elements.notice.textContent = describeError(error);
    elements.notice.classList.add("is-error");
  } finally {
    elements.outputDevice.disabled = false;
  }
}

async function pollStatus(): Promise<void> {
  window.clearTimeout(pollTimer);
  if (document.visibilityState === "hidden") {
    pollTimer = window.setTimeout(() => void pollStatus(), 1000);
    return;
  }
  try {
    const [audio, polar] = await Promise.all([getAudioStatus(), getPolarStatus()]);
    renderStatus(audio);
    renderPolarStatus(polar);
    if (
      polarAutoRetry
      && !polar.connected
      && polar.state === "error"
      && Date.now() - lastPolarAttemptAt >= 8_000
    ) {
      void beginPolarAutoConnect();
    }
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

document.querySelectorAll<HTMLButtonElement>(".source-button").forEach((button) => {
  button.addEventListener("click", () => setSource(button.dataset.source as BreathSource));
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
elements.outputDevice.addEventListener("change", () => void switchAudioOutput());
elements.polarConnect.addEventListener("click", () => void togglePolar());
document.addEventListener("keydown", (event) => {
  if (event.code === "Space" && event.target === document.body) {
    event.preventDefault();
    void toggleAudio();
  }
});
document.addEventListener("visibilitychange", () => void pollStatus());

async function initialize(): Promise<void> {
  updateControlLabels();
  setSource("polar");
  try {
    const [audio, polar, audioDevices] = await Promise.all([
      getAudioStatus(),
      getPolarStatus(),
      getAudioDevices(),
    ]);
    renderAudioDevices(audioDevices, audio.deviceId);
    renderStatus(audio);
    renderPolarStatus(polar);
    if (
      !polar.connected
      && !["scanning", "connecting", "calibrating"].includes(polar.state)
    ) {
      void beginPolarAutoConnect();
    }
  } catch {
    // pollStatus owns bridge error rendering and retries after initialization.
  }
  void pollStatus();
}

void initialize();
