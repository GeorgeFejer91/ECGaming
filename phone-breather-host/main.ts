import QRCode from "qrcode";
import { BreathLink, type BreathState } from "../src/phone-breather/link";
import { createBreathInvitation, breathControllerUrl, type BreathInvitation } from "../src/phone-breather/invitation";
import { BreathLobby, type BreathMessage } from "../src/phone-breather/breath-lobby";
import { cleanHostName } from "../src/phone-breather/breath-lobby";
import "./styles.css";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id)! as T;

const pairBtn = byId<HTMLButtonElement>("pair-btn");
const fullscreenBtn = byId<HTMLButtonElement>("fullscreen-btn");
const pairDialog = byId<HTMLDialogElement>("pair-dialog");
const pairClose = byId<HTMLButtonElement>("pair-close");
const pairStop = byId<HTMLButtonElement>("pair-stop");
const qrCanvas = byId<HTMLCanvasElement>("qr-canvas");
const pairLink = byId<HTMLAnchorElement>("pair-link");
const pairStatus = byId("pair-status");

const statusDot = byId("status-dot");
const statusText = byId("status-text");
const statusHint = byId("status-hint");

const breathCircle = byId<SVGCircleElement>("breath-circle");
const breathRingOuter = byId<SVGCircleElement>("breath-ring-outer");
const breathRingInner = byId<SVGCircleElement>("breath-ring-inner");
const breathCenter = byId<SVGCircleElement>("breath-center");
const phaseLabel = byId("phase-label");
const bpmLabel = byId("bpm-label");
const connectionBadge = byId("connection-badge");
const badgeText = byId("badge-text");
const badgeDot = connectionBadge.querySelector(".badge-dot")!;

const MIN_RADIUS = 40;
const MAX_RADIUS = 180;
let currentRadius = 120;
let targetRadius = 120;
let animationFrame = 0;

const breathLink = new BreathLink("target");
breathLink.pilotName = "Phone";
breathLink.acceptSource = offer => {
  breathLink.sourceOffer = offer;
};
let currentInvitation: BreathInvitation | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

let lobbyStarted = false;
let lobbyStarting = false;
let lobbyMonitor: ReturnType<typeof setInterval> | undefined;
let currentLobby: BreathLobby | null = null;
const pendingRequests = new Map<string, { id: string; row: HTMLElement }>();
const acceptedPeers = new Set<string>();

const nameDialog = document.createElement("dialog");
const nameInput = document.createElement("input");
const nameStatus = document.createElement("p");
let hostName = "";
let hostNameConfirmed = false;
let gateResolving = false;

const requestDialog = document.createElement("dialog");
requestDialog.setAttribute("aria-label", "Breath requests");
let busy = false;

const tunnelCanvas = byId<HTMLCanvasElement>("tunnel-canvas");
const tunnelCtx = tunnelCanvas.getContext("2d")!;
let tunnelDPR = 1;
let tunnelW = 0;
let tunnelH = 0;
let tunnelVisible = false;
let tunnelLightPos = 0.96;
let tunnelHeldMs = 0;
let tunnelLastHeldAt = -Infinity;
let tunnelHolding = false;
let tunnelProgress = 0;
let tunnelLastBreathTime = 0;
const TUNNEL_TOTAL_MS = 180_000;
const TUNNEL_DECAY_SCALE = 6;
const TUNNEL_GRACE_MS = 1200;
const TUNNEL_RING_COUNT = 16;
const TUNNEL_RING_POINTS = 26;
const tunnelRings = Array.from({ length: TUNNEL_RING_COUNT }, (_, i) => ({
  z: (i + 1) / TUNNEL_RING_COUNT,
  seed: Math.random(),
  speed: 0.6 + 0.8 * Math.random(),
}));
let lastPhase = 0;
let lastConfidence = 0;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function radiusForVolume(v: number) {
  return lerp(MIN_RADIUS, MAX_RADIUS, Math.max(0, Math.min(1, v)));
}

function tunnelSmoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

function tunnelHash2(a: number, b: number) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function tunnelRingR(z: number) {
  return lerp(1, 0.13, Math.pow(z, 0.62)) * Math.hypot(tunnelW, tunnelH) * 0.5;
}

function tunnelRgba(r: number, g: number, b: number, a: number) {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
}

function resizeTunnel() {
  tunnelDPR = Math.min(2, window.devicePixelRatio || 1);
  tunnelW = tunnelCanvas.clientWidth;
  tunnelH = tunnelCanvas.clientHeight;
  tunnelCanvas.width = Math.max(1, Math.floor(tunnelW * tunnelDPR));
  tunnelCanvas.height = Math.max(1, Math.floor(tunnelH * tunnelDPR));
}

function showTunnel() {
  if (tunnelVisible) return;
  tunnelVisible = true;
  tunnelCanvas.hidden = false;
  const svg = document.querySelector(".breath-svg") as HTMLElement | null;
  if (svg) svg.style.display = "none";
  resizeTunnel();
}

function hideTunnel() {
  if (!tunnelVisible) return;
  tunnelVisible = false;
  tunnelCanvas.hidden = true;
  const svg = document.querySelector(".breath-svg") as HTMLElement | null;
  if (svg) svg.style.display = "";
  tunnelLightPos = 0.96;
  tunnelHeldMs = 0;
  tunnelProgress = 0;
}

function updateTunnelFromBreath(phase: number, confidence: number, dt: number) {
  const isHolding = phase === 0 && confidence > 0.3;
  const now = performance.now();
  if (isHolding) {
    if (!tunnelHolding) { tunnelLastHeldAt = now; tunnelHolding = true; }
    tunnelHeldMs = Math.min(TUNNEL_TOTAL_MS, tunnelHeldMs + dt * 1000);
  } else {
    if (tunnelHolding) tunnelHolding = false;
    if (now - tunnelLastHeldAt > TUNNEL_GRACE_MS) {
      tunnelHeldMs = Math.max(0, tunnelHeldMs - (dt * 1000) / TUNNEL_DECAY_SCALE);
    }
  }
  tunnelProgress = tunnelHeldMs / TUNNEL_TOTAL_MS;
}

