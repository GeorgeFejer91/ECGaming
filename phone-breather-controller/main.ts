import { BreathLink, type BreathSignal } from "../src/phone-breather/link";
import { readBreathInvitation, type BreathInvitation } from "../src/phone-breather/invitation";
import { BreathLobby, type BreathMessage, type BreathHost } from "../src/phone-breather/breath-lobby";
import { LynphanBreathDetector } from "../src/phone-breather/lynphan";
import { requestBreathMotionPermission, WebBreathMotionSource } from "../src/phone-breather/web-motion";
import { randomToken } from "../src/vendor/brsp/src/brsp.js";
import "./styles.css";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id)! as T;

const nameForm = byId<HTMLFormElement>("name-form");
const nameInput = byId<HTMLInputElement>("controller-name");
const hostNameInput = byId<HTMLInputElement>("host-name-field");
const entryFeedback = byId("entry-feedback");
const hostChoices = byId("host-choices");
const entrySection = byId("entry-section");
const controlsSection = byId("controls-section");
const otherSideMode = new URLSearchParams(location.search).get("experience") === "other-side";
if (otherSideMode) document.documentElement.dataset.experience = "other-side";

const statusIndicator = byId("status-indicator");
const statusText = byId("status-text");

const breathCircle = byId<SVGCircleElement>("breath-circle");
const breathRingOuter = byId<SVGCircleElement>("breath-ring-outer");
const breathRingInner = byId<SVGCircleElement>("breath-ring-inner");
const breathCenter = byId<SVGCircleElement>("breath-center");
const phaseLabel = byId("phase-label");
const hostNameEl = byId("host-name");

const metricVolume = byId("metric-volume");
const metricPhase = byId("metric-phase");
const metricFlow = byId("metric-flow");
const metricConfidence = byId("metric-confidence");
const metricBpm = byId("metric-bpm");

const disconnectBtn = byId<HTMLButtonElement>("disconnect-btn");

const MIN_RADIUS = 40;
const MAX_RADIUS = 160;
let currentRadius = 100;
let targetRadius = 100;
let animationFrame = 0;

const breathLink = new BreathLink("controller");
const breath = new LynphanBreathDetector();
let currentInvitation: BreathInvitation | null = null;
let godName = "";
let sensorActive = false;
let sensorModeLabel = "motion sensor";

let lobby: BreathLobby | undefined;
let lobbyTimer: ReturnType<typeof setTimeout> | undefined;
let requestId = "";
let requestSent = false;
let requestReceived = false;
let resendTimer: ReturnType<typeof setInterval> | undefined;
let requestMode = false;
let requestName = "";
let requestHint = "";

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function radiusForVolume(v: number) {
  return lerp(MIN_RADIUS, MAX_RADIUS, Math.max(0, Math.min(1, v)));
}

function animate() {
  currentRadius += (targetRadius - currentRadius) * 0.15;
  const r = radiusForVolume(currentRadius / MAX_RADIUS);
  breathCircle.setAttribute("r", r.toFixed(1));
  breathRingOuter.setAttribute("r", (r + 30).toFixed(1));
  breathRingInner.setAttribute("r", (r * 0.6).toFixed(1));
  animationFrame = requestAnimationFrame(animate);
}

function updateVisuals(signal: BreathSignal) {
  targetRadius = radiusForVolume(signal.volume01);
  const phaseText = signal.phase === 1 ? "Inhale" : signal.phase === -1 ? "Exhale" : "Hold";
  phaseLabel.textContent = phaseText;
  phaseLabel.dataset.phase = signal.phase === 1 ? "inhale" : signal.phase === -1 ? "exhale" : "hold";
  metricVolume.textContent = signal.volume01.toFixed(2);
  metricPhase.textContent = phaseText;
  metricFlow.textContent = signal.flow01.toFixed(2);
  metricConfidence.textContent = `${Math.round(signal.confidence01 * 100)}%`;
  metricBpm.textContent = Number.isFinite(signal.bpm) && signal.bpm > 0
    ? `${Math.round(signal.bpm)}`
    : "\u2014";
  statusIndicator.className = "status-indicator connected";
  statusText.textContent = otherSideMode ? `Body signal live · ${sensorModeLabel}` : `Connected to host · ${sensorModeLabel}`;
}

