import "./styles.css";
import {
  FlightFlags,
  SIGNAL_BEACON_METRICS,
  SignalBeaconFlags,
} from "./protocol/flight-frame";
import {
  FlightBroadcaster,
  FlightReceiver,
  type SignalBeaconOffer,
} from "./protocol/remote";
import type {
  ContinuousCommand,
  DerivedMetricId,
  FlightFrame,
  FlightMappings,
  FlightReceiverSnapshot,
  MetricId,
} from "./protocol/types";
import { AdaptiveRangeTracker } from "./signals/adaptive-range";
import {
  AttackReleaseSmoother,
  commandValue,
  defaultNormalizationConfig,
  resetBindingMetric,
  sanitizeMappings,
} from "./signals/mappings";
import {
  flightLaunchReadiness,
  type FlightLaunchReadiness,
  type FlightLaunchSource,
} from "./signals/readiness";
import { CausalRPeakDetector } from "./signals/rpeak";
import { GroundCockpit, type CockpitTelemetry } from "./game/ground-cockpit";
import { SessionCsvLog } from "./logging/session-log";
import { installPretextFit } from "./ui/pretext-fit";
// Reused under the Affect Tracker repository's BSD-3-Clause license.
import {
  POLAR_METRICS,
  PolarH10BrowserSession,
  polarWebBluetoothSupport,
} from "./vendor/affect-tracker/polar-stream.js";

const SETTINGS_KEY = "ecgaming-ground-settings-v2";
const LEGACY_SETTINGS_KEY = "ecgaming-ground-settings-v1";
const SOURCE_KEY = "ecgaming-ground-source-v1";
const COMMANDS: ContinuousCommand[] = ["altitude", "throttle", "traffic"];
const COMMAND_LABELS: Record<ContinuousCommand, string> = {
  altitude: "Vertical control · plane up/down",
  throttle: "Throttle",
  traffic: "Ring traffic",
};
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const setText = (id: string, value: string) => {
  const target = element(id);
  if (target.textContent !== value) target.textContent = value;
};
const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));
const ageSince = (then: number, now: number) =>
  Number.isFinite(then) ? Math.max(0, now - then) : 999_999;
const sessionId = (prefix: string) =>
  prefix +
  "-" +
  Date.now().toString(36) +
  "-" +
  Math.random().toString(36).slice(2, 9);

const METRIC_DEFINITIONS = [
  {
    id: "manual",
    label: "Manual control",
    shortLabel: "Manual",
    minimum: 0,
    maximum: 1,
    unit: "0–1",
  },
  ...POLAR_METRICS,
] as {
  id: MetricId;
  label: string;
  shortLabel?: string;
  minimum: number;
  maximum: number;
  unit: string;
}[];

function storedMappings() {
  for (const key of [SETTINGS_KEY, LEGACY_SETTINGS_KEY]) {
    try {
      const value = localStorage.getItem(key);
      if (value) return sanitizeMappings(JSON.parse(value));
    } catch {
      /* Corrupt local settings fail safely to defaults. */
    }
  }
  return sanitizeMappings(undefined);
}

type SourceMode = "polar" | "beacon";
interface ActiveSignal {
  source: FlightLaunchSource;
  phase: string;
  sessionId: string;
  sourceLabel: string;
  lastSignalAt?: number;
  physicalPolar: boolean;
  simulation: boolean;
  remoteConfigReady: boolean;
  metrics: Record<string, number>;
  ecgBeatCounter: number;
  rrBeatCounter: number;
  ecgBeatAgeMs: number;
  rrBeatAgeMs: number;
  ecgBeatQuality: number;
  rrBeatQuality: number;
  ecgBeatReady: boolean;
  rrBeatReady: boolean;
  breathingReady: boolean;
  route: "local" | "direct" | "relay" | "unknown";
  latencyMs?: number;
  legacyFrame?: FlightFrame & { receivedAt: number };
}
interface RuntimeState {
  active: ActiveSignal;
  frame: FlightFrame;
  readiness: FlightLaunchReadiness;
  commandsValid: boolean;
  normalizationReady: boolean;
  beatReady: boolean;
  signalLabel: string;
}

const polar = new PolarH10BrowserSession();
const detector = new CausalRPeakDetector(130);
const broadcaster = new FlightBroadcaster();
const receiver = new FlightReceiver();
const adaptiveRange = new AdaptiveRangeTracker();
const cockpit = new GroundCockpit();
const log = new SessionCsvLog();
const ecgSamples: number[] = [];
const remoteTrace: number[] = [];
const polarMetrics: Record<string, number> = {};
let mappings = storedMappings();
let sourceMode: SourceMode =
  localStorage.getItem(SOURCE_KEY) === "beacon" ? "beacon" : "polar";
let physicalConnected = false;
let ecgReady = false;
let simulated = false;
let polarSessionId = "";
let simulationSessionId = "";
let lastPolarSignalAt = -Infinity;
let lastBreathingSignalAt = -Infinity;
let breathingReady = false;
let lastFrameAt = performance.now();
let lastLoggedAt = -Infinity;
let simNextBeat = performance.now();
let ecgBeatCounter = 0;
let rrBeatCounter = 0;
let lastEcgBeatAt = -Infinity;
let lastRrBeatAt = -Infinity;
let detectorConfidence = 0;
let rrBeatQuality = 0;
let localSequence = 0;
let lastGroundBeatCounter: number | undefined;
let lastRemoteTraceAt = -Infinity;
let latestRuntime: RuntimeState | undefined;
let sourceSignature = "";
let wakeLock: any;
let pipWindow: Window | undefined;
let xrChecked = false;
const latestCommands = { altitude: 0, throttle: 0.5, traffic: 0.5 };
const smoothers = {
  altitude: new AttackReleaseSmoother(0),
  throttle: new AttackReleaseSmoother(0.5),
  traffic: new AttackReleaseSmoother(0.5),
};

function metricDefinition(id: MetricId) {
  return METRIC_DEFINITIONS.find((metric) => metric.id === id)!;
}

function stateMetricLabel(metric?: MetricId) {
  if (!metric) return undefined;
  const definition = metricDefinition(metric);
  return definition.shortLabel || definition.label;
}

function saveMappings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(mappings));
}

function setupAccordion() {
  document
    .querySelectorAll<HTMLButtonElement>(".accordion-trigger")
    .forEach((trigger) =>
      trigger.addEventListener("click", () => {
        const selected = trigger.closest<HTMLElement>(".accordion-item")!;
        document
          .querySelectorAll<HTMLElement>(".accordion-item")
          .forEach((item) => {
            const open = item === selected;
            item.classList.toggle("is-open", open);
            const button =
              item.querySelector<HTMLButtonElement>(".accordion-trigger")!;
            button.setAttribute("aria-expanded", String(open));
            const glyph = button.querySelector<HTMLElement>("i");
            if (glyph) glyph.textContent = open ? "−" : "+";
            item.querySelector<HTMLElement>(".accordion-body")!.hidden = !open;
          });
      }),
    );
}

function metricOptions(selected: string) {
  const option = (metric: (typeof METRIC_DEFINITIONS)[number]) =>
    '<option value="' +
    metric.id +
    '"' +
    (metric.id === selected ? " selected" : "") +
    ">" +
    metric.label +
    "</option>";
  const breathing = METRIC_DEFINITIONS.filter(
    (metric) => metric.id === "breathing_volume",
  );
  const heart = METRIC_DEFINITIONS.filter(
    (metric) => !["manual", "breathing_volume"].includes(metric.id),
  );
  const manual = METRIC_DEFINITIONS.filter((metric) => metric.id === "manual");
  return (
    '<optgroup label="Breathing · Polar ACC">' +
    breathing.map(option).join("") +
    '</optgroup><optgroup label="Heart · ECG / HR / RR">' +
    heart.map(option).join("") +
    '</optgroup><optgroup label="Other">' +
    manual.map(option).join("") +
    "</optgroup>"
  );
}