function renderTunnel(now: number, dt: number) {
  updateTunnelFromBreath(lastPhase, lastConfidence, dt);
  tunnelCanvas.dataset.progress = tunnelProgress.toFixed(3);
  tunnelCtx.setTransform(tunnelDPR, 0, 0, tunnelDPR, 0, 0);
  tunnelCtx.clearRect(0, 0, tunnelW, tunnelH);
  if (tunnelW === 0 || tunnelH === 0) return;

  const goal = lerp(0.96, 0.06, tunnelProgress);
  tunnelLightPos += (goal - tunnelLightPos) * Math.min(1, 1 - Math.pow(0.03, dt));
  const vx = tunnelW * 0.5;
  const vy = tunnelH * 0.44;
  const maxR = Math.hypot(tunnelW, tunnelH) * 0.5;
  const arrival = Math.max(0, Math.min(1, 1 - tunnelLightPos));

  tunnelCtx.fillStyle = "#030305";
  tunnelCtx.fillRect(0, 0, tunnelW, tunnelH);

  const fogR = tunnelRingR(tunnelLightPos) * 7;
  const fog = tunnelCtx.createRadialGradient(vx, vy, 0, vx, vy, fogR);
  const fogAlpha = 0.05 + 0.3 * tunnelSmoothstep(arrival);
  fog.addColorStop(0, tunnelRgba(243, 231, 168, fogAlpha));
  fog.addColorStop(0.5, tunnelRgba(141, 135, 94, fogAlpha * 0.35));
  fog.addColorStop(1, tunnelRgba(3, 3, 5, 0));
  tunnelCtx.fillStyle = fog;
  tunnelCtx.fillRect(0, 0, tunnelW, tunnelH);

  const zoomK = (0.12 + 1.7 * tunnelSmoothstep(arrival) + (tunnelHolding ? 1.5 : 0)) * 0.09;
  for (const ring of tunnelRings) {
    ring.z -= dt * zoomK * ring.speed;
    if (ring.z <= 0) { ring.z = 1.015; ring.seed = Math.random(); ring.speed = 0.6 + 0.8 * Math.random(); }
    const z = ring.z;
    const r = tunnelRingR(z);
    const glow = Math.exp(-Math.abs(z - tunnelLightPos) * 3.4);
    const wallFade = Math.max(0, Math.min(1, 1 - z * 0.7));
    const depth = 0.35 + 0.65 * z;
    const para = 1 + (tunnelHolding ? 1.5 : 0.4) * tunnelSmoothstep(arrival);
    const cx = lerp(vx, vx, depth) + Math.sin(now * 0.0013 + z * 9) * 0.006 * depth * para * tunnelW;
    const cy = lerp(vy, vy, depth) + Math.cos(now * 0.0011 + z * 7) * 0.009 * depth * para * tunnelH;
    const points: [number, number][] = [];
    for (let k = 0; k < TUNNEL_RING_POINTS; k++) {
      const baseAngle = (k / TUNNEL_RING_POINTS) * Math.PI * 2;
      const wobble = (tunnelHash2(Math.round(ring.seed * 9973), k) * 2 - 1) * 0.05 * (1 - z * 0.55)
        + Math.sin(now * 0.00022 + k * 0.83 + z * 24) * 0.014 * (1 - z * 0.4);
      const rr = r * (1 + wobble);
      points.push([cx + Math.cos(baseAngle) * rr, cy + Math.sin(baseAngle) * rr * 0.82]);
    }
    tunnelCtx.beginPath();
    tunnelCtx.moveTo(points[0]![0]!, points[0]![1]!);
    for (let k = 1; k < points.length; k++) tunnelCtx.lineTo(points[k]![0]!, points[k]![1]!);
    tunnelCtx.closePath();
    tunnelCtx.strokeStyle = tunnelRgba(200, 191, 141, 0.34 * glow + 0.035 * wallFade);
    tunnelCtx.lineWidth = Math.max(0.5, Math.min(3, r * 0.006));
    tunnelCtx.stroke();
    tunnelCtx.beginPath();
    tunnelCtx.moveTo(points[0]![0]! + 1, points[0]![1]! + 1);
    for (let k = 1; k < points.length; k++) tunnelCtx.lineTo(points[k]![0]! + 1, points[k]![1]! + 1);
    tunnelCtx.closePath();
    tunnelCtx.strokeStyle = tunnelRgba(120, 118, 140, 0.14 * wallFade);
    tunnelCtx.lineWidth = Math.max(1, Math.min(5, r * 0.012));
    tunnelCtx.stroke();
  }

  const breathSwell = Math.sin(now * (tunnelHolding ? 0.0007 : 0.0014)) * (tunnelHolding ? 0.015 : 0.04);
  const coreR = tunnelRingR(tunnelLightPos) * (0.5 + 0.62 * tunnelSmoothstep(arrival)) * (1 + breathSwell);
  const haloR = coreR * (2.4 + 0.5 * Math.sin(now * 0.0004));
  const lightA = 0.3 + 0.7 * tunnelSmoothstep(Math.max(0, Math.min(1, arrival * 2.4)));

  const halo = tunnelCtx.createRadialGradient(vx, vy, 0, vx, vy, haloR);
  halo.addColorStop(0, tunnelRgba(243, 231, 168, lightA * 0.8));
  halo.addColorStop(0.35, tunnelRgba(243, 231, 168, lightA * 0.4));
  halo.addColorStop(0.7, tunnelRgba(141, 135, 94, lightA * 0.18));
  halo.addColorStop(1, tunnelRgba(8, 8, 12, 0));
  tunnelCtx.fillStyle = halo;
  tunnelCtx.fillRect(vx - haloR, vy - haloR, haloR * 2, haloR * 2);

  const mid = tunnelCtx.createRadialGradient(vx, vy, 0, vx, vy, coreR * 2);
  mid.addColorStop(0, tunnelRgba(255, 251, 230, lightA));
  mid.addColorStop(0.45, tunnelRgba(243, 231, 168, lightA * 0.75));
  mid.addColorStop(1, tunnelRgba(141, 135, 94, 0));
  tunnelCtx.fillStyle = mid;
  tunnelCtx.fillRect(vx - coreR * 2, vy - coreR * 2, coreR * 4, coreR * 4);

  const core = tunnelCtx.createRadialGradient(vx, vy, 0, vx, vy, coreR);
  core.addColorStop(0, tunnelRgba(255, 251, 230, 1));
  core.addColorStop(0.5, tunnelRgba(255, 248, 214, 0.9));
  core.addColorStop(1, tunnelRgba(243, 231, 168, 0.25));
  tunnelCtx.fillStyle = core;
  tunnelCtx.fillRect(vx - coreR, vy - coreR, coreR * 2, coreR * 2);

  tunnelCtx.save();
  tunnelCtx.setLineDash([coreR * 0.4, coreR * 0.16]);
  tunnelCtx.lineDashOffset = -now * 0.00032;
  tunnelCtx.strokeStyle = tunnelRgba(255, 251, 230, 0.22 + arrival * 0.45);
  tunnelCtx.lineWidth = Math.max(1, Math.min(3, coreR * 0.02));
  tunnelCtx.beginPath();
  tunnelCtx.arc(vx, vy, coreR * 1.18, 0, Math.PI * 2);
  tunnelCtx.stroke();
  tunnelCtx.setLineDash([]);
  tunnelCtx.restore();

  if (tunnelHolding) {
    const ring = tunnelCtx.createRadialGradient(vx, vy, coreR * 1.3, vx, vy, coreR * 2.1);
    ring.addColorStop(0, tunnelRgba(255, 251, 230, 0.12));
    ring.addColorStop(1, tunnelRgba(3, 3, 5, 0));
    tunnelCtx.fillStyle = ring;
    tunnelCtx.fillRect(vx - coreR * 2.1, vy - coreR * 2.1, coreR * 4.2, coreR * 4.2);
  }

  const holdInk = tunnelHolding ? 0.18 : 0;
  const vignette = tunnelCtx.createRadialGradient(vx, vy, maxR * 0.25, vx, vy, maxR);
  vignette.addColorStop(0, tunnelRgba(0, 0, 0, 0));
  vignette.addColorStop(1, tunnelRgba(0, 0, 0, 0.72 + holdInk - arrival * 0.3));
  tunnelCtx.fillStyle = vignette;
  tunnelCtx.fillRect(0, 0, tunnelW, tunnelH);

  if (tunnelProgress > 0) {
    tunnelCtx.save();
    tunnelCtx.font = "bold 14px system-ui";
    tunnelCtx.fillStyle = tunnelRgba(243, 231, 168, 0.6);
    tunnelCtx.textAlign = "center";
    tunnelCtx.fillText(`${Math.round(tunnelProgress * 100)}%`, vx, tunnelH - 20);
    tunnelCtx.restore();
  }
}