function setConnecting(message = "Connecting\u2026") {
  statusIndicator.className = "status-indicator connecting";
  statusText.textContent = message;
}

function setDisconnected(message = "Disconnected") {
  statusIndicator.className = "status-indicator disconnected";
  statusText.textContent = message;
  targetRadius = radiusForVolume(0.5);
  phaseLabel.textContent = "\u2014";
  phaseLabel.dataset.phase = "hold";
  metricVolume.textContent = "\u2014";
  metricPhase.textContent = "\u2014";
  metricFlow.textContent = "\u2014";
  metricConfidence.textContent = "\u2014";
  metricBpm.textContent = "\u2014";
  hostNameEl.textContent = "Host: \u2014";
}

function showControls(hostName: string) {
  entrySection.hidden = true;
  controlsSection.hidden = false;
  hostNameEl.textContent = otherSideMode ? "BODY SENSOR LIVE" : (godName ? `Union with ${godName}` : `Host: ${hostName}`);
}

function showEntry(message = "Enter your name to connect to the breath host.") {
  entrySection.hidden = false;
  controlsSection.hidden = true;
  entryFeedback.textContent = message;
  nameInput.value = otherSideMode ? "Breather" : "";
  setDisconnected();
}

const motionSource = new WebBreathMotionSource({
  frequencyHz: 60,
  onSample: (sample) => {
    if (!sensorActive) return;
    const snapshot = breath.pushSample(
      { x: sample.x / 9.80665, y: sample.y / 9.80665, z: sample.z / 9.80665 },
      sample.timeMs,
    );
    const grossMotionPenalty = Math.max(
      0.15,
      1 - sample.angularSpeedRadPerSecond / 1.4,
    );
    const sensorConfidence =
      (0.72 + 0.28 * sample.fusionConfidence01) * grossMotionPenalty;
    const signal: BreathSignal = {
      volume01: snapshot.volume01,
      phase: snapshot.phase,
      flow01: snapshot.flow01,
      confidence01: Math.max(
        0,
        Math.min(1, snapshot.confidence01 * sensorConfidence),
      ),
      timestamp: sample.timeMs,
      bpm: snapshot.bpm > 0 ? snapshot.bpm : undefined,
    };
    breathLink.send(signal);
    updateVisuals(signal);
  },
  onStatus: (status) => {
    sensorModeLabel = status.mode
      ? status.mode.replaceAll("-", " ")
      : "motion sensor";
    if (sensorActive && controlsSection.hidden) {
      entryFeedback.textContent = status.message;
    }
  },
});

async function startSensing(): Promise<boolean> {
  if (sensorActive) return true;
  const granted = await requestBreathMotionPermission();
  if (!granted) {
    entryFeedback.textContent =
      "Motion permission denied or no accelerometer is available in this browser.";
    return false;
  }
  breath.reset();
  sensorActive = true;
  motionSource.start();
  return true;
}

function stopSensing() {
  sensorActive = false;
  motionSource.stop();
}

function connect(invitation: BreathInvitation) {
  currentInvitation = invitation;
  stopLobby();
  setConnecting("Pairing with host\u2026");
  breathLink.start(invitation);
}

function stopLobby() {
  clearTimeout(lobbyTimer);
  lobbyTimer = undefined;
  clearInterval(resendTimer);
  resendTimer = undefined;
  lobby?.stop();
  lobby = undefined;
  requestMode = false;
  hostChoices.replaceChildren();
}

function disconnect() {
  breathLink.stop();
  stopSensing();
  stopLobby();
  breath.reset();
  currentInvitation = null;
  showEntry("Disconnected. Enter your name to reconnect.");
}

