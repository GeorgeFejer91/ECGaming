import "./styles.css";
import { FlightFlags } from "./protocol/flight-frame";
import { FlightBroadcaster } from "./protocol/remote";
import type {
  ContinuousCommand,
  FlightMappings,
  MetricId,
} from "./protocol/types";
import {
  AttackReleaseSmoother,
  commandValue,
  sanitizeMappings,
} from "./signals/mappings";
import { CausalRPeakDetector } from "./signals/rpeak";
import { SessionCsvLog } from "./logging/session-log";
// Reused under the Affect Tracker repository's BSD-3-Clause license.
import {
  POLAR_METRICS,
  PolarH10BrowserSession,
  polarWebBluetoothSupport,
} from "./vendor/affect-tracker/polar-stream.js";

const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const setText = (id: string, value: string) => {
  element(id).textContent = value;
};
const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));
const METRIC_DEFINITIONS = [
  {
    id: "manual",
    label: "Manual control",
    minimum: 0,
    maximum: 1,
    unit: "0–1",
  },
  ...POLAR_METRICS,
] as {
  id: MetricId;
  label: string;
  minimum: number;
  maximum: number;
  unit: string;
}[];
const session = new PolarH10BrowserSession();
const detector = new CausalRPeakDetector(130);
const broadcaster = new FlightBroadcaster();
const log = new SessionCsvLog();
const ecgSamples: number[] = [];
const metrics: Record<string, number> = {};
let mappings = sanitizeMappings(
  JSON.parse(localStorage.getItem("ecgaming-ground-settings-v1") ?? "null"),
);
let physicalConnected = false,
  ecgReady = false,
  simulated = false,
  beatCounter = 0,
  lastBeatAt = -Infinity,
  lastFrameAt = performance.now(),
  lastLoggedAt = -Infinity,
  simNextBeat = performance.now();
let detectorConfidence = 0,
  latestCommands = { altitude: 0, throttle: 0.5, traffic: 0.5 },
  wakeLock: any,
  pipWindow: Window | undefined;
const smoothers = {
  altitude: new AttackReleaseSmoother(0),
  throttle: new AttackReleaseSmoother(0.5),
  traffic: new AttackReleaseSmoother(0.5),
};

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
            button.querySelector("i")!.textContent = open ? "−" : "+";
            item.querySelector<HTMLElement>(".accordion-body")!.hidden = !open;
          });
      }),
    );
}