let lastAnimateTime = performance.now();

function animate() {
  const now = performance.now();
  const dt = Math.min(0.05, Math.max(0.001, (now - lastAnimateTime) / 1000));
  lastAnimateTime = now;

  currentRadius += (targetRadius - currentRadius) * 0.15;
  const r = radiusForVolume(currentRadius / MAX_RADIUS);
  breathCircle.setAttribute("r", r.toFixed(1));
  breathRingOuter.setAttribute("r", (r + 40).toFixed(1));
  breathRingInner.setAttribute("r", (r * 0.6).toFixed(1));

  if (tunnelVisible) renderTunnel(now, dt);
  animationFrame = requestAnimationFrame(animate);
}

function updateVisuals(state: BreathState) {
  targetRadius = radiusForVolume(state.volume01);
  lastPhase = state.phase;
  lastConfidence = state.confidence01;
  showTunnel();

  const phaseText = state.phase === 1 ? "Inhale" : state.phase === -1 ? "Exhale" : "Hold";
  phaseLabel.textContent = phaseText;
  phaseLabel.dataset.phase = state.phase === 1 ? "inhale" : state.phase === -1 ? "exhale" : "hold";

  if (state.flow01 > 0.1) {
    const cycleEstimate = 60 / (state.flow01 * 10 + 2);
    bpmLabel.textContent = `${Math.round(cycleEstimate)} BPM`;
  }

  statusDot.className = "status-dot connected";
  statusText.textContent = `Connected \u00B7 ${state.pilotName || "Phone"} \u00B7 ${hostName || "God"}`;
  statusHint.textContent = hostName
    ? `${hostName} receives ${state.pilotName || "the person"}'s breathing.`
    : "Breathing data streaming from phone";

  connectionBadge.hidden = false;
  badgeText.textContent = `${state.pilotName || "Phone"} \u00B7 ${hostName || "God"} \u00B7 Connected`;
  badgeDot.classList.add("connected");
}