function startRequest(name: string, hint: string) {
  stopLobby();
  requestMode = true;
  requestName = name;
  requestHint = hint;
  requestId = randomToken(12);
  requestSent = false;
  requestReceived = false;
  hostChoices.replaceChildren();
  entryFeedback.textContent = hint ? `Looking for "${hint}"` : "Looking for a breath screen\u2026";
  setConnecting(entryFeedback.textContent);
  const next = lobby = new BreathLobby("phone", hint || "");
  lobby.addEventListener("status", ((event: CustomEvent<string>) => {
    if (lobby !== next) return;
    const message = event.detail;
    if (message.startsWith("Connecting to ")) {
      entryFeedback.textContent = message;
      setConnecting(message);
    } else if (message.startsWith("Could not")) {
      entryFeedback.textContent = message;
      stopRequest();
    }
  }) as EventListener, { signal: undefined });
  lobby.addEventListener("hosts", ((event: CustomEvent<BreathHost[]>) => {
    if (lobby !== next) return;
    const found = event.detail.filter(h => !hint || h.label === hint);
    if (!found.length) {
      entryFeedback.textContent = hint ? `"${hint}" not found yet` : "No breath screens found yet";
      setConnecting(entryFeedback.textContent);
      return;
    }
    entryFeedback.textContent = `Found ${found.length} screen${found.length === 1 ? "" : "s"}. Choose one:`;
    hostChoices.replaceChildren();
    for (const host of found) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = host.label;
      button.addEventListener("click", () => {
        hostChoices.replaceChildren();
        void lobby!.select(host.id);
      });
      hostChoices.append(button);
    }
  }) as EventListener);
  lobby.addEventListener("peer", ((event: CustomEvent<string>) => {
    if (lobby !== next) return;
    const peer = event.detail;
    if (!requestSent) {
      requestSent = true;
      entryFeedback.textContent = "Request channel open. Sending request\u2026";
      setConnecting(entryFeedback.textContent);
      const sendOnce = () => {
        if (!lobby || !lobby.send(peer, { kind: "request", id: requestId, name: requestName })) {
          entryFeedback.textContent = "Could not send your request. Try again.";
          stopRequest();
          return;
        }
        requestSent = true;
        entryFeedback.textContent = "Request sent. Waiting for the breath screen to accept\u2026";
        setConnecting(entryFeedback.textContent);
        resendTimer = setInterval(() => {
          if (!lobby || requestReceived) { clearInterval(resendTimer); resendTimer = undefined; return; }
          if (requestSent && !requestReceived) {
            clearInterval(resendTimer); resendTimer = undefined;
            entryFeedback.textContent = "Still waiting for the breath screen\u2026";
          }
        }, 10_000);
      };
      sendOnce();
    }
  }) as EventListener);
  lobby.addEventListener("message", ((event: CustomEvent<{ message: BreathMessage }>) => {
    if (lobby !== next) return;
    const message = event.detail.message;
    if (message.id !== requestId) return;
    if (message.kind === "accepted") {
      clearInterval(resendTimer); resendTimer = undefined;
      entryFeedback.textContent = "Accepted. Connecting\u2026";
      connect(message.invitation);
    } else if (message.kind === "declined") {
      clearInterval(resendTimer); resendTimer = undefined;
      entryFeedback.textContent = "The breath screen declined your request.";
      stopRequest();
    } else if (message.kind === "received") {
      requestReceived = true;
      entryFeedback.textContent = "Request received by the breath screen.";
    }
  }) as EventListener);
  lobby.addEventListener("closed", () => {
    if (lobby !== next) return;
    stopRequest();
  });
  lobbyTimer = setTimeout(() => {
    if (lobby === next && !breathLink.active) {
      entryFeedback.textContent = "No breath screen found. Try again.";
      stopRequest();
    }
  }, 60_000);
  void lobby.start().catch(() => {
    if (lobby !== next) return;
    entryFeedback.textContent = "Could not reach the breath screen. Try again.";
    stopRequest();
  });
}

function stopRequest() {
  clearInterval(resendTimer); resendTimer = undefined;
  clearTimeout(lobbyTimer); lobbyTimer = undefined;
  requestMode = false;
  hostChoices.replaceChildren();
}

nameForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = nameInput.value.trim().slice(0, 32);
  if (!name) {
    nameInput.reportValidity();
    return;
  }

  const hash = location.hash;
  const invitation = readBreathInvitation(hash);
  if (invitation) {
    godName = invitation.maker ?? godName;
    breathLink.pilotName = name;
    entryFeedback.textContent = godName ? `Approaching ${godName}\u2026` : "Connecting\u2026";
    nameInput.disabled = true;
    const submitBtn = nameForm.querySelector('button[type="submit"]')!;
    submitBtn.disabled = true;

    const sensingStarted = await startSensing();
    if (!sensingStarted) {
      nameInput.disabled = false;
      submitBtn.disabled = false;
      return;
    }

    connect(invitation);
    return;
  }

  breathLink.pilotName = name;
  const hint = hostNameInput.value.trim().slice(0, 32);
  nameInput.disabled = true;
  hostNameInput.disabled = true;
  const submitBtn = nameForm.querySelector('button[type="submit"]')!;
  submitBtn.disabled = true;

  const sensingStarted = await startSensing();
  if (!sensingStarted) {
    nameInput.disabled = false;
    hostNameInput.disabled = false;
    submitBtn.disabled = false;
    return;
  }

  startRequest(name, hint);
});

disconnectBtn.addEventListener("click", () => disconnect());

breathLink.addEventListener("status", (event: Event) => {
  const detail = (event as CustomEvent).detail;
  if (!detail.active && detail.reconnectable) {
    setConnecting("Reconnecting\u2026");
  } else if (!detail.active && !detail.reconnectable) {
    disconnect();
  }
});

breathLink.addEventListener("ready", () => {
  if (currentInvitation) {
    setConnecting("Connected!");
  }
});

breathLink.addEventListener("state", (event: Event) => {
  const state = (event as CustomEvent).detail;
  if (breathLink.ready) {
    showControls(breathLink.confirmedPilotName || godName || "Host");
    updateVisuals(state);
  }
});

const initialInvitation = readBreathInvitation(location.hash);
godName = initialInvitation?.maker ?? "";

if (otherSideMode && initialInvitation) {
  nameInput.value = "Breather";
  nameInput.required = false;
  document.querySelector<HTMLElement>('label[for="controller-name"]')?.setAttribute("hidden", "");
  nameInput.parentElement?.setAttribute("hidden", "");
  document.querySelector<HTMLElement>('label[for="host-name-field"]')?.setAttribute("hidden", "");
  hostNameInput.hidden = true;

  const submitBtn = nameForm.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submitBtn) {
    submitBtn.textContent = "ALLOW MOTION & CONNECT";
    submitBtn.classList.add("other-side-connect");
  }

  const eyebrow = document.querySelector<HTMLElement>(".entry-eyebrow");
  const title = document.querySelector<HTMLElement>(".entry-card h2");
  const headerTitle = document.querySelector<HTMLElement>(".header-center h1");
  const instruction = document.querySelector<HTMLElement>(".instruction-card p");
  if (eyebrow) eyebrow.textContent = "OTHER SIDE // BODY SENSOR";
  if (title) title.textContent = "put this phone on your belly";
  if (headerTitle) headerTitle.textContent = "Other Side Sensor";
  if (instruction) {
    instruction.textContent =
      "Keep the phone flat against your belly, screen facing up. Breathe whenever you need. The desktop tunnel reacts automatically.";
  }
  entryFeedback.textContent =
    "One tap grants motion access and connects this phone to the tunnel. No account, name, or public-room search.";
} else if (initialInvitation) {
  entryFeedback.textContent = godName
    ? `You are the person. You approach ${godName}. Enter your name to draw close.`
    : "Enter your name, then Connect to pair with the breath screen.";
  nameInput.focus();
} else {
  entryFeedback.textContent = "Enter your name and the breath screen name to connect. Or scan a QR code from the screen.";
}

animate();

window.addEventListener("pagehide", () => {
  cancelAnimationFrame(animationFrame);
  breathLink.stop({ emitStatus: false });
  stopLobby();
  stopSensing();
});