function metricOptions(selected: string) {
  return METRIC_DEFINITIONS.map(
    (metric) =>
      `<option value="${metric.id}" ${metric.id === selected ? "selected" : ""}>${metric.label}</option>`,
  ).join("");
}
function renderMappings() {
  const host = element("mapping-controls");
  host.innerHTML =
    (["altitude", "throttle", "traffic"] as ContinuousCommand[])
      .map((command) => {
        const value = mappings[command];
        return `<fieldset class="mapping-card" data-command="${command}"><div class="mapping-head"><strong>${command}</strong><output data-output>${command === "altitude" ? "+0.00" : "50%"}</output></div><div class="mapping-grid"><label class="wide">Signal<select data-field="metric">${metricOptions(value.metric)}</select></label><label>Input minimum<input data-field="minimum" type="number" step="any" value="${value.minimum}"></label><label>Input maximum<input data-field="maximum" type="number" step="any" value="${value.maximum}"></label><label>Attack (ms)<input data-field="attackMs" type="number" min="0" max="5000" value="${value.attackMs}"></label><label>Release (ms)<input data-field="releaseMs" type="number" min="0" max="5000" value="${value.releaseMs}"></label><label class="wide field manual-field">Manual value <input data-field="manual" type="range" min="0" max="1" step=".01" value="${value.manual}"></label><label class="wide check-row"><input data-field="reverse" type="checkbox" ${value.reverse ? "checked" : ""}><span>Reverse this command</span></label><div class="binding-preview"><i data-preview></i></div></div></fieldset>`;
      })
      .join("") +
    `<fieldset class="mapping-card beat-map"><div class="mapping-head"><strong>Heartbeat action</strong><output data-beat-output>PULSE</output></div><div class="mapping-grid"><label>Beat timing source<select id="beat-source"><option value="ecg-rpeak">ECG R-peak · experimental</option><option value="polar-rr">Polar RR notification</option><option value="off">Off</option></select></label><label>Game action<select id="beat-action"><option value="pulse">Visual + engine pulse</option><option value="lift">Heartbeat lift</option><option value="off">Off</option></select></label><p class="fine-print wide">Polar RR notifications may contain batched intervals and are not guaranteed to arrive at the exact beat. ECG R-peak timing is causal and experimental.</p></div></fieldset>`;
  element<HTMLSelectElement>("beat-source").value = mappings.beatSource;
  element<HTMLSelectElement>("beat-action").value = mappings.beatAction;
  host
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field]")
    .forEach((input) => input.addEventListener("input", updateMappingsFromUi));
  element("beat-source").addEventListener("change", updateMappingsFromUi);
  element("beat-action").addEventListener("change", updateMappingsFromUi);
  syncMappingAvailability();
}
function updateMappingsFromUi() {
  const draft = structuredClone(mappings);
  document.querySelectorAll<HTMLElement>("[data-command]").forEach((card) => {
    const command = card.dataset.command as ContinuousCommand;
    const get = (name: string) =>
      card.querySelector<HTMLInputElement | HTMLSelectElement>(
        `[data-field="${name}"]`,
      )!;
    draft[command] = {
      metric: get("metric").value as MetricId,
      minimum: Number(get("minimum").value),
      maximum: Number(get("maximum").value),
      attackMs: Number(get("attackMs").value),
      releaseMs: Number(get("releaseMs").value),
      manual: Number(get("manual").value),
      reverse: (get("reverse") as HTMLInputElement).checked,
    };
  });
  draft.beatSource = element<HTMLSelectElement>("beat-source")
    .value as FlightMappings["beatSource"];
  draft.beatAction = element<HTMLSelectElement>("beat-action")
    .value as FlightMappings["beatAction"];
  mappings = sanitizeMappings(draft);
  localStorage.setItem("ecgaming-ground-settings-v1", JSON.stringify(mappings));
  syncMappingAvailability();
}
function syncMappingAvailability() {
  document.querySelectorAll<HTMLElement>("[data-command]").forEach((card) => {
    const command = card.dataset.command as ContinuousCommand;
    const binding = mappings[command];
    card
      .querySelectorAll<HTMLInputElement>(".manual-field input")
      .forEach((input) => (input.disabled = binding.metric !== "manual"));
    card
      .querySelectorAll<HTMLInputElement>(
        '[data-field="minimum"],[data-field="maximum"]',
      )
      .forEach((input) => (input.disabled = binding.metric === "manual"));
    if (command === "altitude")
      card.toggleAttribute("data-beat-lift", mappings.beatAction === "lift");
  });
  const locked = broadcaster.snapshot().phase === "broadcasting";
  document
    .querySelectorAll<HTMLFieldSetElement>(".mapping-card")
    .forEach((field) => (field.disabled = locked));
  element<HTMLInputElement>("import-settings").disabled = locked;
  const beatAction = element<HTMLSelectElement>("beat-action");
  beatAction.value = mappings.beatAction;
  beatAction.disabled = locked || mappings.beatSource === "off";
  setText(
    "beat-source-state",
    `${mappings.beatSource.replace("-", " ").toUpperCase()} · ${mappings.beatAction.toUpperCase()}`,
  );
}