function resetVisuals() {
  targetRadius = radiusForVolume(0.5);
  hideTunnel();
  phaseLabel.textContent = "\u2014";
  phaseLabel.dataset.phase = "hold";
  bpmLabel.textContent = "\u2014 BPM";
  statusDot.className = "status-dot";
  statusText.textContent = hostNameConfirmed ? `${hostName} is broadcasting` : "Not connected";
  statusHint.textContent = hostNameConfirmed ? "Waiting for a phone to draw close." : "Who is your maker? Name them to begin.";
  connectionBadge.hidden = true;
  badgeDot.classList.remove("connected");
}

function showPairing(invitation: BreathInvitation) {
  currentInvitation = invitation;
  const url = breathControllerUrl(location.href, invitation);
  pairLink.href = url;

  pairStatus.textContent = "Generating QR code\u2026";
  pairDialog.showModal();

  QRCode.toCanvas(qrCanvas, url, { width: 280, margin: 4, errorCorrectionLevel: "M" })
    .then(() => {
      pairStatus.textContent = "Waiting for phone to connect\u2026";
    })
    .catch(() => {
      pairStatus.textContent = "QR code failed. Use the link below.";
    });
}

function hidePairing() {
  pairDialog.close();
  qrCanvas.getContext("2d")?.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
  pairLink.removeAttribute("href");
  currentInvitation = null;
}

function ensureInvitation() {
  if (!currentInvitation) {
    const invitation = createBreathInvitation(hostName);
    currentInvitation = invitation;
  }
  const url = breathControllerUrl(location.href, currentInvitation);
  pairLink.href = url;
  return currentInvitation;
}

function showQR() {
  const url = breathControllerUrl(location.href, currentInvitation!);
  pairStatus.textContent = "Scan this QR code with your phone.";
  pairDialog.showModal();
  QRCode.toCanvas(qrCanvas, url, { width: 280, margin: 4, errorCorrectionLevel: "M" }).catch(() => {
    pairStatus.textContent = "QR code failed. Use the link below.";
  });
}

function stopPairing() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  breathLink.stop();
  hidePairing();
  resetVisuals();
}

function scheduleReconnect() {
  if (!currentInvitation) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (breathLink.active && !breathLink.ready) {
      breathLink.start(currentInvitation!);
    }
  }, 3000);
}

function storedHostName() {
  try { return cleanHostName(localStorage.getItem("ecgaming-breath-host-name-v1") ?? ""); }
  catch { return ""; }
}