function mappingMarkup(command: ContinuousCommand) {
  const value = mappings[command];
  const output = command === "altitude" ? "+0.00" : "50%";
  const familySelector =
    command === "altitude"
      ? '<div class="biosignal-family-selector" role="group" aria-label="Altitude control signal family"><button type="button" class="biosignal-family-button" data-signal-family="heart" aria-pressed="' +
        String(value.metric !== "breathing_volume") +
        '"><span class="biosignal-family-icon heart" aria-hidden="true">♥</span><span><strong>HEART CONTROL</strong><small>ECG, heart rate, RR or excitement</small></span></button><button type="button" class="biosignal-family-button" data-signal-family="breath" aria-pressed="' +
        String(value.metric === "breathing_volume") +
        '"><span class="biosignal-family-icon breath" aria-hidden="true"><i></i><i></i><i></i></span><span><strong>BREATH CONTROL</strong><small>Polar ACC chest-motion waveform</small></span></button></div>'
      : "";
  return (
    '<fieldset class="mapping-card" data-command="' +
    command +
    '"><legend class="visually-hidden">' +
    COMMAND_LABELS[command] +
    '</legend><div class="mapping-head"><strong>' +
    COMMAND_LABELS[command] +
    '</strong><output data-output>' +
    output +
    "</output></div>" +
    familySelector +
    '<div class="mapping-grid"><label class="wide">Signal<select data-field="metric">' +
    metricOptions(value.metric) +
    '</select></label><label>Fixed minimum<input data-field="minimum" type="number" step="any" value="' +
    value.minimum +
    '"></label><label>Fixed maximum<input data-field="maximum" type="number" step="any" value="' +
    value.maximum +
    '"></label><label>Attack (ms)<input data-field="attackMs" type="number" min="0" max="5000" value="' +
    value.attackMs +
    '"></label><label>Release (ms)<input data-field="releaseMs" type="number" min="0" max="5000" value="' +
    value.releaseMs +
    '"></label><label class="wide field manual-field">Manual value <input data-field="manual" type="range" min="0" max="1" step=".01" value="' +
    value.manual +
    '"></label><label class="wide check-row"><input data-field="reverse" type="checkbox"' +
    (value.reverse ? " checked" : "") +
    '><span>Reverse this command</span></label><div class="binding-preview"><i data-preview></i></div></div></fieldset>'
  );
}

function renderMappings() {
  const host = element("mapping-controls");
  host.innerHTML =
    COMMANDS.map(mappingMarkup).join("") +
    '<fieldset class="mapping-card beat-map"><legend class="visually-hidden">Heartbeat action</legend><div class="mapping-head"><strong>Heartbeat action</strong><output data-beat-output>PULSE</output></div><div class="mapping-grid"><label>Beat timing source<select id="beat-source"><option value="ecg-rpeak">ECG R-peak · experimental</option><option value="polar-rr">Polar RR notification</option><option value="off">Off</option></select></label><label>Game action<select id="beat-action"><option value="pulse">Visual + engine pulse</option><option value="lift">Heartbeat lift</option><option value="off">Off</option></select></label><p class="fine-print wide">Polar RR notifications may contain batched intervals and are not guaranteed to arrive at the exact beat. ECG R-peak timing is causal and experimental.</p></div></fieldset>';
  element<HTMLSelectElement>("beat-source").value = mappings.beatSource;
  element<HTMLSelectElement>("beat-action").value = mappings.beatAction;
  host
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      '[data-field]:not([data-field="metric"])',
    )
    .forEach((input) =>
      input.addEventListener("input", () => updateMappingsFromUi()),
    );
  host
    .querySelectorAll<HTMLSelectElement>('[data-field="metric"]')
    .forEach((input) =>
      input.addEventListener("change", () => updateMappingsFromUi(true)),
    );
  element("beat-source").addEventListener("change", () =>
    updateMappingsFromUi(),
  );
  element("beat-action").addEventListener("change", () =>
    updateMappingsFromUi(),
  );
  host.querySelectorAll<HTMLButtonElement>("[data-signal-family]").forEach(
    (button) =>
      button.addEventListener("click", () => {
        const nextMetric: MetricId =
          button.dataset.signalFamily === "breath"
            ? "breathing_volume"
            : mappings.altitude.metric === "breathing_volume" ||
                mappings.altitude.metric === "manual"
              ? "excitement_score"
              : mappings.altitude.metric;
        const select = host.querySelector<HTMLSelectElement>(
          '[data-command="altitude"] [data-field="metric"]',
        )!;
        select.value = nextMetric;
        updateMappingsFromUi(true);
      }),
  );
  element<HTMLInputElement>("adaptive-normalization").checked =
    mappings.altitude.normalization?.mode === "adaptive";
  syncMappingAvailability();
}

function updateMappingsFromUi(resetMetricDefaults = false) {
  const draft = structuredClone(mappings);
  let metricChanged = false;
  document.querySelectorAll<HTMLElement>("[data-command]").forEach((card) => {
    const command = card.dataset.command as ContinuousCommand;
    const get = (name: string) =>
      card.querySelector<HTMLInputElement | HTMLSelectElement>(
        '[data-field="' + name + '"]',
      )!;
    const metric = get("metric").value as MetricId;
    const old = draft[command];
    const changed = metric !== old.metric;
    const base =
      changed && resetMetricDefaults ? resetBindingMetric(old, metric) : old;
    draft[command] = {
      ...base,
      metric,
      minimum:
        changed && resetMetricDefaults
          ? base.minimum
          : Number(get("minimum").value),
      maximum:
        changed && resetMetricDefaults
          ? base.maximum
          : Number(get("maximum").value),
      attackMs: Number(get("attackMs").value),
      releaseMs: Number(get("releaseMs").value),
      manual: Number(get("manual").value),
      reverse: (get("reverse") as HTMLInputElement).checked,
    };
    metricChanged ||= changed;
  });
  draft.beatSource = element<HTMLSelectElement>("beat-source")
    .value as FlightMappings["beatSource"];
  draft.beatAction = element<HTMLSelectElement>("beat-action")
    .value as FlightMappings["beatAction"];
  mappings = sanitizeMappings(draft);
  if (metricChanged) adaptiveRange.reset();
  saveMappings();
  if (metricChanged) renderMappings();
  else syncMappingAvailability();
}

function remoteIsLegacy() {
  const state = receiver.snapshot();
  return Boolean(
    sourceMode === "beacon" &&
      state.config &&
      state.latest &&
      !state.beacon.config,
  );
}

function syncMappingAvailability() {
  const broadcastLocked = broadcaster.snapshot().phase === "broadcasting";
  const sourceMapped = remoteIsLegacy();
  document.querySelectorAll<HTMLElement>("[data-command]").forEach((card) => {
    const command = card.dataset.command as ContinuousCommand;
    const binding = mappings[command];
    const adaptive =
      command === "altitude" &&
      binding.normalization?.mode === "adaptive";
    card
      .querySelectorAll<HTMLInputElement>(".manual-field input")
      .forEach(
        (input) =>
          (input.disabled =
            broadcastLocked || sourceMapped || binding.metric !== "manual"),
      );
    card
      .querySelectorAll<HTMLInputElement>(
        '[data-field="minimum"],[data-field="maximum"]',
      )
      .forEach(
        (input) =>
          (input.disabled =
            broadcastLocked ||
            sourceMapped ||
            binding.metric === "manual" ||
            adaptive),
      );
    card
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>(
        '[data-field="metric"],[data-field="attackMs"],[data-field="releaseMs"],[data-field="reverse"]',
      )
      .forEach(
        (input) => (input.disabled = broadcastLocked || sourceMapped),
      );
    card
      .querySelectorAll<HTMLButtonElement>("[data-signal-family]")
      .forEach((button) => {
        button.disabled = broadcastLocked || sourceMapped;
        const isBreath = binding.metric === "breathing_volume";
        button.setAttribute(
          "aria-pressed",
          String(
            button.dataset.signalFamily === "breath" ? isBreath : !isBreath,
          ),
        );
      });
    if (command === "altitude")
      card.toggleAttribute("data-beat-lift", mappings.beatAction === "lift");
  });
  const locked = broadcastLocked || sourceMapped;
  element<HTMLInputElement>("import-settings").disabled = locked;
  const beatSource = element<HTMLSelectElement>("beat-source");
  const beatAction = element<HTMLSelectElement>("beat-action");
  beatSource.disabled = locked;
  beatAction.value = mappings.beatAction;
  beatAction.disabled = locked || mappings.beatSource === "off";
  const adaptive = element<HTMLInputElement>("adaptive-normalization");
  adaptive.checked =
    mappings.altitude.normalization?.mode === "adaptive";
  adaptive.disabled =
    locked ||
    mappings.altitude.metric === "manual" ||
    mappings.beatAction === "lift";
  setText(
    "beat-source-state",
    mappings.beatSource.replace("-", " ").toUpperCase() +
      " · " +
      mappings.beatAction.toUpperCase(),
  );
  syncSourcePanels();
}