function drawEcg() {
  const canvas = element<HTMLCanvasElement>("ecg-preview"),
    context = canvas.getContext("2d")!;
  const width = canvas.width,
    height = canvas.height;
  context.clearRect(0, 0, width, height);
  if (ecgSamples.length < 2) return;
  const mean = ecgSamples.reduce((a, b) => a + b, 0) / ecgSamples.length;
  const peak = Math.max(100, ...ecgSamples.map((v) => Math.abs(v - mean)));
  context.strokeStyle = "#69d4de";
  context.lineWidth = 1.6;
  context.shadowColor = "#69d4de";
  context.shadowBlur = 5;
  context.beginPath();
  ecgSamples.forEach((value, index) => {
    const x = (index / (ecgSamples.length - 1)) * width,
      y = height / 2 - ((value - mean) / peak) * height * 0.42;
    index ? context.lineTo(x, y) : context.moveTo(x, y);
  });
  context.stroke();
  context.shadowBlur = 0;
}
function showMetric(id: string, digits = 0) {
  const value = metrics[id];
  setText(
    `metric-${id}`,
    Number.isFinite(value) ? value.toFixed(digits) : "--",
  );
}
function registerBeat(source: "ecg-rpeak" | "polar-rr", confidence: number) {
  if (mappings.beatSource !== source || mappings.beatAction === "off") return;
  beatCounter = (beatCounter + 1) >>> 0;
  lastBeatAt = performance.now();
  detectorConfidence = confidence;
  setText("command-beat", beatCounter.toString().padStart(6, "0"));
  const pulse = document.querySelector(".radar-beat")!;
  pulse.classList.remove("pulse");
  requestAnimationFrame(() => pulse.classList.add("pulse"));
  if (element<HTMLInputElement>("ground-log-enabled").checked)
    log.add({ event: "beat", source, beat_counter: beatCounter, confidence });
}

