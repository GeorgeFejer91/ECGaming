import { clamp } from "./math.js";
import {
  decodePolarAccelerometer,
  PolarBreathingProcessor,
} from "../polar-stream/breathing.js";

export const POLAR_UUIDS = Object.freeze({
  heartRateService: "0000180d-0000-1000-8000-00805f9b34fb",
  heartRateMeasurement: "00002a37-0000-1000-8000-00805f9b34fb",
  batteryService: "0000180f-0000-1000-8000-00805f9b34fb",
  batteryLevel: "00002a19-0000-1000-8000-00805f9b34fb",
  pmdService: "fb005c80-02e7-f387-1cad-8acd2d8df0c8",
  pmdControl: "fb005c81-02e7-f387-1cad-8acd2d8df0c8",
  pmdData: "fb005c82-02e7-f387-1cad-8acd2d8df0c8",
});

export const POLAR_COMMANDS = Object.freeze({
  startEcg: Object.freeze([0x02, 0x00, 0x00, 0x01, 130, 0, 0x01, 0x01, 14, 0]),
  startAccelerometer: Object.freeze([
    0x02, 0x02, 0x00, 0x01, 200, 0, 0x01, 0x01, 16, 0, 0x02, 0x01, 8, 0,
  ]),
  stopEcg: Object.freeze([0x03, 0x00]),
  stopAccelerometer: Object.freeze([0x03, 0x02]),
});

export const POLAR_METRICS = Object.freeze([
  Object.freeze({
    id: "breathing_volume",
    label: "ACC breathing waveform",
    shortLabel: "Breathing",
    unit: "0–1",
    minimum: 0,
    maximum: 1,
    group: "Breathing · ACC",
    detail: "Experimental chest-motion / respiratory-effort surrogate",
  }),
  Object.freeze({
    id: "excitement_score",
    label: "Excite-O-Meter score",
    shortLabel: "Excite-O-Meter",
    unit: "0–1",
    minimum: 0,
    maximum: 1,
    group: "Composite",
    detail: "Provisional RR + 10-beat RMSSD score",
  }),
  Object.freeze({
    id: "excitometer",
    label: "Activation composite",
    shortLabel: "Activation",
    unit: "0–1",
    minimum: 0,
    maximum: 1,
    group: "Composite",
    detail: "65% heart-rate rise + 35% lnRMSSD fall",
  }),
  Object.freeze({
    id: "rmssd",
    label: "Rolling RMSSD (uncorrected)",
    shortLabel: "HRV · RMSSD",
    unit: "ms",
    minimum: 0,
    maximum: 120,
    group: "HRV",
    detail: "Beat-to-beat short-term variability",
  }),
  Object.freeze({
    id: "ln_rmssd",
    label: "Rolling lnRMSSD (uncorrected)",
    shortLabel: "HRV · lnRMSSD",
    unit: "ln(ms)",
    minimum: 1.5,
    maximum: 5.5,
    group: "HRV",
    detail: "Natural log of rolling RMSSD",
  }),
  Object.freeze({
    id: "sdnn",
    label: "Rolling SDNN (uncorrected)",
    shortLabel: "HRV · SDNN",
    unit: "ms",
    minimum: 0,
    maximum: 120,
    group: "HRV",
    detail: "Standard deviation of recent RR intervals",
  }),
  Object.freeze({
    id: "ecg_local_power",
    label: "Local ECG power (5 s)",
    shortLabel: "Local ECG power",
    unit: "µV²",
    minimum: 10_000,
    maximum: 2_250_000,
    group: "ECG",
    detail: "Five-second mean squared amplitude",
  }),
  Object.freeze({
    id: "heart_rate",
    label: "Heart rate",
    shortLabel: "Heart rate",
    unit: "bpm",
    minimum: 45,
    maximum: 160,
    group: "Vitals",
    detail: "Current H10 heart-rate notification",
  }),
  Object.freeze({
    id: "rr_interval",
    label: "Latest RR interval",
    shortLabel: "Latest RR",
    unit: "ms",
    minimum: 400,
    maximum: 1_300,
    group: "Vitals",
    detail: "Latest uncorrected beat interval",
  }),
  Object.freeze({
    id: "ecg_rms",
    label: "ECG RMS amplitude",
    shortLabel: "ECG RMS",
    unit: "µV",
    minimum: 100,
    maximum: 1_500,
    group: "ECG",
    detail: "Square root of local ECG power",
  }),
  Object.freeze({
    id: "ecg_peak_to_peak",
    label: "ECG peak-to-peak",
    shortLabel: "ECG range",
    unit: "µV",
    minimum: 200,
    maximum: 4_000,
    group: "ECG",
    detail: "Five-second maximum minus minimum",
  }),
]);

const METRIC_BY_ID = new Map(
  POLAR_METRICS.map((metric) => [metric.id, metric]),
);
const ECG_WINDOW_SAMPLES = 130 * 5;
const RR_WINDOW_VALUES = 300;
const GATT_CONNECT_RETRY_DELAYS_MS = Object.freeze([750, 1_500, 3_000]);
const CONTROL_RESPONSE_TIMEOUT_MS = 7_500;
const FIRST_ECG_TIMEOUT_MS = 10_000;
const FIRST_HEART_RATE_TIMEOUT_MS = 10_000;
const FIRST_ACCELEROMETER_TIMEOUT_MS = 10_000;
const GATT_STAGE_TIMEOUT_MS = 12_000;
const PMD_RESPONSE_GRACE_AFTER_FRAME_MS = 250;
const STREAM_SETUP_RETRY_DELAYS_MS = Object.freeze([750, 1_500, 3_000]);
const STREAM_SETUP_RETRY_CODES = new Set([
  "BLUETOOTH_LINK_LOST_DURING_SETUP",
  "PMD_CONTROL_TIMEOUT",
  "PMD_FIRST_ECG_TIMEOUT",
  "PMD_ACC_CONTROL_TIMEOUT",
  "PMD_FIRST_ACC_TIMEOUT",
  "PMD_FIRST_HEART_RATE_TIMEOUT",
  "PMD_COMMAND_REJECTED",
]);
const POLAR_BROWSER_LEASE = "ecgaming-polar-h10-direct-v1";
export const POLAR_LIVE_ECG_TIMEOUT_MS = 5_000;
export const POLAR_LIVE_ECG_RECOVERY_ATTEMPTS = 1;

export class PolarStreamError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.name = "PolarStreamError";
    this.code = code;
    this.retryable = Boolean(retryable);
  }
}

function bytesFrom(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof DataView)
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return Uint8Array.from(value ?? []);
}

function unsigned64Le(bytes, offset) {
  let result = 0n;
  for (let index = 7; index >= 0; index -= 1)
    result = (result << 8n) | BigInt(bytes[offset + index]);
  return result;
}

function signed24Le(bytes, offset) {
  const value =
    bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
  return value & 0x800000 ? value - 0x1000000 : value;
}

export function decodePolarEcg(value) {
  const bytes = bytesFrom(value);
  if (bytes.length < 10)
    throw new PolarStreamError(
      "PMD_FRAME_TOO_SHORT",
      "Polar PMD frame is shorter than its header.",
    );
  if (bytes[0] !== 0x00 || bytes[9] !== 0x00) return null;
  const payload = bytes.subarray(10);
  if (payload.length % 3 !== 0) {
    throw new PolarStreamError(
      "PMD_INVALID_ECG",
      "Polar ECG payload is not a sequence of signed 24-bit samples.",
    );
  }
  const microvolts = [];
  for (let offset = 0; offset < payload.length; offset += 3)
    microvolts.push(signed24Le(payload, offset));
  return { sensorTimestampNs: unsigned64Le(bytes, 1).toString(), microvolts };
}