function syncSourcePanels() {
  const polarSelected = sourceMode === "polar";
  element<HTMLInputElement>("signal-source-polar").checked = polarSelected;
  element<HTMLInputElement>("signal-source-beacon").checked = !polarSelected;
  element("polar-source-controls").hidden = !polarSelected;
  element("beacon-source-controls").hidden = polarSelected;
  element<HTMLButtonElement>("start-broadcast").disabled =
    !polarSelected || broadcaster.snapshot().phase === "broadcasting";
}

function pulseRadar() {
  const pulse = document.querySelector<HTMLElement>(".radar-beat");
  if (!pulse) return;
  pulse.classList.remove("pulse");
  requestAnimationFrame(() => pulse.classList.add("pulse"));
}

function drawTrace(values: number[], remote: boolean) {
  const canvas = element<HTMLCanvasElement>("ecg-preview");
  const context = canvas.getContext("2d");
  if (!context) return;
  const width = canvas.width;
  const height = canvas.height;
  context.clearRect(0, 0, width, height);
  if (values.length < 2) return;
  let center = 0.5;
  let halfRange = 0.5;
  if (!remote) {
    const sorted = [...values].sort((a, b) => a - b);
    const low = sorted[Math.floor((sorted.length - 1) * 0.02)] ?? 0;
    const high = sorted[Math.floor((sorted.length - 1) * 0.98)] ?? 0;
    center = (low + high) / 2;
    halfRange = Math.max(50, (high - low) / 2);
  }
  context.strokeStyle = remote ? "#f4b33a" : "#69d4de";
  context.lineWidth = remote ? 2.5 : 2;
  context.shadowColor = context.strokeStyle;
  context.shadowBlur = 8;
  context.beginPath();
  values.forEach((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const normalized = remote
      ? clamp(value)
      : clamp((value - center) / (halfRange * 2) + 0.5, 0.04, 0.96);
    const y = height - normalized * height;
    if (index) context.lineTo(x, y);
    else context.moveTo(x, y);
  });
  context.stroke();
  context.shadowBlur = 0;
  const latest = values[values.length - 1]!;
  const latestNormalized = remote
    ? clamp(latest)
    : clamp((latest - center) / (halfRange * 2) + 0.5, 0.04, 0.96);
  context.fillStyle = remote ? "#ffd15a" : "#dffcff";
  context.beginPath();
  context.arc(width - 3, height - latestNormalized * height, 3, 0, Math.PI * 2);
  context.fill();
}

function showMetric(values: Record<string, number>, id: string, digits = 0) {
  const value = values[id];
  setText(
    "metric-" + id,
    Number.isFinite(value) ? value.toFixed(digits) : "--",
  );
}

function updateSignalScope(active: ActiveSignal) {
  const remote = sourceMode === "beacon";
  setText("ecg-display-mode", remote ? "REMOTE BEACON" : "LOCAL SENSOR");
  setText(
    "ecg-display-state",
    remote
      ? active.phase === "live"
        ? "DERIVED TELEMETRY LIVE"
        : "WAITING FOR BEACON"
      : ecgReady
        ? "ECG WAVEFORM LIVE"
        : "WAITING FOR POLAR",
  );
  showMetric(active.metrics, "heart_rate");
  showMetric(active.metrics, "rr_interval");
  showMetric(active.metrics, "excitement_score", 2);
  showMetric(active.metrics, "breathing_volume", 2);
  if (remote) {
    setText("ecg-rate", "NET");
    drawTrace(remoteTrace, true);
  } else {
    drawTrace(ecgSamples, false);
  }
}

function observeMetrics(
  values: Record<string, number>,
  observedAt: number,
  sourceSession: string,
) {
  if (!sourceSession) return;
  adaptiveRange.startSession(sourceSession);
  for (const binding of COMMANDS.map((command) => mappings[command])) {
    if (binding.metric === "manual") continue;
    const normalization =
      binding.normalization ?? defaultNormalizationConfig(binding.metric);
    adaptiveRange.observe(
      binding.metric,
      values[binding.metric],
      normalization,
      observedAt,
    );
  }
}

function registerBeat(
  source: "ecg-rpeak" | "polar-rr",
  confidence: number,
  at = performance.now(),
) {
  if (source === "ecg-rpeak") {
    ecgBeatCounter = (ecgBeatCounter + 1) >>> 0;
    lastEcgBeatAt = at;
    detectorConfidence = confidence;
  } else {
    rrBeatCounter = (rrBeatCounter + 1) >>> 0;
    lastRrBeatAt = at;
    rrBeatQuality = confidence;
  }
  if (mappings.beatSource !== source || mappings.beatAction === "off") return;
  pulseRadar();
  if (element<HTMLInputElement>("ground-log-enabled").checked)
    log.add({
      event: "beat",
      source,
      beat_counter:
        source === "ecg-rpeak" ? ecgBeatCounter : rrBeatCounter,
      confidence,
    });
}

function handlePolarEvent(event: any) {
  const now = performance.now();
  if (event.kind === "status") {
    setText("polar-state", "Connecting");
    setText("polar-detail", event.message ?? "Working…");
  }
  if (event.kind === "connection") {
    const wasConnected = physicalConnected;
    physicalConnected = event.connected === true;
    ecgReady =
      physicalConnected &&
      Number(event.streamHealth?.observedSampleRateHz) >= 110;
    if (physicalConnected && !wasConnected) {
      polarSessionId = sessionId("polar");
      adaptiveRange.startSession(polarSessionId);
    }
    if (!physicalConnected) {
      ecgReady = false;
      breathingReady = false;
      lastPolarSignalAt = -Infinity;
      lastBreathingSignalAt = -Infinity;
    }
    setText(
      "polar-state",
      physicalConnected ? "Polar H10 live" : "Disconnected",
    );
    setText("polar-detail", event.message ?? "");
    element<HTMLButtonElement>("connect-polar").disabled = physicalConnected;
    element<HTMLButtonElement>("disconnect-polar").disabled =
      !physicalConnected;
  }
  if (event.kind === "metrics") {
    Object.assign(polarMetrics, event.snapshot?.values ?? {});
    if (event.snapshot?.breathing) {
      breathingReady = event.snapshot.breathing.ready === true;
      polarMetrics.breathing_signal_ready = breathingReady ? 1 : 0;
      polarMetrics.breathing_signal_confidence = Number(
        event.snapshot.breathing.diagnostics?.confidence01 ?? 0,
      );
    }
    if (sourceMode === "polar" && !simulated)
      observeMetrics(polarMetrics, now, polarSessionId);
  }
  if (event.kind === "heart-rate") {
    for (const rr of event.rrIntervalsMs ?? []) {
      detector.setReferenceRr(rr);
      registerBeat("polar-rr", 0.75, now);
    }
  }
  if (event.kind === "ecg") {
    ecgReady = true;
    lastPolarSignalAt = now;
    const samples = event.microvolts ?? [];
    ecgSamples.push(...samples);
    if (ecgSamples.length > 650)
      ecgSamples.splice(0, ecgSamples.length - 650);
    setText(
      "ecg-rate",
      Number(event.streamHealth?.observedSampleRateHz ?? 130).toFixed(0),
    );
    for (const beat of detector.pushFrame(samples, event.sensorTimestampNs)) {
      detectorConfidence = beat.confidence;
      if (detector.ready)
        registerBeat("ecg-rpeak", beat.confidence, performance.now());
    }
    if (sourceMode === "polar") drawTrace(ecgSamples, false);
  }
  if (event.kind === "accelerometer") {
    lastBreathingSignalAt = now;
    breathingReady = event.breathing?.ready === true;
  }
  if (event.kind === "warning") {
    setText("polar-detail", event.message ?? "Optional Polar signal unavailable");
  }
  if (event.kind === "error") {
    setText("polar-state", "Signal error");
    setText("polar-detail", event.message ?? "Unknown Polar error");
  }
}