function handlePolarEvent(event: any) {
  if (event.kind === "status") {
    setText("polar-state", "Connecting");
    setText("polar-detail", event.message ?? "Working…");
  }
  if (event.kind === "connection") {
    physicalConnected = event.connected === true;
    ecgReady =
      physicalConnected &&
      Number(event.streamHealth?.observedSampleRateHz) >= 110;
    element("polar-header-dot").classList.toggle("is-live", physicalConnected);
    setText(
      "polar-header-state",
      physicalConnected ? "POLAR LIVE" : "POLAR OFFLINE",
    );
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
    Object.assign(metrics, event.snapshot?.values ?? {});
    showMetric("heart_rate");
    showMetric("rr_interval");
    showMetric("excitement_score", 2);
  }
  if (event.kind === "heart-rate") {
    for (const rr of event.rrIntervalsMs ?? []) {
      detector.setReferenceRr(rr);
      registerBeat("polar-rr", 0.75);
    }
  }
  if (event.kind === "ecg") {
    ecgReady = true;
    const samples = event.microvolts ?? [];
    ecgSamples.push(...samples);
    if (ecgSamples.length > 390) ecgSamples.splice(0, ecgSamples.length - 390);
    setText(
      "ecg-rate",
      Number(event.streamHealth?.observedSampleRateHz ?? 130).toFixed(0),
    );
    for (const beat of detector.pushFrame(samples, event.sensorTimestampNs)) {
      detectorConfidence = beat.confidence;
      if (detector.ready) registerBeat("ecg-rpeak", beat.confidence);
    }
    drawEcg();
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
  for (const key of Object.keys(metrics)) delete metrics[key];
  detector.reset();
  beatCounter = 0;
  lastBeatAt = -Infinity;
  try {
    await session.connect(handlePolarEvent);
  } catch (error) {
    setText("polar-state", "Connection failed");
    setText(
      "polar-detail",
      error instanceof Error ? error.message : String(error),
    );
  }
}
async function disconnectPolar() {
  await session.disconnect();
  physicalConnected = false;
  ecgReady = false;
  detector.reset();
}

function simulatedSignals(now: number) {
  if (!simulated) return;
  const bpm = Number(element<HTMLInputElement>("sim-bpm").value),
    excitement = Number(element<HTMLInputElement>("sim-excite").value);
  metrics.heart_rate = bpm;
  metrics.rr_interval = 60_000 / bpm;
  metrics.excitement_score = excitement;
  metrics.excitometer = clamp(excitement * 0.85 + 0.08);
  showMetric("heart_rate");
  showMetric("rr_interval");
  showMetric("excitement_score", 2);
  setText("ecg-rate", "SIM");
  if (now >= simNextBeat) {
    simNextBeat = now + 60_000 / bpm;
    registerBeat(
      mappings.beatSource === "polar-rr" ? "polar-rr" : "ecg-rpeak",
      1,
    );
  }
}

function updateCommandLoop(now: number) {
  const delta = Math.min(100, Math.max(0, now - lastFrameAt));
  lastFrameAt = now;
  simulatedSignals(now);
  const physicalReady =
    physicalConnected &&
    ecgReady &&
    Number.isFinite(metrics.heart_rate) &&
    Number.isFinite(metrics.rr_interval);
  let commandsValid = true;
  for (const command of [
    "altitude",
    "throttle",
    "traffic",
  ] as ContinuousCommand[]) {
    let target = commandValue(command, metrics, mappings);
    if (command === "altitude" && mappings.beatAction === "lift") {
      const age = now - lastBeatAt;
      target = age < 420 ? 1 - age / 420 : -0.18;
    }
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
  const beatSourceReady =
    mappings.beatAction !== "lift" ||
    mappings.beatSource === "off" ||
    (mappings.beatSource === "ecg-rpeak"
      ? detector.ready || simulated
      : Number.isFinite(metrics.rr_interval));
  const ready =
    (simulated || physicalReady) && commandsValid && beatSourceReady;
  const beatAge = Number.isFinite(lastBeatAt)
    ? Math.max(0, now - lastBeatAt)
    : 999_999;
  const flags =
    (ready ? FlightFlags.controlReady : 0) |
    (physicalConnected ? FlightFlags.physicalPolar : 0) |
    (detector.ready ? FlightFlags.beatDetectorReady : 0) |
    (simulated ? FlightFlags.simulation : 0);
  broadcaster.offer({
    ...latestCommands,
    beatCounter,
    beatAgeMs: beatAge,
    quality: simulated
      ? 1
      : clamp(detectorConfidence || Number(ecgReady) * 0.6),
    flags,
  });
  updateCommandPreview(ready);
  if (
    element<HTMLInputElement>("ground-log-enabled").checked &&
    now - lastLoggedAt >= 100
  ) {
    lastLoggedAt = now;
    log.add({
      event: "command",
      sequence: broadcaster.snapshot().sequence,
      source_id: broadcaster.snapshot().streamId,
      session_id: broadcaster.snapshot().sessionId,
      session_mode: simulated ? "simulation" : "polar",
      heart_rate: metrics.heart_rate ?? "",
      rr_interval: metrics.rr_interval ?? "",
      excitement_score: metrics.excitement_score ?? "",
      altitude: latestCommands.altitude,
      throttle: latestCommands.throttle,
      traffic: latestCommands.traffic,
      beat_counter: beatCounter,
      flags,
    });
    element<HTMLButtonElement>("ground-log-export").disabled = log.size === 0;
  }
  requestAnimationFrame(updateCommandLoop);
}
function updateCommandPreview(ready: boolean) {
  setText(
    "command-altitude",
    `${latestCommands.altitude >= 0 ? "+" : ""}${latestCommands.altitude.toFixed(2)}`,
  );
  setText("command-throttle", `${Math.round(latestCommands.throttle * 100)}%`);
  setText("command-traffic", `${Math.round(latestCommands.traffic * 100)}%`);
  element<HTMLMeterElement>("command-altitude-meter").value =
    latestCommands.altitude;
  element<HTMLMeterElement>("command-throttle-meter").value =
    latestCommands.throttle;
  element<HTMLMeterElement>("command-traffic-meter").value =
    latestCommands.traffic;
  setText(
    "command-readiness",
    ready
      ? `${simulated ? "SIMULATED" : "PHYSICAL POLAR"} CONTROL READY`
      : "CONTROL HOLD · CONNECT POLAR OR ENABLE SIMULATOR",
  );
  document.querySelectorAll<HTMLElement>("[data-command]").forEach((card) => {
    const command = card.dataset.command as ContinuousCommand;
    const value = latestCommands[command];
    const output = card.querySelector("output")!,
      preview = card.querySelector<HTMLElement>("[data-preview]")!;
    output.textContent =
      command === "altitude"
        ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}`
        : `${Math.round(value * 100)}%`;
    preview.style.width = `${command === "altitude" ? (value + 1) * 50 : value * 100}%`;
  });
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
        width: 300,
        height: 100,
      })) as Window;
      pipWindow = pip;
      const box = pip.document.createElement("div");
      box.style.cssText =
        "font:700 16px system-ui;padding:22px;color:#fff;background:#07131f;height:100%;box-sizing:border-box";
      box.textContent = "EC Gaming · Broadcast active";
      pip.document.body.style.margin = "0";
      pip.document.body.append(box);
    }
  } catch {
    /* optional scheduling surface */
  }
}
async function startBroadcast() {
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
  element<HTMLButtonElement>("start-broadcast").disabled = false;
  element<HTMLButtonElement>("stop-broadcast").disabled = true;
  void schedulingGuard(false);
}

function setupActions() {
  element("connect-polar").addEventListener("click", () => void connectPolar());
  element("disconnect-polar").addEventListener(
    "click",
    () => void disconnectPolar(),
  );
  element("start-broadcast").addEventListener(
    "click",
    () => void startBroadcast(),
  );
  element("stop-broadcast").addEventListener(
    "click",
    () => void stopBroadcast(),
  );
  element<HTMLInputElement>("sim-enabled").addEventListener(
    "change",
    async (event) => {
      const requested = (event.target as HTMLInputElement).checked;
      if (requested && physicalConnected) await disconnectPolar();
      simulated = requested;
      if (simulated) {
        simNextBeat = performance.now();
        setText("polar-state", "Simulator active");
        setText(
          "polar-detail",
          "Deterministic derived values; not physical readiness.",
        );
      } else if (!physicalConnected) {
        setText("polar-state", "Ready to connect");
        setText(
          "polar-detail",
          "Use a worn Polar H10 in desktop Chrome or Edge.",
        );
      }
    },
  );
  for (const id of ["sim-bpm", "sim-excite"])
    element<HTMLInputElement>(id).addEventListener("input", () => {
      setText(
        "sim-bpm-output",
        `${element<HTMLInputElement>("sim-bpm").value} bpm`,
      );
      setText(
        "sim-excite-output",
        Number(element<HTMLInputElement>("sim-excite").value).toFixed(2),
      );
    });
  element("export-settings").addEventListener("click", () =>
    download(
      JSON.stringify({ schemaVersion: 1, mappings }, null, 2),
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
        localStorage.setItem(
          "ecgaming-ground-settings-v1",
          JSON.stringify(mappings),
        );
        renderMappings();
      } catch {
        alert("That file is not a valid EC Gaming settings export.");
      }
    },
  );
  element("ground-log-export").addEventListener("click", () =>
    log.download("ecgaming-ground-control.csv"),
  );
  element("ground-log-reset").addEventListener("click", () => {
    log.reset();
    element<HTMLButtonElement>("ground-log-export").disabled = true;
  });
}
function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

broadcaster.addEventListener("statechange", ((event: CustomEvent) => {
  const state = event.detail;
  setText("broadcast-source", state.sourceLabel || "Not announced");
  setText("broadcast-listeners", String(state.listenerCount));
  setText("broadcast-route", String(state.route ?? "—").toUpperCase());
  setText(
    "broadcast-rtt",
    state.rttMs === undefined ? "—" : `${state.rttMs} ms`,
  );
  setText("broadcast-dropped", String(state.droppedBackpressure));
}) as EventListener);
setInterval(
  () => setText("clock", new Date().toLocaleTimeString("en-GB")),
  1000,
);
addEventListener("beforeunload", () => {
  void session.disconnect({ emit: false });
  void broadcaster.stop();
});
setupAccordion();
renderMappings();
setupActions();
requestAnimationFrame(updateCommandLoop);