function buildNameDialog() {
  nameDialog.className = "name-dialog";
  nameDialog.setAttribute("aria-label", "Who is your maker");
  const form = document.createElement("form"); form.method = "dialog";
  const title = document.createElement("h2"); title.textContent = "Who is your maker?";
  const copy = document.createElement("p"); copy.textContent = "This screen is the god a phone will approach. Name the maker whose breath the person keeps.";
  const label = document.createElement("label");
  const labelText = document.createElement("span"); labelText.textContent = "Your maker's name";
  nameInput.type = "text"; nameInput.maxLength = 40; nameInput.required = true;
  nameInput.autocomplete = "off"; nameInput.placeholder = "Yahweh"; nameInput.value = hostName;
  const save = document.createElement("button"); save.type = "submit"; save.className = "button primary"; save.textContent = "ANSWER";
  nameStatus.setAttribute("role", "status");
  label.append(labelText, nameInput);
  form.append(title, copy, label, save, nameStatus);
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (gateResolving) return;
    const next = cleanHostName(nameInput.value);
    if (!next) { nameInput.value = ""; nameInput.reportValidity(); return; }
    hostName = next; nameInput.value = next; gateResolving = true;
    nameInput.disabled = save.disabled = true;
    nameStatus.textContent = "It's Yahweh or No Way!";
    nameStatus.classList.add("maker-verdict");
    try { localStorage.setItem("ecgaming-breath-host-name-v1", next); } catch { /* Persistence is helpful, not required. */ }
    window.setTimeout(() => {
      hostNameConfirmed = true; gateResolving = false;
      nameInput.disabled = save.disabled = false;
      if (nameDialog.open) nameDialog.close();
      currentLobby?.setHostName(next);
      ensureLobby();
      resetVisuals();
      if (hostName) nameStatus.classList.remove("maker-verdict");
    }, 2600);
  });
  nameDialog.append(form);
  document.body.append(nameDialog);
}

function showNameDialog() {
  if (hostNameConfirmed || nameDialog.open) return;
  try { nameDialog.showModal(); } catch { nameDialog.open = true; }
  nameInput.focus();
}

function buildRequestDialog() {
  const title = document.createElement("h2"); title.textContent = "Phone requests";
  requestDialog.append(title);
  document.body.append(requestDialog);
  requestDialog.addEventListener("cancel", event => {
    event.preventDefault();
    if (!busy) for (const [peer, request] of pendingRequests) decline(peer, request.id);
  });
}

function removeRequest(peer: string) {
  pendingRequests.get(peer)?.row.remove(); pendingRequests.delete(peer);
  if (!pendingRequests.size && requestDialog.open) requestDialog.close();
}

function decline(peer: string, id: string) {
  currentLobby?.send(peer, { kind: "declined", id }); removeRequest(peer);
  setTimeout(() => currentLobby?.closePeer(peer), 1000);
}

async function accept(peer: string, id: string) {
  if (busy || pendingRequests.get(peer)?.id !== id || !currentLobby) return;
  busy = true;
  try {
    ensureInvitation();
    await breathLink.stop();
    breathLink.pilotName = "Phone";
    await breathLink.start(currentInvitation!);
    if (!currentLobby.send(peer, { kind: "accepted", id, invitation: currentInvitation! })) {
      return;
    }
    acceptedPeers.add(peer);
    removeRequest(peer);
    showQR();
  } finally { busy = false; }
}

function ensureLobby() {
  if (!hostNameConfirmed) return;
  if (lobbyStarted || lobbyStarting) return;
  lobbyStarting = true;
  const lobby = currentLobby ?? new BreathLobby("host");
  currentLobby = lobby;
  lobby.setHostName(hostName);
  lobby.addEventListener("message", ((event: CustomEvent<{ peer: string; message: BreathMessage }>) => {
    if (currentLobby !== lobby) return;
    handleLobbyMessage(event.detail.peer, event.detail.message);
  }) as EventListener);
  lobby.addEventListener("closed", ((event: CustomEvent<string>) => {
    if (currentLobby !== lobby) return;
    acceptedPeers.delete(event.detail);
    removeRequest(event.detail);
  }) as EventListener);
  void lobby.start().then(() => {
    lobbyStarted = true;
    if (lobbyMonitor) clearInterval(lobbyMonitor);
    lobbyMonitor = setInterval(() => ensureLobby(), 2500);
    statusHint.textContent = "Waiting for a phone to connect.";
  }).catch(() => {
    lobbyStarted = false;
  }).finally(() => {
    lobbyStarting = false;
  });
}