async function connectPolar() {
  const support = polarWebBluetoothSupport();
  if (!support.supported) {
    setText("polar-state", "Unsupported browser");
    setText("polar-detail", support.reason);
    return;
  }
  simulated = false;
  element<HTMLInputElement>("sim-enabled").checked = false;
  for (const key of Object.keys(polarMetrics)) delete polarMetrics[key];
  ecgSamples.length = 0;
  breathingReady = false;
  lastBreathingSignalAt = -Infinity;
  detector.reset();
  ecgBeatCounter = 0;
  rrBeatCounter = 0;
  lastEcgBeatAt = -Infinity;
  lastRrBeatAt = -Infinity;
  try {
    await polar.connect(handlePolarEvent);
  } catch (error) {
    setText("polar-state", "Connection failed");
    setText(
      "polar-detail",
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function disconnectPolar() {
  await polar.disconnect();
  physicalConnected = false;
  ecgReady = false;
  breathingReady = false;
  lastPolarSignalAt = -Infinity;
  lastBreathingSignalAt = -Infinity;
  detector.reset();
  if (sourceMode === "polar") adaptiveRange.startSession("");
}

function simulatedSignals(now: number) {
  if (!simulated || sourceMode !== "polar") return;
  const bpm = Number(element<HTMLInputElement>("sim-bpm").value);
  const excitement = Number(element<HTMLInputElement>("sim-excite").value);
  polarMetrics.heart_rate = bpm;
  polarMetrics.rr_interval = 60_000 / bpm;
  polarMetrics.excitement_score = excitement;
  polarMetrics.excitometer = clamp(excitement * 0.85 + 0.08);
  polarMetrics.breathing_volume = Number(
    element<HTMLInputElement>("sim-breath").value,
  );
  polarMetrics.breathing_signal_ready = 1;
  if (!simulationSessionId) simulationSessionId = sessionId("simulation");
  observeMetrics(polarMetrics, now, simulationSessionId);
  if (now >= simNextBeat) {
    simNextBeat = now + 60_000 / bpm;
    registerBeat("polar-rr", 1, now);
    registerBeat("ecg-rpeak", 1, now);
  }
}

function activeSignal(now: number): ActiveSignal {
  if (sourceMode === "polar") {
    if (simulated)
      return {
        source: "simulation",
        phase: "live",
        sessionId: simulationSessionId,
        sourceLabel: "SIMULATED TEST SIGNAL",
        lastSignalAt: now,
        physicalPolar: false,
        simulation: true,
        remoteConfigReady: false,
        metrics: polarMetrics,
        ecgBeatCounter,
        rrBeatCounter,
        ecgBeatAgeMs: ageSince(lastEcgBeatAt, now),
        rrBeatAgeMs: ageSince(lastRrBeatAt, now),
        ecgBeatQuality: 1,
        rrBeatQuality: 1,
        ecgBeatReady: true,
        rrBeatReady: true,
        breathingReady: true,
        route: "local",
      };
    return {
      source: "polar-direct",
      phase: physicalConnected && ecgReady ? "live" : "idle",
      sessionId: polarSessionId,
      sourceLabel: "POLAR H10 · LOCAL",
      lastSignalAt: Number.isFinite(lastPolarSignalAt)
        ? lastPolarSignalAt
        : undefined,
      physicalPolar: physicalConnected,
      simulation: false,
      remoteConfigReady: false,
      metrics: polarMetrics,
      ecgBeatCounter,
      rrBeatCounter,
      ecgBeatAgeMs: ageSince(lastEcgBeatAt, now),
      rrBeatAgeMs: ageSince(lastRrBeatAt, now),
      ecgBeatQuality: detectorConfidence,
      rrBeatQuality,
      ecgBeatReady: detector.ready,
      rrBeatReady: Number.isFinite(polarMetrics.rr_interval),
      breathingReady:
        breathingReady && ageSince(lastBreathingSignalAt, now) <= 2_000,
      route: "local",
    };
  }

  const state = receiver.snapshot(now);
  const beacon = state.beacon.latest;
  if (state.beacon.config && beacon) {
    const flags = beacon.flags;
    return {
      source: "remote-beacon",
      phase: state.beacon.phase,
      sessionId: state.beacon.config.sessionId,
      sourceLabel: state.sourceLabel || "REMOTE GROUND CONTROL",
      lastSignalAt: beacon.receivedAt,
      physicalPolar: Boolean(flags & SignalBeaconFlags.physicalPolar),
      simulation: Boolean(flags & SignalBeaconFlags.simulation),
      remoteConfigReady: true,
      metrics: { ...beacon.metrics } as Record<string, number>,
      ecgBeatCounter: beacon.ecgBeatCounter,
      rrBeatCounter: beacon.rrBeatCounter,
      ecgBeatAgeMs: beacon.ecgBeatAgeMs,
      rrBeatAgeMs: beacon.rrBeatAgeMs,
      ecgBeatQuality: beacon.ecgBeatQuality,
      rrBeatQuality: beacon.rrBeatQuality,
      ecgBeatReady: Boolean(
        flags & SignalBeaconFlags.ecgBeatDetectorReady,
      ),
      rrBeatReady: Boolean(flags & SignalBeaconFlags.rrStreamReady),
      breathingReady: Boolean(flags & SignalBeaconFlags.accBreathingReady),
      route: state.route,
      latencyMs: state.rttMs,
    };
  }
  const frame = state.latest;
  return {
    source: "remote-beacon",
    phase: state.phase,
    sessionId: state.config?.sessionId ?? "",
    sourceLabel: state.sourceLabel || "REMOTE GROUND CONTROL",
    lastSignalAt: frame?.receivedAt,
    physicalPolar: Boolean(
      (frame?.flags ?? 0) & FlightFlags.physicalPolar,
    ),
    simulation: Boolean((frame?.flags ?? 0) & FlightFlags.simulation),
    remoteConfigReady: Boolean(state.config),
    metrics: {},
    ecgBeatCounter: frame?.beatCounter ?? 0,
    rrBeatCounter: frame?.beatCounter ?? 0,
    ecgBeatAgeMs: frame?.beatAgeMs ?? 999_999,
    rrBeatAgeMs: frame?.beatAgeMs ?? 999_999,
    ecgBeatQuality: frame?.quality ?? 0,
    rrBeatQuality: frame?.quality ?? 0,
    ecgBeatReady: Boolean(
      (frame?.flags ?? 0) & FlightFlags.beatDetectorReady,
    ),
    rrBeatReady: Boolean(frame),
    breathingReady: false,
    route: state.route,
    latencyMs: state.rttMs,
    legacyFrame: frame,
  };
}

function selectedBeat(active: ActiveSignal) {
  if (mappings.beatSource === "polar-rr")
    return {
      counter: active.rrBeatCounter,
      ageMs: active.rrBeatAgeMs,
      quality: active.rrBeatQuality,
      ready: active.rrBeatReady,
    };
  if (mappings.beatSource === "ecg-rpeak")
    return {
      counter: active.ecgBeatCounter,
      ageMs: active.ecgBeatAgeMs,
      quality: active.ecgBeatQuality,
      ready: active.ecgBeatReady,
    };
  return { counter: 0, ageMs: 999_999, quality: 0, ready: true };
}

function adaptiveMappingsReady() {
  for (const command of COMMANDS) {
    if (command === "altitude" && mappings.beatAction === "lift") continue;
    const binding = mappings[command];
    if (
      binding.metric === "manual" ||
      binding.normalization?.mode !== "adaptive"
    )
      continue;
    if (!adaptiveRange.snapshot(binding.metric, binding.normalization).ready)
      return false;
  }
  return true;
}

function computeRuntime(now: number, delta: number): RuntimeState {
  const active = activeSignal(now);
  if (active.legacyFrame) {
    const frame = { ...active.legacyFrame };
    const senderReady = Boolean(frame.flags & FlightFlags.controlReady);
    const readiness = flightLaunchReadiness({
      source: active.source,
      phase: active.phase,
      nowMs: now,
      lastSignalAtMs: active.lastSignalAt,
      physicalPolar: active.physicalPolar,
      simulation: active.simulation,
      remoteConfigReady: active.remoteConfigReady,
      metricReady: senderReady,
      normalizationReady: senderReady,
      beatReady: senderReady,
      aircraftReady: cockpit.aircraftIsReady(),
    });
    return {
      active,
      frame,
      readiness,
      commandsValid: senderReady,
      normalizationReady: senderReady,
      beatReady: senderReady,
      signalLabel:
        stateMetricLabel(receiver.snapshot().config?.mappings.altitude.metric) ??
        "REMOTE LIFT",
    };
  }

  const beat = selectedBeat(active);
  let commandsValid = true;
  for (const command of COMMANDS) {
    let target: number | undefined;
    if (command === "altitude" && mappings.beatAction === "lift")
      target = beat.ready
        ? beat.ageMs < 420
          ? 1 - beat.ageMs / 420
          : -0.18
        : undefined;
    else if (
      mappings[command].metric === "breathing_volume" &&
      !active.breathingReady
    )
      target = undefined;
    else
      target = commandValue(command, active.metrics, mappings, adaptiveRange);
    if (target === undefined) {
      commandsValid = false;
      target = latestCommands[command];
    }
    latestCommands[command] = smoothers[command].update(
      target,
      delta,
      mappings[command].attackMs,
      mappings[command].releaseMs,
    );
  }
  const normalizationReady = adaptiveMappingsReady();
  const beatReady = mappings.beatAction === "off" || beat.ready;
  const signalFresh =
    active.lastSignalAt !== undefined &&
    now - active.lastSignalAt >= 0 &&
    now - active.lastSignalAt <= 2_000;
  const controlsReady =
    active.phase === "live" &&
    signalFresh &&
    (active.physicalPolar || active.simulation) &&
    commandsValid &&
    normalizationReady &&
    beatReady;
  const flags =
    (controlsReady ? FlightFlags.controlReady : 0) |
    (active.physicalPolar ? FlightFlags.physicalPolar : 0) |
    (active.ecgBeatReady ? FlightFlags.beatDetectorReady : 0) |
    (active.simulation ? FlightFlags.simulation : 0);
  localSequence = (localSequence + 1) >>> 0;
  const frame: FlightFrame = {
    sequence: localSequence,
    ...latestCommands,
    beatCounter: beat.counter,
    beatAgeMs: beat.ageMs,
    quality: active.simulation
      ? 1
      : clamp(beat.quality || (ecgReady ? 0.6 : 0)),
    flags,
  };
  const readiness = flightLaunchReadiness({
    source: active.source,
    phase: active.phase,
    nowMs: now,
    lastSignalAtMs: active.lastSignalAt,
    physicalPolar: active.physicalPolar,
    simulation: active.simulation,
    remoteConfigReady: active.remoteConfigReady,
    metricReady: commandsValid,
    normalizationReady,
    beatReady,
    aircraftReady: cockpit.aircraftIsReady(),
  });
  return {
    active,
    frame,
    readiness,
    commandsValid,
    normalizationReady,
    beatReady,
    signalLabel: stateMetricLabel(mappings.altitude.metric) ?? "LIFT INPUT",
  };
}

function localBeaconOffer(now: number): SignalBeaconOffer {
  const metrics: SignalBeaconOffer["metrics"] = {};
  const physicalSignalFresh =
    physicalConnected && ageSince(lastPolarSignalAt, now) <= 2_000;
  const breathingSignalFresh =
    physicalConnected &&
    breathingReady &&
    ageSince(lastBreathingSignalAt, now) <= 2_000;
  if (physicalSignalFresh || simulated)
    for (const metric of SIGNAL_BEACON_METRICS) {
      const value = polarMetrics[metric];
      if (Number.isFinite(value)) metrics[metric] = value;
    }
  const flags =
    (physicalSignalFresh ? SignalBeaconFlags.physicalPolar : 0) |
    (simulated ? SignalBeaconFlags.simulation : 0) |
    (physicalSignalFresh && ecgReady
      ? SignalBeaconFlags.ecgStreamReady
      : 0) |
    (physicalSignalFresh && detector.ready
      ? SignalBeaconFlags.ecgBeatDetectorReady
      : 0) |
    (physicalSignalFresh && Number.isFinite(polarMetrics.rr_interval)
      ? SignalBeaconFlags.rrStreamReady
      : 0) |
    (breathingSignalFresh ? SignalBeaconFlags.accBreathingReady : 0);
  return {
    metrics,
    ecgBeatCounter,
    rrBeatCounter,
    ecgBeatAgeMs: ageSince(lastEcgBeatAt, now),
    rrBeatAgeMs: ageSince(lastRrBeatAt, now),
    ecgBeatQuality: clamp(detectorConfidence),
    rrBeatQuality: clamp(rrBeatQuality),
    flags,
  };
}

function offerBroadcast(runtime: RuntimeState, now: number) {
  if (sourceMode !== "polar") return;
  const frame = runtime.frame;
  broadcaster.offer(
    {
      beatCounter: frame.beatCounter,
      altitude: frame.altitude,
      throttle: frame.throttle,
      traffic: frame.traffic,
      beatAgeMs: frame.beatAgeMs,
      quality: frame.quality,
      flags: frame.flags,
    },
    now,
  );
  broadcaster.offerBeacon(localBeaconOffer(now), now);
}

function gateReason(readiness: FlightLaunchReadiness) {
  const reason = readiness.reasons[0];
  const messages: Record<string, string> = {
    "source-not-live":
      sourceMode === "beacon"
        ? "Select a beacon that is transmitting live telemetry."
        : "Connect a worn Polar H10 and wait for live ECG.",
    "remote-config-missing":
      "The selected beacon has not supplied a valid signal configuration.",
    "signal-missing": "No fresh selected body signal has arrived yet.",
    "signal-stale": "The selected body signal is stale. Flight remains on hold.",
    "physical-polar-missing":
      "Flight requires a physical Polar signal, not connection metadata alone.",
    "simulation-rejected":
      "Simulation can preview controls but cannot unlock the real flight.",
    "metric-not-ready":
      mappings.altitude.metric === "breathing_volume"
        ? "Breathing control is calibrating. Keep the H10 snug and breathe normally for about 12 seconds."
        : "The selected heart metric is not available from this signal.",
    "normalization-not-ready":
      "Adaptive range is still learning a usable personal minimum and maximum.",
    "beat-not-ready":
      "The selected heartbeat timing source is not ready yet.",
    "aircraft-not-ready": "The selected aircraft is still loading.",
  };
  return reason
    ? messages[reason] ?? "Complete Ground Control readiness before flight."
    : "Fresh physical body-signal control is ready. Runway clearance granted.";
}

function setGateRow(id: string, ready: boolean, value: string) {
  const row = element(id);
  row.classList.toggle("is-ready", ready);
  const output = row.querySelector<HTMLElement>("b");
  if (output) output.textContent = ready ? value : "WAIT";
}

function updateAdaptiveUi(runtime: RuntimeState) {
  const binding = mappings.altitude;
  setText(
    "adaptive-range-value",
    clamp((runtime.frame.altitude + 1) / 2).toFixed(2),
  );
  const reset = element<HTMLButtonElement>("reset-adaptive-range");
  if (remoteIsLegacy()) {
    setText("adaptive-range-min", "REMOTE");
    setText("adaptive-range-max", "REMOTE");
    setText("adaptive-range-state", "SOURCE-MAPPED LEGACY COMMANDS");
    reset.disabled = true;
    return;
  }
  const normalization =
    binding.normalization ?? defaultNormalizationConfig(binding.metric);
  if (normalization.mode !== "adaptive" || binding.metric === "manual") {
    setText("adaptive-range-min", String(binding.minimum));
    setText("adaptive-range-max", String(binding.maximum));
    setText("adaptive-range-state", "FIXED RANGE ACTIVE");
    reset.disabled = true;
    return;
  }
  const snapshot = adaptiveRange.snapshot(
    binding.metric as DerivedMetricId,
    normalization,
  );
  const digits =
    binding.metric === "excitement_score" ||
    binding.metric === "excitometer" ||
    binding.metric === "ln_rmssd"
      ? 2
      : 0;
  setText(
    "adaptive-range-min",
    snapshot.observedMinimum === undefined
      ? "—"
      : snapshot.observedMinimum.toFixed(digits),
  );
  setText(
    "adaptive-range-max",
    snapshot.observedMaximum === undefined
      ? "—"
      : snapshot.observedMaximum.toFixed(digits),
  );
  setText(
    "adaptive-range-state",
    snapshot.ready
      ? "PERSONAL RANGE LIVE · " + snapshot.sampleCount + " SAMPLES"
      : "CALIBRATING · " +
          snapshot.sampleCount +
          "/" +
          normalization.minimumSamples +
          " SAMPLES · NEED SPAN " +
          normalization.minimumSpan,
  );
  reset.disabled = snapshot.sampleCount === 0;
}

function updateCommandPreview(runtime: RuntimeState) {
  const frame = runtime.frame;
  setText(
    "command-altitude",
    (frame.altitude >= 0 ? "+" : "") + frame.altitude.toFixed(2),
  );
  setText("command-throttle", Math.round(frame.throttle * 100) + "%");
  setText("command-traffic", Math.round(frame.traffic * 100) + "%");
  setText("command-beat", frame.beatCounter.toString().padStart(6, "0"));
  element<HTMLMeterElement>("command-altitude-meter").value = frame.altitude;
  element<HTMLMeterElement>("command-throttle-meter").value = frame.throttle;
  element<HTMLMeterElement>("command-traffic-meter").value = frame.traffic;
  document.querySelectorAll<HTMLElement>("[data-command]").forEach((card) => {
    const command = card.dataset.command as ContinuousCommand;
    const value = frame[command];
    const output = card.querySelector<HTMLOutputElement>("output");
    const preview = card.querySelector<HTMLElement>("[data-preview]");
    if (output)
      output.textContent =
        command === "altitude"
          ? (value >= 0 ? "+" : "") + value.toFixed(2)
          : Math.round(value * 100) + "%";
    if (preview)
      preview.style.width =
        (command === "altitude" ? (value + 1) * 50 : value * 100) + "%";
  });
  if (
    frame.beatCounter !== lastGroundBeatCounter &&
    frame.beatAgeMs <= 250
  ) {
    lastGroundBeatCounter = frame.beatCounter;
    pulseRadar();
  } else if (frame.beatCounter !== lastGroundBeatCounter) {
    lastGroundBeatCounter = frame.beatCounter;
  }

  const selectedSource =
    sourceMode === "polar"
      ? physicalConnected && !simulated
      : Boolean(receiver.snapshot().selectedStreamId);
  const freshPhysical =
    runtime.active.phase === "live" &&
    runtime.active.physicalPolar &&
    !runtime.active.simulation &&
    runtime.readiness.signalAgeMs !== undefined &&
    runtime.readiness.signalAgeMs <= 2_000;
  const mappingReady =
    runtime.commandsValid && runtime.normalizationReady && runtime.beatReady;
  setGateRow(
    "flight-gate-source",
    selectedSource,
    sourceMode === "polar" ? "POLAR" : "BEACON",
  );
  setGateRow("flight-gate-signal", freshPhysical, "LIVE");
  setGateRow("flight-gate-mapping", mappingReady, "READY");
  element("flight-gate").classList.toggle(
    "is-ready",
    runtime.readiness.ready,
  );
  setText(
    "flight-gate-state",
    runtime.readiness.ready ? "CLEARED" : "SIGNAL HOLD",
  );
  element("flight-gate-state").classList.toggle(
    "is-ready",
    runtime.readiness.ready,
  );
  setText("flight-gate-copy", gateReason(runtime.readiness));
  element<HTMLButtonElement>("start-flight-from-ground").disabled =
    !runtime.readiness.ready;
  setText(
    "command-readiness",
    runtime.readiness.ready
      ? (sourceMode === "polar" ? "LOCAL POLAR" : "REMOTE BEACON") +
          " · CONTROL READY"
      : simulated
        ? "SIMULATION PREVIEW · REAL FLIGHT LOCKED"
        : "CONTROL HOLD · " + gateReason(runtime.readiness).toUpperCase(),
  );
  element("polar-header-dot").classList.toggle("is-live", freshPhysical);
  setText(
    "polar-header-state",
    freshPhysical
      ? sourceMode === "polar"
        ? "POLAR LIVE"
        : "BEACON LIVE"
      : simulated
        ? "SIMULATION · LOCKED"
        : "SIGNAL HOLD",
  );
  updateAdaptiveUi(runtime);
  updateSignalScope(runtime.active);
}

function cockpitTelemetry(runtime: RuntimeState): CockpitTelemetry {
  return {
    frame: runtime.frame,
    sourceLabel: runtime.active.sourceLabel,
    signalLabel: runtime.signalLabel,
    route: runtime.active.route,
    latencyMs: runtime.active.latencyMs,
    ready: runtime.readiness.ready,
    holdReason: gateReason(runtime.readiness),
  };
}

function frameSequence(frame: FlightFrame) {
  return frame.sequence >>> 0;
}

function loggingEnabled() {
  return (
    element<HTMLInputElement>("ground-log-enabled").checked ||
    element<HTMLInputElement>("cockpit-log-enabled").checked
  );
}

function syncLogButtons() {
  const disabled = log.size === 0;
  element<HTMLButtonElement>("ground-log-export").disabled = disabled;
  element<HTMLButtonElement>("cockpit-log-export").disabled = disabled;
}

function updateCommandLoop(now: number) {
  const delta = Math.min(100, Math.max(0, now - lastFrameAt));
  lastFrameAt = now;
  simulatedSignals(now);
  const runtime = computeRuntime(now, delta);
  latestRuntime = runtime;
  offerBroadcast(runtime, now);
  if (
    sourceMode === "beacon" &&
    runtime.active.lastSignalAt !== undefined &&
    runtime.active.lastSignalAt !== lastRemoteTraceAt
  ) {
    lastRemoteTraceAt = runtime.active.lastSignalAt;
    remoteTrace.push(clamp((runtime.frame.altitude + 1) / 2));
    if (remoteTrace.length > 240)
      remoteTrace.splice(0, remoteTrace.length - 240);
  }
  updateCommandPreview(runtime);
  if (cockpit.hasStarted()) cockpit.accept(cockpitTelemetry(runtime));

  if (loggingEnabled() && now - lastLoggedAt >= 100) {
    lastLoggedAt = now;
    log.add({
      event: "command",
      sequence: frameSequence(runtime.frame),
      source_id:
        sourceMode === "polar"
          ? broadcaster.snapshot().streamId
          : receiver.snapshot().selectedStreamId,
      session_id: runtime.active.sessionId,
      session_mode: runtime.active.source,
      heart_rate: runtime.active.metrics.heart_rate ?? "",
      rr_interval: runtime.active.metrics.rr_interval ?? "",
      excitement_score: runtime.active.metrics.excitement_score ?? "",
      breathing_volume: runtime.active.metrics.breathing_volume ?? "",
      altitude: runtime.frame.altitude,
      throttle: runtime.frame.throttle,
      traffic: runtime.frame.traffic,
      beat_counter: runtime.frame.beatCounter,
      flags: runtime.frame.flags,
    });
    syncLogButtons();
  }
  requestAnimationFrame(updateCommandLoop);
}

async function schedulingGuard(active: boolean) {
  if (!active) {
    try {
      await wakeLock?.release?.();
    } catch {}
    wakeLock = undefined;
    try {
      pipWindow?.close();
    } catch {}
    pipWindow = undefined;
    return;
  }
  try {
    wakeLock = await (navigator as any).wakeLock?.request?.("screen");
  } catch {}
  try {
    const api = (window as any).documentPictureInPicture;
    if (api?.requestWindow) {
      const pip = (await api.requestWindow({
        width: 320,
        height: 112,
      })) as Window;
      pipWindow = pip;
      const box = pip.document.createElement("div");
      box.style.cssText =
        "font:700 16px system-ui;padding:22px;color:#fff;background:#07131f;height:100%;box-sizing:border-box";
      box.textContent = "EC Gaming · Cardiac beacon active";
      pip.document.body.style.margin = "0";
      pip.document.body.append(box);
    }
  } catch {
    /* Optional foreground scheduling surface. */
  }
}

async function startBroadcast() {
  if (sourceMode !== "polar") {
    setText("broadcast-source", "Switch to Direct Polar first");
    return;
  }
  try {
    await broadcaster.start(mappings);
    syncMappingAvailability();
    element<HTMLButtonElement>("start-broadcast").disabled = true;
    element<HTMLButtonElement>("stop-broadcast").disabled = false;
    void schedulingGuard(true);
  } catch (error) {
    setText(
      "broadcast-source",
      error instanceof Error ? error.message : "Broadcast failed",
    );
  }
}

async function stopBroadcast() {
  await broadcaster.stop();
  syncMappingAvailability();
  element<HTMLButtonElement>("start-broadcast").disabled =
    sourceMode !== "polar";
  element<HTMLButtonElement>("stop-broadcast").disabled = true;
  void schedulingGuard(false);
}

function renderBeaconSources(state: FlightReceiverSnapshot) {
  const ownSource = broadcaster.snapshot().streamId;
  const sources = state.sources.filter(
    (source) => !ownSource || source.streamId !== ownSource,
  );
  const signature =
    sources
      .map((source) => source.streamId + ":" + source.uuid)
      .join("|") +
    "|" +
    state.selectedStreamId;
  if (signature !== sourceSignature) {
    sourceSignature = signature;
    const host = element("beacon-source-list");
    host.replaceChildren();
    if (!sources.length) {
      const empty = document.createElement("p");
      empty.textContent = "No beacons found yet.";
      host.append(empty);
    }
    for (const source of sources) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "beacon-source-button";
      button.classList.toggle(
        "is-selected",
        source.streamId === state.selectedStreamId,
      );
      const label = document.createElement("span");
      label.textContent = source.label;
      const action = document.createElement("strong");
      action.textContent =
        source.streamId === state.selectedStreamId ? "SELECTED" : "USE BEACON";
      button.append(label, action);
      button.addEventListener("click", async () => {
        adaptiveRange.startSession("");
        remoteTrace.length = 0;
        await receiver.selectSource(source.streamId);
      });
      host.append(button);
    }
  }
  const pips = [
    ...document.querySelectorAll<HTMLElement>("#beacon-radar .beacon-pip"),
  ];
  pips.forEach((pip, index) => {
    pip.classList.toggle("is-found", index < sources.length);
    pip.classList.toggle(
      "is-selected",
      sources[index]?.streamId === state.selectedStreamId,
    );
  });
  const live = state.beacon.fresh || state.phase === "live";
  setText(
    "beacon-radar-state",
    live
      ? "BEACON LOCK"
      : sources.length
        ? sources.length + " CONTACT" + (sources.length === 1 ? "" : "S")
        : state.phase === "discovering"
          ? "SCANNING"
          : "STANDBY",
  );
  setText(
    "beacon-radar-summary",
    state.selectedStreamId
      ? (state.sourceLabel || "Selected beacon") +
          (state.beacon.fresh
            ? " · derived heart telemetry live."
            : " · waiting for fresh telemetry.")
      : sources.length
        ? "Select a recognized beacon. Radar marks are not geographic positions."
        : "No incoming beacon selected. Radar marks are discovery icons, not geographic positions.",
  );
}

function updateBeaconState(state: FlightReceiverSnapshot, message?: string) {
  renderBeaconSources(state);
  const live = state.beacon.fresh || state.phase === "live";
  setText(
    "beacon-state",
    live
      ? state.beacon.fresh
        ? "Derived signal beacon live"
        : "Legacy command beacon live"
      : state.phase === "discovering"
        ? "Scanning public room"
        : state.phase === "connecting"
          ? "Connecting to beacon"
          : state.phase === "stale"
            ? "Beacon signal stale"
            : "Beacon receiver idle",
  );
  if (message) setText("beacon-detail", message);
  syncMappingAvailability();
}

async function scanBeacons() {
  element<HTMLButtonElement>("scan-beacons").disabled = true;
  element<HTMLButtonElement>("stop-beacon-scan").disabled = false;
  setText("beacon-state", "Scanning public room");
  try {
    await receiver.startDiscovery();
  } catch (error) {
    setText("beacon-state", "Beacon scan failed");
    setText(
      "beacon-detail",
      error instanceof Error ? error.message : String(error),
    );
    element<HTMLButtonElement>("scan-beacons").disabled = false;
    element<HTMLButtonElement>("stop-beacon-scan").disabled = true;
  }
}

async function stopBeaconScan() {
  await receiver.stop();
  element<HTMLButtonElement>("scan-beacons").disabled = false;
  element<HTMLButtonElement>("stop-beacon-scan").disabled = true;
  setText("beacon-state", "Beacon receiver idle");
  setText(
    "beacon-detail",
    "Scan the public room for another Ground Control station.",
  );
  remoteTrace.length = 0;
  adaptiveRange.startSession("");
}

async function selectSource(mode: SourceMode) {
  if (sourceMode === mode) {
    syncSourcePanels();
    return;
  }
  sourceMode = mode;
  localStorage.setItem(SOURCE_KEY, mode);
  adaptiveRange.startSession("");
  remoteTrace.length = 0;
  if (mode === "beacon") {
    await stopBroadcast();
  } else {
    await stopBeaconScan();
    adaptiveRange.startSession(
      simulated ? simulationSessionId : polarSessionId,
    );
  }
  syncMappingAvailability();
}

function showView(mode: "ground" | "cockpit", focus = true) {
  const showCockpit = mode === "cockpit";
  cockpit.setVisible(showCockpit);
  document.title = showCockpit
    ? "Cockpit · EC Gaming"
    : "Ground Control · EC Gaming";
  history.replaceState(
    null,
    "",
    location.pathname + (showCockpit ? "?view=cockpit" : ""),
  );
  if (showCockpit && !xrChecked) {
    xrChecked = true;
    void cockpit.immersiveSupported();
  }
  if (focus) {
    const heading = showCockpit
      ? element<HTMLElement>("cockpit-heading")
      : element<HTMLElement>("flight-gate-title");
    requestAnimationFrame(() => heading.focus({ preventScroll: true }));
  }
}

async function startCockpit() {
  const runtime = latestRuntime;
  if (!runtime?.readiness.ready) return;
  showView("cockpit");
  if (!(await cockpit.start(cockpitTelemetry(runtime)))) return;
  if (loggingEnabled()) {
    log.add({
      event: "start",
      source_id:
        sourceMode === "polar"
          ? broadcaster.snapshot().streamId
          : receiver.snapshot().selectedStreamId,
      session_id: runtime.active.sessionId,
      mode: "integrated-cockpit",
      aircraft: cockpit.currentAircraft(),
    });
    syncLogButtons();
  }
}

function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function setupActions() {
  element("connect-polar").addEventListener("click", () => void connectPolar());
  element("disconnect-polar").addEventListener(
    "click",
    () => void disconnectPolar(),
  );
  element<HTMLInputElement>("signal-source-polar").addEventListener(
    "change",
    () => void selectSource("polar"),
  );
  element<HTMLInputElement>("signal-source-beacon").addEventListener(
    "change",
    () => void selectSource("beacon"),
  );
  element("scan-beacons").addEventListener("click", () => void scanBeacons());
  element("stop-beacon-scan").addEventListener(
    "click",
    () => void stopBeaconScan(),
  );
  element("start-broadcast").addEventListener(
    "click",
    () => void startBroadcast(),
  );
  element("stop-broadcast").addEventListener(
    "click",
    () => void stopBroadcast(),
  );
  element("ground-view-toggle").addEventListener("click", () =>
    showView("ground"),
  );
  element("cockpit-view-toggle").addEventListener("click", () =>
    showView("cockpit"),
  );
  element("tower-open-cockpit").addEventListener("click", () =>
    showView("cockpit"),
  );
  element("start-flight-from-ground").addEventListener(
    "click",
    () => void startCockpit(),
  );
  cockpit.addEventListener("requestground", () => showView("ground"));
  cockpit.addEventListener("score", ((event: CustomEvent) => {
    if (!loggingEnabled()) return;
    log.add({
      event: event.detail.kind,
      score: event.detail.score,
      points: event.detail.points,
      mode: "integrated-cockpit",
    });
    syncLogButtons();
  }) as EventListener);

  element<HTMLInputElement>("adaptive-normalization").addEventListener(
    "change",
    (event) => {
      const checked = (event.target as HTMLInputElement).checked;
      const binding = mappings.altitude;
      mappings.altitude = {
        ...binding,
        normalization: {
          ...(binding.normalization ??
            defaultNormalizationConfig(binding.metric)),
          mode:
            checked && binding.metric !== "manual" ? "adaptive" : "fixed",
        },
      };
      if (binding.metric !== "manual")
        adaptiveRange.reset(binding.metric as DerivedMetricId);
      saveMappings();
      syncMappingAvailability();
    },
  );
  element("reset-adaptive-range").addEventListener("click", () => {
    const metric = mappings.altitude.metric;
    if (metric !== "manual")
      adaptiveRange.reset(metric as DerivedMetricId);
  });

  element<HTMLInputElement>("sim-enabled").addEventListener(
    "change",
    async (event) => {
      const requested = (event.target as HTMLInputElement).checked;
      if (requested && physicalConnected) await disconnectPolar();
      simulated = requested;
      simulationSessionId = requested ? sessionId("simulation") : "";
      adaptiveRange.startSession(
        requested ? simulationSessionId : polarSessionId,
      );
      if (simulated) {
        simNextBeat = performance.now();
        setText("polar-state", "Simulator active");
        setText(
          "polar-detail",
          "Deterministic test data; it cannot unlock Start Flight.",
        );
      } else if (!physicalConnected) {
        setText("polar-state", "Ready to connect");
        setText(
          "polar-detail",
          "Use a worn Polar H10 in desktop Chrome or Edge, or a compatible Android Chromium browser.",
        );
      }
    },
  );
  for (const id of ["sim-bpm", "sim-excite", "sim-breath"])
    element<HTMLInputElement>(id).addEventListener("input", () => {
      setText(
        "sim-bpm-output",
        element<HTMLInputElement>("sim-bpm").value + " bpm",
      );
      setText(
        "sim-excite-output",
        Number(element<HTMLInputElement>("sim-excite").value).toFixed(2),
      );
      setText(
        "sim-breath-output",
        Number(element<HTMLInputElement>("sim-breath").value).toFixed(2),
      );
    });
  element("export-settings").addEventListener("click", () =>
    download(
      JSON.stringify({ schemaVersion: 2, mappings }, null, 2),
      "ecgaming-flight-settings.json",
      "application/json",
    ),
  );
  element<HTMLInputElement>("import-settings").addEventListener(
    "change",
    async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        mappings = sanitizeMappings(parsed.mappings ?? parsed);
        adaptiveRange.reset();
        saveMappings();
        renderMappings();
      } catch {
        alert("That file is not a valid EC Gaming settings export.");
      }
    },
  );
  element("ground-log-export").addEventListener("click", () =>
    log.download("ecgaming-ground-control.csv"),
  );
  element("cockpit-log-export").addEventListener("click", () =>
    log.download("ecgaming-cockpit-flight.csv"),
  );
  element("ground-log-reset").addEventListener("click", () => {
    log.reset();
    syncLogButtons();
  });
}