export function decodePolarHeartRate(value) {
  const bytes = bytesFrom(value);
  if (bytes.length < 2) return { beatsPerMinute: 0, rrIntervalsMs: [] };
  const flags = bytes[0];
  const wideHeartRate = Boolean(flags & 0x01);
  const beatsPerMinute =
    wideHeartRate && bytes.length >= 3 ? bytes[1] | (bytes[2] << 8) : bytes[1];
  let cursor = wideHeartRate ? 3 : 2;
  if (flags & 0x08) cursor += 2;
  const rrIntervalsMs = [];
  if (flags & 0x10) {
    while (cursor + 1 < bytes.length) {
      rrIntervalsMs.push(
        (bytes[cursor] | (bytes[cursor + 1] << 8)) * (1000 / 1024),
      );
      cursor += 2;
    }
  }
  return { beatsPerMinute, rrIntervalsMs };
}

function sampleStandardDeviation(values) {
  if (values.length < 2) return undefined;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      (values.length - 1),
  );
}

function rmssd(values) {
  if (values.length < 2) return undefined;
  let squaredDifferenceSum = 0;
  for (let index = 1; index < values.length; index += 1) {
    squaredDifferenceSum += (values[index] - values[index - 1]) ** 2;
  }
  return Math.sqrt(squaredDifferenceSum / (values.length - 1));
}

class RunningStats {
  constructor() {
    this.count = 0;
    this.mean = 0;
    this.m2 = 0;
  }

  push(value) {
    if (!Number.isFinite(value)) return;
    this.count += 1;
    const delta = value - this.mean;
    this.mean += delta / this.count;
    this.m2 += delta * (value - this.mean);
  }

  zScore(value, { population = false } = {}) {
    if (this.count < 2) return 0;
    const divisor = population ? this.count : this.count - 1;
    const standardDeviation = Math.sqrt(this.m2 / divisor);
    return standardDeviation < 1e-6
      ? 0
      : (value - this.mean) / standardDeviation;
  }
}

// Abramowitz and Stegun 7.1.26, matching the legacy Excite-O-Meter implementation.
function normalCdf(value) {
  const sign = value < 0 ? -1 : 1;
  const scaled = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * scaled);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-(scaled ** 2));
  return 0.5 * (1 + sign * erf);
}

export class PolarMetricProcessor {
  constructor({
    ecgCapacity = ECG_WINDOW_SAMPLES,
    rrCapacity = RR_WINDOW_VALUES,
  } = {}) {
    this.ecgCapacity = Math.max(2, Math.floor(ecgCapacity));
    this.rrCapacity = Math.max(2, Math.floor(rrCapacity));
    this.reset();
  }

  reset() {
    this.ecg = [];
    this.rr = [];
    this.values = {};
    this.totalEcgSamples = 0;
    this.excitementRecentRr = [];
    this.excitementRrStats = new RunningStats();
    this.excitementRmssdStats = new RunningStats();
    this.activationHeartRateStats = new RunningStats();
    this.activationLnRmssdStats = new RunningStats();
  }

  pushEcg(samples) {
    const finite = Array.from(samples ?? [], Number).filter(Number.isFinite);
    if (!finite.length) return this.snapshot();
    this.totalEcgSamples += finite.length;
    this.ecg.push(...finite);
    if (this.ecg.length > this.ecgCapacity)
      this.ecg.splice(0, this.ecg.length - this.ecgCapacity);
    const meanSquare =
      this.ecg.reduce((sum, value) => sum + value * value, 0) / this.ecg.length;
    this.values.ecg_local_power = meanSquare;
    this.values.ecg_rms = Math.sqrt(meanSquare);
    this.values.ecg_peak_to_peak =
      Math.max(...this.ecg) - Math.min(...this.ecg);
    return this.snapshot();
  }

  pushHeartRate({ beatsPerMinute, rrIntervalsMs } = {}) {
    if (Number.isFinite(beatsPerMinute) && beatsPerMinute > 0)
      this.values.heart_rate = Number(beatsPerMinute);
    const accepted = Array.from(rrIntervalsMs ?? [], Number).filter(
      (value) => Number.isFinite(value) && value > 0,
    );
    if (accepted.length) {
      this.values.rr_interval = accepted.at(-1);
      for (const rrInterval of accepted) {
        this.rr.push(rrInterval);
        if (this.rr.length > this.rrCapacity) this.rr.shift();
        this.updateExciteOMeter(rrInterval);

        const rollingRmssd = rmssd(this.rr);
        const rollingSdnn = sampleStandardDeviation(this.rr);
        if (rollingRmssd !== undefined) {
          this.values.rmssd = rollingRmssd;
          this.values.ln_rmssd = rollingRmssd > 0 ? Math.log(rollingRmssd) : 0;
          this.updateActivationComposite(
            Number.isFinite(beatsPerMinute) && beatsPerMinute > 0
              ? Number(beatsPerMinute)
              : 60_000 / rrInterval,
            this.values.ln_rmssd,
          );
        }
        if (rollingSdnn !== undefined) this.values.sdnn = rollingSdnn;
      }
    }
    return this.snapshot();
  }

  updateExciteOMeter(rrInterval) {
    this.excitementRecentRr.push(rrInterval);
    if (this.excitementRecentRr.length > 10) this.excitementRecentRr.shift();
    if (this.excitementRecentRr.length < 10) return;
    const rollingRmssd = rmssd(this.excitementRecentRr);
    if (!Number.isFinite(rollingRmssd)) return;
    this.excitementRrStats.push(rrInterval);
    this.excitementRmssdStats.push(rollingRmssd);
    if (
      this.excitementRrStats.count < 10 ||
      this.excitementRmssdStats.count < 10
    )
      return;
    const rrPercentile = normalCdf(
      this.excitementRrStats.zScore(rrInterval, { population: true }),
    );
    const rmssdPercentile = normalCdf(
      this.excitementRmssdStats.zScore(rollingRmssd, { population: true }),
    );
    this.values.excitement_score = clamp(
      1 - (rrPercentile + rmssdPercentile) / 2,
      0,
      1,
    );
  }

  updateActivationComposite(heartRate, lnRmssd) {
    this.activationHeartRateStats.push(heartRate);
    this.activationLnRmssdStats.push(lnRmssd);
    if (
      this.activationHeartRateStats.count < 20 ||
      this.activationLnRmssdStats.count < 20
    )
      return;
    const activation =
      0.65 * this.activationHeartRateStats.zScore(heartRate) -
      0.35 * this.activationLnRmssdStats.zScore(lnRmssd);
    this.values.excitometer = clamp(1 / (1 + Math.exp(-activation)), 0, 1);
  }

  snapshot() {
    return {
      values: { ...this.values },
      ecgWindowSamples: this.ecg.length,
      rrWindowValues: this.rr.length,
      totalEcgSamples: this.totalEcgSamples,
      readiness: {
        excitementPairs: this.excitementRrStats.count,
        activationPairs: this.activationHeartRateStats.count,
      },
    };
  }
}

export function polarMetricDefinition(id) {
  return METRIC_BY_ID.get(id);
}

export function defaultPolarMappings() {
  return {
    valence: { metric: "manual", minimum: -1, maximum: 1, invert: false },
    arousal: { metric: "manual", minimum: -1, maximum: 1, invert: false },
  };
}