function handleLobbyMessage(peer: string, message: BreathMessage) {
  if (message.kind === "cancel") { if (pendingRequests.get(peer)?.id === message.id) currentLobby?.closePeer(peer); return; }
  if (message.kind !== "request") { currentLobby?.closePeer(peer); return; }
  if (pendingRequests.has(peer)) {
    if (pendingRequests.get(peer)!.id !== message.id) currentLobby?.closePeer(peer);
    else currentLobby?.send(peer, { kind: "received", id: message.id });
    return;
  }
  if (acceptedPeers.has(peer)) { currentLobby?.closePeer(peer); return; }
  if (pendingRequests.size >= 8) { currentLobby?.closePeer(peer); return; }
  const row = document.createElement("section"), text = document.createElement("p");
  text.textContent = `${message.name} asks to draw close to ${hostName}.`;
  const acceptBtn = document.createElement("button"), declineBtn = document.createElement("button");
  acceptBtn.type = declineBtn.type = "button";
  acceptBtn.textContent = "Let them connect"; declineBtn.textContent = "Decline";
  const controls = document.createElement("div"); controls.append(acceptBtn, declineBtn);
  row.prepend(text); row.append(controls);
  pendingRequests.set(peer, { id: message.id, row }); requestDialog.append(row);
  currentLobby?.send(peer, { kind: "received", id: message.id });
  acceptBtn.addEventListener("click", () => void accept(peer, message.id));
  declineBtn.addEventListener("click", () => { if (!busy) decline(peer, message.id); });
  if (!requestDialog.open) requestDialog.showModal();
}

function startLobbyMonitor() {
  if (!hostNameConfirmed) return;
  ensureLobby();
}

breathLink.addEventListener("status", (event: Event) => {
  const detail = (event as CustomEvent).detail;
  if (!detail.active && detail.reconnectable) {
    scheduleReconnect();
  }
  if (!detail.active && !detail.reconnectable) {
    hidePairing();
    resetVisuals();
  }
});

breathLink.addEventListener("ready", () => {
  hidePairing();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
});

breathLink.addEventListener("state", (event: Event) => {
  const state = (event as CustomEvent<BreathState>).detail;
  if (breathLink.ready) {
    updateVisuals(state);
  }
});

pairBtn.addEventListener("click", () => {
  if (!hostNameConfirmed) { showNameDialog(); return; }
  ensureInvitation(); showQR(); startLobbyMonitor();
  if (!breathLink.active) { breathLink.pilotName = "Phone"; void breathLink.start(currentInvitation!); }
});
pairClose.addEventListener("click", () => stopPairing());
pairStop.addEventListener("click", () => stopPairing());

fullscreenBtn.addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      fullscreenBtn.textContent = "EXIT FULLSCREEN";
    } else {
      await document.exitFullscreen();
      fullscreenBtn.textContent = "FULLSCREEN";
    }
  } catch {}
});

document.addEventListener("fullscreenchange", () => {
  fullscreenBtn.textContent = document.fullscreenElement ? "EXIT FULLSCREEN" : "FULLSCREEN";
});

pairDialog.addEventListener("close", () => {
  if (breathLink.active && !breathLink.ready) {
    stopPairing();
  }
});

buildNameDialog();
buildRequestDialog();
hostName = storedHostName();
nameInput.value = hostName;
showNameDialog();
animate();
resetVisuals();

window.addEventListener("pagehide", () => {
  cancelAnimationFrame(animationFrame);
  breathLink.stop({ emitStatus: false });
  currentLobby?.stop();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (lobbyMonitor) clearInterval(lobbyMonitor);
});

window.addEventListener("resize", resizeTunnel);