receiver.addEventListener("statechange", ((event: CustomEvent) =>
  updateBeaconState(event.detail, event.detail.message)) as EventListener);
receiver.addEventListener("beaconconfig", ((event: CustomEvent) => {
  const state = event.detail as FlightReceiverSnapshot;
  if (sourceMode === "beacon" && state.beacon.config) {
    adaptiveRange.startSession("remote-" + state.beacon.config.sessionId);
    remoteTrace.length = 0;
  }
  updateBeaconState(state, "Derived-metric configuration validated.");
}) as EventListener);
receiver.addEventListener("beaconframe", ((event: CustomEvent) => {
  const state = event.detail as FlightReceiverSnapshot;
  const latest = state.beacon.latest;
  if (sourceMode === "beacon" && state.beacon.config && latest)
    observeMetrics(
      latest.metrics as Record<string, number>,
      latest.receivedAt,
      "remote-" + state.beacon.config.sessionId,
    );
  updateBeaconState(state);
}) as EventListener);
receiver.addEventListener("frame", ((event: CustomEvent) =>
  updateBeaconState(event.detail)) as EventListener);

broadcaster.addEventListener("statechange", ((event: CustomEvent) => {
  const state = event.detail;
  setText("broadcast-source", state.sourceLabel || "Not announced");
  setText(
    "broadcast-listeners",
    String(
      Math.max(state.listenerCount ?? 0, state.beaconListenerCount ?? 0),
    ),
  );
  setText("broadcast-route", String(state.route ?? "—").toUpperCase());
  setText(
    "broadcast-rtt",
    state.rttMs === undefined ? "—" : state.rttMs + " ms",
  );
  setText(
    "broadcast-dropped",
    String(
      (state.droppedBackpressure ?? 0) +
        (state.beaconDroppedBackpressure ?? 0),
    ),
  );
}) as EventListener);

setInterval(
  () => setText("clock", new Date().toLocaleTimeString("en-GB")),
  1000,
);
addEventListener("beforeunload", () => {
  void polar.disconnect({ emit: false });
  void broadcaster.stop();
  void receiver.stop();
  cockpit.dispose();
  disposeTextFit();
});

setupAccordion();
renderMappings();
setupActions();
const disposeTextFit = installPretextFit();
syncSourcePanels();
showView(
  new URL(location.href).searchParams.get("view") === "cockpit"
    ? "cockpit"
    : "ground",
  false,
);
requestAnimationFrame(updateCommandLoop);