export function normalizePolarMappings(value = {}) {
  const defaults = defaultPolarMappings();
  return Object.fromEntries(
    ["valence", "arousal"].map((axis) => {
      const candidate = value?.[axis] ?? defaults[axis];
      const definition = polarMetricDefinition(candidate.metric);
      if (!definition) return [axis, { ...defaults[axis] }];
      const requestedMinimum = Number(candidate.minimum);
      const requestedMaximum = Number(candidate.maximum);
      const minimum = Number.isFinite(requestedMinimum)
        ? requestedMinimum
        : definition.minimum;
      const maximum =
        Number.isFinite(requestedMaximum) && requestedMaximum > minimum
          ? requestedMaximum
          : definition.maximum > minimum
            ? definition.maximum
            : minimum + 1;
      return [
        axis,
        {
          metric: definition.id,
          minimum,
          maximum,
          invert: candidate.invert === true,
        },
      ];
    }),
  );
}

export function normalizePolarMetric(value, mapping) {
  const minimum = Number(mapping?.minimum);
  const maximum = Number(mapping?.maximum);
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum) ||
    maximum <= minimum
  ) {
    return undefined;
  }
  const normalized = clamp(
    ((value - minimum) / (maximum - minimum)) * 2 - 1,
    -1,
    1,
  );
  return mapping.invert ? -normalized : normalized;
}

export function polarWebBluetoothSupport({
  secureContext = globalThis.isSecureContext,
  navigatorObject = globalThis.navigator,
  allowQuestExperiment = false,
} = {}) {
  if (!secureContext)
    return {
      supported: false,
      questBrowser: false,
      reason: "Web Bluetooth requires HTTPS or localhost.",
    };
  const userAgent = String(navigatorObject?.userAgent ?? "");
  const questBrowser = /OculusBrowser|Meta Quest Browser/i.test(userAgent);
  if (questBrowser && !allowQuestExperiment) {
    return {
      supported: false,
      questBrowser: true,
      reason:
        "Meta Quest Browser does not provide a usable Web Bluetooth device chooser. Connect from desktop Chromium; sideloaded browsers are not a supported study path.",
    };
  }
  if (typeof navigatorObject?.bluetooth?.requestDevice !== "function") {
    return {
      supported: false,
      questBrowser,
      reason: questBrowser
        ? "Meta Quest Browser does not expose a working Web Bluetooth chooser. Use desktop Chromium or an explicitly tested sideloaded browser."
        : "This browser does not expose Web Bluetooth. Use a compatible Chrome, Edge, or Chromium build.",
    };
  }
  return {
    supported: true,
    questBrowser,
    reason: questBrowser
      ? "This Quest browser exposes Web Bluetooth. The H10 chooser and streaming path are experimental and not yet headset-qualified."
      : "Web Bluetooth is available. Connection still requires a user-selected Polar H10.",
  };
}

function normalizeBluetoothError(error, questBrowser = false) {
  if (error instanceof PolarStreamError) return error;
  const browserMessage = String(error?.message ?? "");
  const browserBlocked =
    error?.name === "NotSupportedError" ||
    /globally disabled|web bluetooth (?:is )?not supported|permission (?:has been |is )?blocked/i.test(
      browserMessage,
    );
  if (browserBlocked) {
    return new PolarStreamError(
      "WEB_BLUETOOTH_DISABLED",
      "Chrome has Web Bluetooth disabled or blocked. Allow sites to ask for Bluetooth access, then reload this page.",
      true,
    );
  }
  if (error?.name === "NotFoundError") {
    return new PolarStreamError(
      "BLUETOOTH_CHOOSER_CANCELLED",
      questBrowser
        ? "Meta Quest Browser did not provide a usable H10 chooser."
        : "Chrome closed the Bluetooth chooser without a Polar H10 selection. Wear the moistened strap so it advertises, close other Polar apps or H10 tabs, then press Connect and select the H10.",
      true,
    );
  }
  if (error?.name === "SecurityError" || error?.name === "NotAllowedError") {
    if (
      /permissions? policy|feature policy|not allowed to use (?:web )?bluetooth/i.test(
        browserMessage,
      )
    ) {
      return new PolarStreamError(
        "WEB_BLUETOOTH_POLICY_BLOCKED",
        "This page's embedding policy blocks Web Bluetooth. Open Affect Tracker directly in a top-level Chrome tab.",
        true,
      );
    }
    return new PolarStreamError(
      "BLUETOOTH_PERMISSION_DENIED",
      "Bluetooth permission was not granted.",
      true,
    );
  }
  if (error?.name === "InvalidStateError") {
    return new PolarStreamError(
      "BLUETOOTH_ADAPTER_UNAVAILABLE",
      "Chrome could not use the Bluetooth adapter. Turn Bluetooth on, close other Bluetooth diagnostics, then retry.",
      true,
    );
  }
  if (error?.name === "NetworkError" || error?.name === "AbortError") {
    return new PolarStreamError(
      "BLUETOOTH_CONNECTION_FAILED",
      "The Polar H10 Bluetooth connection failed.",
      true,
    );
  }
  return new PolarStreamError(
    "BROWSER_BLE_FAILED",
    error?.message || "The browser could not connect to the Polar H10.",
    true,
  );
}

function bluetoothStageError(error, code, label) {
  if (error instanceof PolarStreamError) return error;
  const detail = String(error?.message ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const name = String(error?.name ?? "");
  const likelyLeaseConflict = [
    "AbortError",
    "InvalidStateError",
    "NetworkError",
    "TimeoutError",
  ].includes(name);
  const hint = likelyLeaseConflict
    ? " Disconnect the H10 from Polar Stream, Polar Beat/Flow, or another browser tab, then retry here."
    : "";
  return new PolarStreamError(
    `BLUETOOTH_${code}_FAILED`,
    `${label} failed${detail ? `: ${detail}` : "."}${hint}`,
    true,
  );
}

function retryableStreamSetupError(error) {
  const code = String(error?.code ?? "");
  return (
    STREAM_SETUP_RETRY_CODES.has(code) ||
    (error?.retryable === true && /^BLUETOOTH_.+_FAILED$/.test(code))
  );
}

export class PolarH10BrowserSession {
  constructor({
    navigatorObject = globalThis.navigator,
    timer = globalThis,
    secureContext = globalThis.isSecureContext,
    now = () => Date.now(),
    controlResponseTimeoutMs = CONTROL_RESPONSE_TIMEOUT_MS,
    firstEcgTimeoutMs = FIRST_ECG_TIMEOUT_MS,
    firstHeartRateTimeoutMs = FIRST_HEART_RATE_TIMEOUT_MS,
    firstAccelerometerTimeoutMs = FIRST_ACCELEROMETER_TIMEOUT_MS,
    stageTimeoutMs = GATT_STAGE_TIMEOUT_MS,
    liveEcgTimeoutMs = POLAR_LIVE_ECG_TIMEOUT_MS,
    streamSetupRetryDelaysMs = STREAM_SETUP_RETRY_DELAYS_MS,
    allowQuestExperiment = false,
  } = {}) {
    this.navigatorObject = navigatorObject;
    this.timer = timer;
    this.secureContext = secureContext;
    this.now = now;
    this.controlResponseTimeoutMs = controlResponseTimeoutMs;
    this.firstEcgTimeoutMs = firstEcgTimeoutMs;
    this.firstHeartRateTimeoutMs = firstHeartRateTimeoutMs;
    this.firstAccelerometerTimeoutMs = firstAccelerometerTimeoutMs;
    this.stageTimeoutMs = Math.max(
      1,
      Number(stageTimeoutMs) || GATT_STAGE_TIMEOUT_MS,
    );
    this.streamSetupRetryDelaysMs = Array.from(
      streamSetupRetryDelaysMs ?? STREAM_SETUP_RETRY_DELAYS_MS,
      (delay) => Math.max(0, Number(delay) || 0),
    );
    this.liveEcgTimeoutMs = Math.max(
      1,
      Number(liveEcgTimeoutMs) || POLAR_LIVE_ECG_TIMEOUT_MS,
    );
    this.allowQuestExperiment = allowQuestExperiment;
    this.processor = new PolarMetricProcessor();
    this.breathingProcessor = new PolarBreathingProcessor();
    this.browserLeaseHeld = false;
    this.browserLeaseRelease = null;
    this.browserLeaseTask = null;
    this.ecgWatchdogTimer = undefined;
    this.liveRecoveryPromise = null;
    this.liveRecoveryAttempts = 0;
    this.stopRequested = false;
    this.diagnosticState = this.createDiagnosticState();
    this.resetConnectionState();
    this.boundPmd = (event) => this.handlePmd(event);
    this.boundHeartRate = (event) => this.handleHeartRate(event);
    this.boundControl = (event) => this.handleControl(event);
    this.boundDisconnected = () => this.handleDisconnected();
  }

  resetConnectionState() {
    this.clearLiveEcgWatchdog();
    this.rejectWaiter(
      this.pendingControlResponse,
      new PolarStreamError("PMD_SESSION_ENDED", "The Polar PMD session ended."),
    );
    this.rejectWaiter(
      this.firstEcgFrame,
      new PolarStreamError("PMD_SESSION_ENDED", "The Polar PMD session ended."),
    );
    this.rejectWaiter(
      this.firstHeartRateFrame,
      new PolarStreamError("PMD_SESSION_ENDED", "The Polar PMD session ended."),
    );
    this.rejectWaiter(
      this.firstAccelerometerFrame,
      new PolarStreamError("PMD_SESSION_ENDED", "The Polar PMD session ended."),
    );
    this.device = null;
    this.server = null;
    this.control = null;
    this.pmdData = null;
    this.heartRate = null;
    this.connected = false;
    this.disconnecting = false;
    this.recoveringLiveEcg = false;
    this.pendingControlResponse = null;
    this.firstEcgFrame = null;
    this.firstHeartRateFrame = null;
    this.firstAccelerometerFrame = null;
    this.currentStage = "idle";
    this.streamStartedAtMs = undefined;
    this.streamInitialSampleCount = 0;
    this.lastEcgFrameAtMs = undefined;
    this.lastHeartRateFrameAtMs = undefined;
    this.lastAccelerometerFrameAtMs = undefined;
    this.ecgFrameCount = 0;
    this.heartRateFrameCount = 0;
    this.accelerometerFrameCount = 0;
    this.maximumEcgGapMs = 0;
  }

  createDiagnosticState() {
    return {
      secureContext: Boolean(this.secureContext),
      apiAvailable:
        typeof this.navigatorObject?.bluetooth?.requestDevice === "function",
      adapterAvailability: "unknown",
      userActivationAtRequest: "unknown",
      chooser: "idle",
      stage: "idle",
      gattAttempt: 0,
      gattAttemptsTotal: GATT_CONNECT_RETRY_DELAYS_MS.length + 1,
      streamSetupAttempt: 0,
      streamSetupAttemptsTotal: this.streamSetupRetryDelaysMs.length + 1,
      liveRecoveryAttempt: 0,
      liveRecoveryAttemptsTotal: POLAR_LIVE_ECG_RECOVERY_ATTEMPTS,
      pmdResponse: "not started",
      firstEcgFrame: false,
      firstHeartRateFrame: false,
      firstAccelerometerFrame: false,
      mtu: "browser-managed",
      connectStartedAtMs: undefined,
      readyInMs: undefined,
      stageTimeoutMs: this.stageTimeoutMs,
      tabLease:
        typeof this.navigatorObject?.locks?.request === "function"
          ? "available"
          : "unsupported",
      lastErrorCode: "",
      lastErrorMessage: "",
    };
  }

  diagnosticSnapshot() {
    return { ...this.diagnosticState };
  }

  updateDiagnostics(patch) {
    Object.assign(this.diagnosticState, patch);
    this.emit({ kind: "diagnostic", snapshot: this.diagnosticSnapshot() });
  }

  readBluetoothAvailability() {
    if (
      typeof this.navigatorObject?.bluetooth?.getAvailability !== "function"
    ) {
      return Promise.resolve("unknown");
    }
    try {
      return Promise.resolve(this.navigatorObject.bluetooth.getAvailability())
        .then((available) => (available === true ? "available" : "unavailable"))
        .catch(() => "unknown");
    } catch {
      return Promise.resolve("unknown");
    }
  }

  async connect(onEvent) {
    const support = polarWebBluetoothSupport({
      secureContext: this.secureContext,
      navigatorObject: this.navigatorObject,
      allowQuestExperiment: this.allowQuestExperiment,
    });
    if (!support.supported)
      throw new PolarStreamError("WEB_BLUETOOTH_UNAVAILABLE", support.reason);
    if (this.device || this.connected)
      throw new PolarStreamError(
        "BROWSER_BLE_BUSY",
        "Disconnect the current H10 before choosing another.",
        true,
      );
    this.onEvent = onEvent;
    this.stopRequested = false;
    this.liveRecoveryAttempts = 0;
    this.processor.reset();
    this.breathingProcessor.reset();
    this.diagnosticState = this.createDiagnosticState();
    this.updateDiagnostics({
      stage: "chooser",
      chooser: "opening",
      connectStartedAtMs: this.now(),
    });
    try {
      this.emit({
        kind: "status",
        message: "Choose your Polar H10 in the browser Bluetooth prompt…",
      });
      const userActivation = this.navigatorObject?.userActivation?.isActive;
      this.updateDiagnostics({
        userActivationAtRequest:
          typeof userActivation === "boolean" ? userActivation : "unknown",
      });
      // Invoke requestDevice before any other asynchronous browser API so the
      // chooser retains the initiating click/touch activation in strict Chromium.
      const chooserPromise = this.navigatorObject.bluetooth.requestDevice({
        filters: [
          { namePrefix: "Polar H10" },
          { services: [POLAR_UUIDS.heartRateService] },
        ],
        optionalServices: [
          POLAR_UUIDS.pmdService,
          POLAR_UUIDS.heartRateService,
        ],
      });
      const availabilityPromise = this.readBluetoothAvailability();
      try {
        this.device = await chooserPromise;
      } catch (error) {
        this.updateDiagnostics({
          adapterAvailability: await availabilityPromise,
          chooser: "closed without selection",
        });
        throw error;
      }
      this.updateDiagnostics({ chooser: "selected" });
      void availabilityPromise.then((adapterAvailability) => {
        this.updateDiagnostics({ adapterAvailability });
      });
      await this.acquireBrowserLease();
      this.device.addEventListener(
        "gattserverdisconnected",
        this.boundDisconnected,
      );
      await this.connectSelectedDeviceWithRecovery();
      this.connected = true;
      const readyAtMs = this.now();
      const connectStartedAtMs = Number(
        this.diagnosticState.connectStartedAtMs,
      );
      this.updateDiagnostics({
        stage: "live",
        liveRecoveryAttempt: 0,
        readyInMs: Number.isFinite(connectStartedAtMs)
          ? Math.max(0, readyAtMs - connectStartedAtMs)
          : undefined,
      });
      this.emit({
        kind: "connection",
        connected: true,
        streamHealth: this.streamHealth(),
        message: "Polar H10 HR + 130 Hz ECG + 200 Hz ACC are live",
      });
      this.armLiveEcgWatchdog();
    } catch (error) {
      const normalized = normalizeBluetoothError(error, support.questBrowser);
      await this.disconnect({ emit: false });
      this.updateDiagnostics({
        stage: "failed",
        lastErrorCode: normalized.code,
        lastErrorMessage: normalized.message,
      });
      this.onEvent = null;
      throw normalized;
    }
  }

  async connectSelectedDeviceWithRecovery() {
    let lastError;
    const selectedDevice = this.device;
    const totalAttempts = this.streamSetupRetryDelaysMs.length + 1;
    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      this.updateDiagnostics({ streamSetupAttempt: attempt });
      try {
        return await this.connectSelectedDevice();
      } catch (error) {
        lastError = error;
        if (attempt === totalAttempts || !retryableStreamSetupError(error))
          throw error;

        await this.disconnect({ emit: false, releaseLease: false });
        this.processor.reset();
        this.breathingProcessor.reset();
        this.device = selectedDevice;
        if (!this.device) throw error;
        this.device.addEventListener(
          "gattserverdisconnected",
          this.boundDisconnected,
        );
        this.emit({
          kind: "status",
          message: `Polar link setup dropped; retrying the full HR, ECG, and ACC setup ${attempt + 1}/${totalAttempts}…`,
        });
        await new Promise((resolve) =>
          this.timer.setTimeout(
            resolve,
            this.streamSetupRetryDelaysMs[attempt - 1],
          ),
        );
      }
    }
    throw lastError;
  }

  async connectSelectedDevice() {
    this.emit({
      kind: "status",
      message: "Connecting to the H10 Bluetooth link…",
    });
    this.server = await this.runStage("GATT_CONNECT", "Bluetooth link", () =>
      this.connectGatt(),
    );
    this.emit({ kind: "status", message: "Discovering Polar PMD ECG…" });
    const pmdService = await this.runStage(
      "PMD_SERVICE",
      "Polar PMD service discovery",
      () => this.server.getPrimaryService(POLAR_UUIDS.pmdService),
    );
    this.control = await this.runStage(
      "PMD_CONTROL",
      "Polar PMD control discovery",
      () => pmdService.getCharacteristic(POLAR_UUIDS.pmdControl),
    );
    this.pmdData = await this.runStage(
      "PMD_DATA",
      "Polar PMD data discovery",
      () => pmdService.getCharacteristic(POLAR_UUIDS.pmdData),
    );
    this.control.addEventListener(
      "characteristicvaluechanged",
      this.boundControl,
    );
    this.pmdData.addEventListener("characteristicvaluechanged", this.boundPmd);
    this.emit({
      kind: "status",
      message: "Opening the live ECG data channel…",
    });
    await this.runStage("PMD_DATA_NOTIFY", "Polar ECG data notifications", () =>
      this.pmdData.startNotifications(),
    );
    await this.runStage(
      "PMD_CONTROL_NOTIFY",
      "Polar PMD control indications",
      () => this.control.startNotifications(),
    );
    const heartRateService = await this.runStage(
      "HEART_RATE_SERVICE",
      "Polar heart-rate service discovery",
      () =>
        this.server.getPrimaryService(
          POLAR_UUIDS.heartRateService,
        ),
    );
    this.heartRate = await this.runStage(
      "HEART_RATE_MEASUREMENT",
      "Polar heart-rate measurement discovery",
      () =>
        heartRateService.getCharacteristic(
          POLAR_UUIDS.heartRateMeasurement,
        ),
    );
    this.heartRate.addEventListener(
      "characteristicvaluechanged",
      this.boundHeartRate,
    );
    this.firstHeartRateFrame = this.createWaiter(
      this.firstHeartRateTimeoutMs,
      new PolarStreamError(
        "PMD_FIRST_HEART_RATE_TIMEOUT",
        "The H10 connected but did not deliver a live heart-rate frame. Keep the worn strap wet and disconnect other Polar apps or tabs before retrying.",
        true,
      ),
    );
    await this.runStage(
      "HEART_RATE_NOTIFY",
      "Polar heart-rate notifications",
      () => this.heartRate.startNotifications(),
    );
    this.emit({
      kind: "status",
      message: "Starting 130 Hz ECG and waiting for the first live packet…",
    });
    await this.runStage("ECG_START", "Polar ECG startup", () =>
      this.startEcgAndWaitForData(),
    );
    this.emit({
      kind: "status",
      message:
        "ECG is live; starting 200 Hz chest accelerometer for breathing control…",
    });
    await this.runStage("ACC_START", "Polar accelerometer startup", () =>
      this.startAccelerometerAndWaitForData(),
    );
    await this.runStage(
      "HEART_RATE_FIRST_FRAME",
      "Polar live heart-rate stream",
      () => this.firstHeartRateFrame.promise,
    );
    this.firstHeartRateFrame = null;
    this.updateDiagnostics({ firstHeartRateFrame: true });
    if (!this.server?.connected)
      throw new PolarStreamError(
        "BLUETOOTH_LINK_LOST_DURING_SETUP",
        "The H10 Bluetooth link dropped before all live signals were ready.",
        true,
      );
  }

  async connectGatt() {
    let lastError;
    const totalAttempts = GATT_CONNECT_RETRY_DELAYS_MS.length + 1;
    for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
      this.updateDiagnostics({ gattAttempt: attempt + 1 });
      try {
        return await this.device.gatt.connect();
      } catch (error) {
        lastError = error;
        const transient = ["AbortError", "NetworkError"].includes(error?.name);
        if (!transient || attempt === totalAttempts - 1) throw error;
        const delayMs = GATT_CONNECT_RETRY_DELAYS_MS[attempt];
        this.emit({
          kind: "status",
          message: `Bluetooth link attempt ${attempt + 1} failed; retrying ${attempt + 2}/${totalAttempts} in ${(delayMs / 1_000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} s…`,
        });
        await new Promise((resolve) => this.timer.setTimeout(resolve, delayMs));
      }
    }
    throw lastError;
  }

  async runStage(code, label, operation) {
    this.currentStage = code;
    this.updateDiagnostics({ stage: code });
    let timeoutId;
    try {
      const operationPromise = Promise.resolve().then(operation);
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = this.timer.setTimeout(() => {
          const error = new Error(
            `${label} did not finish within ${Math.round(this.stageTimeoutMs / 1_000)} seconds. Chrome's Bluetooth GATT request stalled.`,
          );
          error.name = "TimeoutError";
          reject(error);
        }, this.stageTimeoutMs);
      });
      return await Promise.race([operationPromise, timeoutPromise]);
    } catch (error) {
      const staged = bluetoothStageError(error, code, label);
      this.updateDiagnostics({
        lastErrorCode: staged.code,
        lastErrorMessage: staged.message,
      });
      throw staged;
    } finally {
      if (timeoutId !== undefined) this.timer.clearTimeout?.(timeoutId);
    }
  }

  async acquireBrowserLease() {
    if (this.browserLeaseHeld) return;
    const locks = this.navigatorObject?.locks;
    if (typeof locks?.request !== "function") return;

    let resolveAvailability;
    let rejectAvailability;
    const availability = new Promise((resolve, reject) => {
      resolveAvailability = resolve;
      rejectAvailability = reject;
    });
    let releaseHold;
    const hold = new Promise((resolve) => {
      releaseHold = resolve;
    });
    const leaseTask = Promise.resolve().then(() =>
      locks.request(
        POLAR_BROWSER_LEASE,
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (!lock) {
            resolveAvailability(false);
            return;
          }
          this.browserLeaseHeld = true;
          this.browserLeaseRelease = releaseHold;
          this.updateDiagnostics({ tabLease: "held" });
          resolveAvailability(true);
          await hold;
        },
      ),
    );
    this.browserLeaseTask = leaseTask;
    void leaseTask.catch(rejectAvailability);

    const acquired = await availability;
    if (acquired) return;
    this.browserLeaseTask = null;
    this.updateDiagnostics({ tabLease: "busy" });
    throw new PolarStreamError(
      "POLAR_SESSION_IN_USE",
      "Another ECGaming tab already owns the Polar H10. Disconnect it there first, or keep Ground Control as the single sensor owner and use its game relay.",
      true,
    );
  }

  async releaseBrowserLease() {
    const release = this.browserLeaseRelease;
    const task = this.browserLeaseTask;
    this.browserLeaseHeld = false;
    this.browserLeaseRelease = null;
    this.browserLeaseTask = null;
    release?.();
    await task?.catch(() => {});
    this.updateDiagnostics({
      tabLease:
        typeof this.navigatorObject?.locks?.request === "function"
          ? "released"
          : "unsupported",
    });
  }

  clearLiveEcgWatchdog() {
    if (this.ecgWatchdogTimer !== undefined)
      this.timer.clearTimeout?.(this.ecgWatchdogTimer);
    this.ecgWatchdogTimer = undefined;
  }

  armLiveEcgWatchdog() {
    this.clearLiveEcgWatchdog();
    const lastFrames = [
      this.lastEcgFrameAtMs,
      this.lastHeartRateFrameAtMs,
      this.lastAccelerometerFrameAtMs,
    ];
    if (
      !this.connected ||
      this.recoveringLiveEcg ||
      this.stopRequested ||
      lastFrames.some((timestamp) => !Number.isFinite(timestamp))
    )
      return;
    const oldestFrameAtMs = Math.min(...lastFrames);
    const delayMs = Math.max(
      1,
      oldestFrameAtMs + this.liveEcgTimeoutMs - this.now(),
    );
    this.ecgWatchdogTimer = this.timer.setTimeout(
      () => {
        this.ecgWatchdogTimer = undefined;
        void this.handleLiveEcgWatchdog();
      },
      Math.max(1, delayMs),
    );
  }

  async handleLiveEcgWatchdog() {
    if (
      !this.connected ||
      this.recoveringLiveEcg ||
      this.stopRequested
    )
      return;
    const now = this.now();
    const packetAges = {
      ECG: Math.max(0, now - this.lastEcgFrameAtMs),
      "heart rate": Math.max(0, now - this.lastHeartRateFrameAtMs),
      accelerometer: Math.max(0, now - this.lastAccelerometerFrameAtMs),
    };
    const staleSignals = Object.entries(packetAges)
      .filter(([, ageMs]) => ageMs >= this.liveEcgTimeoutMs)
      .map(([label]) => label);
    if (!staleSignals.length) {
      this.armLiveEcgWatchdog();
      return;
    }
    if (this.liveRecoveryPromise) return;
    const packetAgeMs = Math.max(...Object.values(packetAges));
    this.liveRecoveryPromise = this.recoverLiveEcgStream(
      packetAgeMs,
      staleSignals,
    ).finally(() => {
      this.liveRecoveryPromise = null;
    });
    await this.liveRecoveryPromise;
  }

  async failLiveEcgSession(error) {
    this.stopRequested = true;
    this.connected = false;
    this.recoveringLiveEcg = false;
    this.updateDiagnostics({
      stage: "failed",
      firstEcgFrame: false,
      firstHeartRateFrame: false,
      firstAccelerometerFrame: false,
      lastErrorCode: error.code,
      lastErrorMessage: error.message,
    });
    this.emit({
      kind: "connection",
      connected: false,
      error: true,
      message: error.message,
    });
    await this.disconnect({ emit: false });
    this.onEvent = null;
  }

  async recoverLiveEcgStream(packetAgeMs, staleSignals = ["ECG"]) {
    const stalledLabel = staleSignals.join(", ");
    if (this.liveRecoveryAttempts >= POLAR_LIVE_ECG_RECOVERY_ATTEMPTS) {
      await this.failLiveEcgSession(
        new PolarStreamError(
          "POLAR_LIVE_SIGNAL_STALLED",
          `Live Polar ${stalledLabel} data stopped for ${Math.round(packetAgeMs / 1_000)} seconds after the bounded automatic restart. Press Connect to choose the worn H10 again.`,
          true,
        ),
      );
      return;
    }

    this.liveRecoveryAttempts += 1;
    const recoveryAttempt = this.liveRecoveryAttempts;
    const selectedDevice = this.device;
    this.recoveringLiveEcg = true;
    this.connected = false;
    this.updateDiagnostics({
      stage: "recovering",
      firstEcgFrame: false,
      firstHeartRateFrame: false,
      firstAccelerometerFrame: false,
      liveRecoveryAttempt: recoveryAttempt,
      lastErrorCode: "POLAR_LIVE_SIGNAL_STALLED",
      lastErrorMessage: `No valid ${stalledLabel} packet for ${Math.round(packetAgeMs / 1_000)} seconds.`,
    });
    this.emit({
      kind: "connection",
      connected: false,
      recovering: true,
      message:
        `Live ${stalledLabel} data paused; restarting the same browser-selected H10 without another chooser…`,
    });

    await this.disconnect({ emit: false, releaseLease: false });
    if (this.stopRequested || !selectedDevice) return;
    this.processor.reset();
    this.breathingProcessor.reset();
    this.device = selectedDevice;
    this.device.addEventListener(
      "gattserverdisconnected",
      this.boundDisconnected,
    );
    this.recoveringLiveEcg = true;
    this.updateDiagnostics({
      stage: "recovering",
      streamSetupAttempt: 0,
      liveRecoveryAttempt: recoveryAttempt,
    });

    try {
      await this.connectSelectedDeviceWithRecovery();
      if (this.stopRequested) {
        await this.disconnect({ emit: false, releaseLease: false });
        return;
      }
      this.connected = true;
      this.recoveringLiveEcg = false;
      this.updateDiagnostics({
        stage: "live",
        firstEcgFrame: true,
        firstHeartRateFrame: true,
        firstAccelerometerFrame: true,
        liveRecoveryAttempt: recoveryAttempt,
        lastErrorCode: "",
        lastErrorMessage: "",
      });
      this.emit({
        kind: "connection",
        connected: true,
        recovered: true,
        streamHealth: this.streamHealth(),
        message:
          "Polar H10 HR, ECG, and ACC recovered without reopening the Bluetooth chooser",
      });
      this.armLiveEcgWatchdog();
    } catch (error) {
      const support = polarWebBluetoothSupport({
        secureContext: this.secureContext,
        navigatorObject: this.navigatorObject,
        allowQuestExperiment: this.allowQuestExperiment,
      });
      await this.failLiveEcgSession(
        normalizeBluetoothError(error, support.questBrowser),
      );
    }
  }

  createWaiter(timeoutMs, timeoutError) {
    let resolve;
    let reject;
    const waiter = {
      settled: false,
      timerId: undefined,
      promise: new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      }),
    };
    waiter.resolve = (value) => {
      if (waiter.settled) return;
      waiter.settled = true;
      if (waiter.timerId !== undefined)
        this.timer.clearTimeout?.(waiter.timerId);
      resolve(value);
    };
    waiter.reject = (error) => {
      if (waiter.settled) return;
      waiter.settled = true;
      if (waiter.timerId !== undefined)
        this.timer.clearTimeout?.(waiter.timerId);
      reject(error);
    };
    waiter.timerId = this.timer.setTimeout(
      () => waiter.reject(timeoutError),
      timeoutMs,
    );
    // A GATT write may fail before the corresponding waiter is awaited. Attach a
    // rejection observer immediately while preserving rejection for the real await.
    void waiter.promise.catch(() => {});
    return waiter;
  }

  rejectWaiter(waiter, error) {
    waiter?.reject?.(error);
  }

  async startEcgAndWaitForData() {
    this.updateDiagnostics({ pmdResponse: "waiting", firstEcgFrame: false });
    const response = this.createWaiter(
      this.controlResponseTimeoutMs,
      new PolarStreamError(
        "PMD_CONTROL_TIMEOUT",
        "The H10 did not acknowledge the ECG start command. Disconnect it from any other app or tab and retry.",
        true,
      ),
    );
    response.command = POLAR_COMMANDS.startEcg[0];
    response.measurement = POLAR_COMMANDS.startEcg[1];
    this.pendingControlResponse = response;
    const firstFrame = this.createWaiter(
      this.firstEcgTimeoutMs,
      new PolarStreamError(
        "PMD_FIRST_ECG_TIMEOUT",
        "The H10 accepted ECG startup but no live ECG packet arrived. Check strap contact, disconnect other Polar apps/tabs, and retry.",
        true,
      ),
    );
    this.firstEcgFrame = firstFrame;
    try {
      await this.writeControl(POLAR_COMMANDS.startEcg);
      const responseOutcome = response.promise.then(
        (value) => ({ kind: "response", value }),
        (error) => ({ kind: "response-error", error }),
      );
      const frameOutcome = firstFrame.promise.then(
        (value) => ({ kind: "frame", value }),
        (error) => ({ kind: "frame-error", error }),
      );
      const firstOutcome = await Promise.race([responseOutcome, frameOutcome]);
      if (firstOutcome.kind === "response-error") {
        if (firstOutcome.error?.code !== "PMD_CONTROL_TIMEOUT")
          throw firstOutcome.error;
        let streamHealth;
        try {
          streamHealth = await firstFrame.promise;
        } catch {
          throw firstOutcome.error;
        }
        this.updateDiagnostics({
          pmdResponse: "not observed; live ECG confirmed",
          firstEcgFrame: true,
        });
        this.emit({
          kind: "status",
          message:
            "Live ECG confirmed even though Chrome did not deliver the PMD acknowledgement.",
        });
        return streamHealth;
      }
      if (firstOutcome.kind === "frame-error") throw firstOutcome.error;
      if (firstOutcome.kind === "frame") {
        // A valid decoded frame after this command is stronger startup evidence
        // than a control indication that Chromium may omit under link pressure.
        // Briefly preserve the response waiter so an explicit H10 rejection still
        // wins when the data and control characteristics arrive out of order.
        const graceOutcome = await Promise.race([
          responseOutcome,
          new Promise((resolve) =>
            this.timer.setTimeout(
              () => resolve({ kind: "response-grace-expired" }),
              PMD_RESPONSE_GRACE_AFTER_FRAME_MS,
            ),
          ),
        ]);
        if (
          graceOutcome.kind === "response-error" &&
          graceOutcome.error?.code !== "PMD_CONTROL_TIMEOUT"
        ) {
          throw graceOutcome.error;
        }
        if (graceOutcome.kind === "response") {
          this.updateDiagnostics({
            pmdResponse: "acknowledged",
            firstEcgFrame: true,
          });
          return firstOutcome.value;
        }
        response.resolve(firstOutcome.value);
        this.updateDiagnostics({
          pmdResponse: "not observed; live ECG confirmed",
          firstEcgFrame: true,
        });
        this.emit({
          kind: "status",
          message:
            "Live ECG confirmed; the PMD acknowledgement was not required.",
        });
        return firstOutcome.value;
      }
      this.updateDiagnostics({ pmdResponse: "acknowledged" });
      this.emit({
        kind: "status",
        message: "H10 accepted ECG startup; waiting for live samples…",
      });
      const streamHealth = await firstFrame.promise;
      this.updateDiagnostics({ firstEcgFrame: true });
      return streamHealth;
    } catch (error) {
      this.rejectWaiter(response, error);
      this.rejectWaiter(firstFrame, error);
      await Promise.allSettled([response.promise, firstFrame.promise]);
      throw error;
    } finally {
      if (this.pendingControlResponse === response)
        this.pendingControlResponse = null;
      if (this.firstEcgFrame === firstFrame) this.firstEcgFrame = null;
    }
  }

  async startAccelerometerAndWaitForData() {
    const response = this.createWaiter(
      this.controlResponseTimeoutMs,
      new PolarStreamError(
        "PMD_ACC_CONTROL_TIMEOUT",
        "The H10 did not acknowledge accelerometer startup.",
        true,
      ),
    );
    response.command = POLAR_COMMANDS.startAccelerometer[0];
    response.measurement = POLAR_COMMANDS.startAccelerometer[1];
    const firstFrame = this.createWaiter(
      this.firstAccelerometerTimeoutMs,
      new PolarStreamError(
        "PMD_FIRST_ACC_TIMEOUT",
        "The H10 did not deliver a live accelerometer packet.",
        true,
      ),
    );
    this.pendingControlResponse = response;
    this.firstAccelerometerFrame = firstFrame;
    try {
      await this.writeControl(POLAR_COMMANDS.startAccelerometer);
      const first = await Promise.race([
        firstFrame.promise.then((value) => ({ kind: "frame", value })),
        response.promise.then(
          () => ({ kind: "ack" }),
          (error) => ({ kind: "error", error }),
        ),
      ]);
      if (first.kind === "error") throw first.error;
      if (first.kind === "ack") await firstFrame.promise;
      response.resolve(first.value);
      this.updateDiagnostics({ firstAccelerometerFrame: true });
      this.emit({
        kind: "status",
        message:
          "Polar ECG + 200 Hz accelerometer are live; confirming heart rate…",
      });
      return true;
    } catch (error) {
      this.rejectWaiter(response, error);
      this.rejectWaiter(firstFrame, error);
      await Promise.allSettled([response.promise, firstFrame.promise]);
      throw error;
    } finally {
      if (this.pendingControlResponse === response)
        this.pendingControlResponse = null;
      if (this.firstAccelerometerFrame === firstFrame)
        this.firstAccelerometerFrame = null;
    }
  }

  async writeControl(command) {
    const value = Uint8Array.from(command);
    if (typeof this.control.writeValueWithResponse === "function")
      await this.control.writeValueWithResponse(value);
    else await this.control.writeValue(value);
  }

  handlePmd(event) {
    try {
      const frame = decodePolarEcg(event.target.value);
      if (!frame) {
        const accelerometer = decodePolarAccelerometer(event.target.value);
        if (!accelerometer) return;
        const breathing = this.breathingProcessor.pushTimed(
          accelerometer.samples,
          accelerometer.sensorTimestampNs,
        );
        const receivedAtMs = this.now();
        this.lastAccelerometerFrameAtMs = receivedAtMs;
        this.accelerometerFrameCount += 1;
        this.updateDiagnostics({ firstAccelerometerFrame: true });
        this.firstAccelerometerFrame?.resolve({
          sampleCount: accelerometer.samples.length,
          receivedAtMs,
        });
        this.emit({
          kind: "accelerometer",
          ...accelerometer,
          breathing,
          receivedAtMs,
        });
        if (this.connected && !this.recoveringLiveEcg)
          this.armLiveEcgWatchdog();
        if (breathing) {
          const heartSnapshot = this.processor.snapshot();
          const breathingValues = Object.fromEntries(
            Object.entries(breathing.values).filter(([, value]) =>
              Number.isFinite(value),
            ),
          );
          this.emit({
            kind: "metrics",
            snapshot: {
              ...heartSnapshot,
              values: { ...heartSnapshot.values, ...breathingValues },
              breathing,
            },
          });
        }
        return;
      }
      const snapshot = this.processor.pushEcg(frame.microvolts);
      const receivedAtMs = this.now();
      if (!Number.isFinite(this.streamStartedAtMs)) {
        this.streamStartedAtMs = receivedAtMs;
        this.streamInitialSampleCount = this.processor.totalEcgSamples;
      }
      if (Number.isFinite(this.lastEcgFrameAtMs)) {
        this.maximumEcgGapMs = Math.max(
          this.maximumEcgGapMs,
          receivedAtMs - this.lastEcgFrameAtMs,
        );
      }
      this.lastEcgFrameAtMs = receivedAtMs;
      this.ecgFrameCount += 1;
      const streamHealth = this.streamHealth();
      this.updateDiagnostics({ firstEcgFrame: true });
      this.firstEcgFrame?.resolve(streamHealth);
      this.emit({ kind: "ecg", ...frame, snapshot, streamHealth });
      this.emit({ kind: "metrics", snapshot });
      if (this.connected && !this.recoveringLiveEcg) this.armLiveEcgWatchdog();
    } catch (error) {
      this.emit({
        kind: "error",
        message: `Skipped malformed Polar ECG frame: ${error.message}`,
      });
    }
  }

  handleHeartRate(event) {
    const frame = decodePolarHeartRate(event.target.value);
    const snapshot = this.processor.pushHeartRate(frame);
    if (frame.beatsPerMinute > 0) {
      this.lastHeartRateFrameAtMs = this.now();
      this.heartRateFrameCount += 1;
      this.updateDiagnostics({ firstHeartRateFrame: true });
      this.firstHeartRateFrame?.resolve({
        beatsPerMinute: frame.beatsPerMinute,
        rrCount: frame.rrIntervalsMs.length,
        receivedAtMs: this.now(),
      });
      if (this.connected && !this.recoveringLiveEcg)
        this.armLiveEcgWatchdog();
    }
    // ECGaming needs the count and timing of every RR value, not only the
    // latest derived snapshot. Keep the original metrics event for source
    // compatibility and add a lossless, derived HR/RR event (never raw ECG).
    this.emit({ kind: "heart-rate", ...frame, snapshot });
    this.emit({ kind: "metrics", snapshot });
  }

  handleControl(event) {
    const bytes = bytesFrom(event.target.value);
    if (bytes.length < 4 || bytes[0] !== 0xf0) return;
    const pending = this.pendingControlResponse;
    if (
      !pending ||
      bytes[1] !== pending.command ||
      bytes[2] !== pending.measurement
    )
      return;
    if (bytes[3] === 0) {
      this.updateDiagnostics({ pmdResponse: "acknowledged" });
      pending.resolve(bytes);
    } else {
      const signalLabel =
        pending.measurement === POLAR_COMMANDS.startAccelerometer[1]
          ? "accelerometer"
          : "ECG";
      const error = new PolarStreamError(
        "PMD_COMMAND_REJECTED",
        `The H10 rejected ${signalLabel} startup (PMD status ${bytes[3]}). Disconnect Polar streaming in another app or tab, then retry.`,
        true,
      );
      this.updateDiagnostics({
        pmdResponse: `rejected (status ${bytes[3]})`,
        lastErrorCode: error.code,
        lastErrorMessage: error.message,
      });
      pending.reject(error);
    }
  }

  streamHealth() {
    const elapsedMs =
      Number.isFinite(this.streamStartedAtMs) &&
      Number.isFinite(this.lastEcgFrameAtMs)
        ? Math.max(0, this.lastEcgFrameAtMs - this.streamStartedAtMs)
        : 0;
    return {
      frameCount: this.ecgFrameCount,
      heartRateFrameCount: this.heartRateFrameCount,
      accelerometerFrameCount: this.accelerometerFrameCount,
      sampleCount: this.processor.totalEcgSamples,
      observedSampleRateHz:
        elapsedMs > 0
          ? ((this.processor.totalEcgSamples - this.streamInitialSampleCount) *
              1000) /
            elapsedMs
          : 130,
      maximumGapMs: this.maximumEcgGapMs,
      elapsedMs,
    };
  }

  async disconnect({ emit = true, releaseLease = true } = {}) {
    if (emit) this.stopRequested = true;
    if (this.disconnecting) return;
    this.disconnecting = true;
    if (emit) this.updateDiagnostics({ stage: "disconnecting" });
    const wasConnected = this.connected;
    try {
      if (this.server?.connected && this.control) {
        try {
          await this.writeControl(POLAR_COMMANDS.stopEcg);
        } catch {
          /* best effort */
        }
        try {
          await this.writeControl(POLAR_COMMANDS.stopAccelerometer);
        } catch {
          /* best effort */
        }
      }
      await this.stopCharacteristic(this.pmdData, this.boundPmd);
      await this.stopCharacteristic(this.control, this.boundControl);
      await this.stopCharacteristic(this.heartRate, this.boundHeartRate);
      this.device?.removeEventListener(
        "gattserverdisconnected",
        this.boundDisconnected,
      );
      if (this.server?.connected) this.server.disconnect();
    } finally {
      this.resetConnectionState();
    }
    if (releaseLease) await this.releaseBrowserLease();
    if (emit)
      this.updateDiagnostics({
        stage: "idle",
        chooser: "idle",
        pmdResponse: "not started",
        firstEcgFrame: false,
        lastErrorCode: "",
        lastErrorMessage: "",
      });
    if (emit && (wasConnected || this.onEvent))
      this.emit({
        kind: "connection",
        connected: false,
        message: "Polar H10 disconnected",
      });
    if (emit) this.onEvent = null;
  }

  async stopCharacteristic(characteristic, listener) {
    if (!characteristic) return;
    characteristic.removeEventListener("characteristicvaluechanged", listener);
    try {
      await characteristic.stopNotifications();
    } catch {
      /* best effort */
    }
  }

  handleDisconnected() {
    if (this.disconnecting) return;
    if (!this.connected) {
      const error = new PolarStreamError(
        "BLUETOOTH_LINK_LOST_DURING_SETUP",
        "The H10 Bluetooth link dropped while its HR, ECG, and ACC services were being prepared.",
        true,
      );
      this.rejectWaiter(this.pendingControlResponse, error);
      this.rejectWaiter(this.firstEcgFrame, error);
      this.rejectWaiter(this.firstHeartRateFrame, error);
      this.rejectWaiter(this.firstAccelerometerFrame, error);
      this.pendingControlResponse = null;
      this.firstEcgFrame = null;
      this.firstHeartRateFrame = null;
      this.firstAccelerometerFrame = null;
      this.updateDiagnostics({
        stage: "setup_disconnected",
        firstEcgFrame: false,
        firstHeartRateFrame: false,
        firstAccelerometerFrame: false,
        lastErrorCode: error.code,
        lastErrorMessage: error.message,
      });
      this.emit({
        kind: "status",
        message: "Polar link dropped during setup; preparing an automatic reconnect…",
      });
      return;
    }
    this.stopRequested = true;
    this.resetConnectionState();
    this.updateDiagnostics({
      stage: "disconnected",
      lastErrorCode: "BLUETOOTH_LINK_LOST",
      lastErrorMessage: "The Polar H10 left Bluetooth range or disconnected.",
    });
    this.emit({
      kind: "connection",
      connected: false,
      message: "The Polar H10 left Bluetooth range or disconnected",
    });
    void this.releaseBrowserLease();
    this.onEvent = null;
  }

  emit(event) {
    if (typeof this.onEvent === "function") this.onEvent(event);
  }
}

export function createPolarH10BrowserSession(options) {
  return new PolarH10BrowserSession(options);
}
