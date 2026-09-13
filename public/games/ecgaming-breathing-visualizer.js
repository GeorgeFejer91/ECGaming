/*
 * Compact game overlay for ECGaming's Polar Stream-compatible ACC breathing
 * waveform. The signal is a calibrated 0-1 chest-motion / respiratory-effort
 * surrogate, not lung volume or airflow.
 */

export const ECGAMING_BREATHING_CHANNEL = "ecgaming-breathing-v1";
export const ECGAMING_BREATHING_EVENT = "ecgaming:breathing-signal";

const MAX_TRANSPORT_AGE_MS = 750;
const MAX_SIGNAL_AGE_MS = 750;
const STALE_AFTER_MS = 900;
const DISPLAY_WINDOW_MS = 5_000;
const MAX_POINTS = 160;

const finite = (value) => Number.isFinite(Number(value));
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value)));

export function parseBreathingSignal(value, nowEpochMs = Date.now()) {
  if (!value || typeof value !== "object") return undefined;
  const sentAtEpochMs = Number(value.sentAtEpochMs);
  const transportAgeMs = nowEpochMs - sentAtEpochMs;
  const signalAgeMs = Number(value.signalAgeMs);
  const volume01 = Number(value.volume01);
  if (
    !finite(sentAtEpochMs) ||
    transportAgeMs < 0 ||
    transportAgeMs > MAX_TRANSPORT_AGE_MS ||
    !finite(signalAgeMs) ||
    signalAgeMs < 0 ||
    !finite(volume01) ||
    volume01 < 0 ||
    volume01 > 1
  )
    return undefined;

  const isDiveEnvelope =
    value.kind === "ecgaming-dive-intent" && value.version === 1;
  const isLocalEnvelope = value.kind === "ecgaming-breathing-signal";
  if (!isDiveEnvelope && !isLocalEnvelope) return undefined;

  const simulated = value.simulated === true;
  const physicalPolar = value.physicalPolar === true;
  const ready =
    simulated ||
    (signalAgeMs <= MAX_SIGNAL_AGE_MS &&
      (isLocalEnvelope
        ? value.ready === true
        : physicalPolar && value.state !== "unavailable"));

  return {
    volume01: clamp01(volume01),
    ready,
    physicalPolar,
    simulated,
    route: String(value.route ?? "game"),
  };
}

export function createBreathingSignalEvent(detail) {
  return new CustomEvent(ECGAMING_BREATHING_EVENT, {
    detail: {
      kind: "ecgaming-breathing-signal",
      sentAtEpochMs: Date.now(),
      signalAgeMs: 0,
      physicalPolar: false,
      simulated: false,
      ready: false,
      ...detail,
    },
  });
}

class BreathingVisualizer {
  constructor(host) {
    this.host = host;
    this.points = [];
    this.lastReadyAt = -Infinity;
    this.state = "waiting";
    this.resizeObserver = undefined;
    this.channel = undefined;

    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host {
          --breath-accent: #69d4de;
          --breath-accent-soft: rgba(105, 212, 222, .2);
          position: fixed;
          z-index: 9990;
          right: max(12px, env(safe-area-inset-right));
          bottom: max(54px, calc(12px + env(safe-area-inset-bottom)));
          display: block;
          width: min(286px, calc(100vw - 24px));
          color: #d9ecf0;
          pointer-events: none;
          contain: content;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        }
        :host([hidden]) { display: none; }
        :host([data-state="live"]) { --breath-accent: #69d4de; --breath-accent-soft: rgba(105, 212, 222, .2); }
        :host([data-state="simulated"]) { --breath-accent: #f4b33a; --breath-accent-soft: rgba(244, 179, 58, .18); }
        :host([data-state="stale"]) { --breath-accent: #81939b; --breath-accent-soft: rgba(129, 147, 155, .14); }
        .panel {
          display: grid;
          grid-template-rows: auto 74px auto;
          overflow: hidden;
          border: 1px solid color-mix(in srgb, var(--breath-accent) 52%, #253d49);
          border-radius: 3px;
          background: rgba(5, 16, 24, .88);
          box-shadow: 0 14px 34px rgba(0, 0, 0, .28), inset 0 0 24px var(--breath-accent-soft);
          backdrop-filter: blur(9px);
        }
        header, footer {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          padding: 7px 9px;
        }
        header { border-bottom: 1px solid rgba(163, 198, 207, .15); }
        header span {
          display: inline-flex;
          min-width: 0;
          align-items: center;
          gap: 7px;
          color: #9eb6bd;
          font-size: 9px;
          font-weight: 800;
          letter-spacing: .1em;
          white-space: nowrap;
        }
        header i {
          width: 7px;
          height: 7px;
          flex: 0 0 auto;
          border-radius: 50%;
          background: var(--breath-accent);
          box-shadow: 0 0 10px var(--breath-accent);
        }
        header strong {
          margin-left: auto;
          color: #fff8df;
          font-size: 17px;
          line-height: 1;
          letter-spacing: -.04em;
        }
        .plot {
          position: relative;
          min-height: 0;
          overflow: hidden;
          background-image:
            linear-gradient(to right, rgba(105, 212, 222, .07) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(105, 212, 222, .07) 1px, transparent 1px);
          background-size: 20% 50%;
        }
        canvas { display: block; width: 100%; height: 100%; }
        footer {
          min-height: 27px;
          border-top: 1px solid rgba(163, 198, 207, .15);
          color: #79919a;
          font-size: 8px;
          font-weight: 800;
          letter-spacing: .09em;
        }
        footer span:first-child {
          overflow: hidden;
          color: var(--breath-accent);
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        footer span:last-child { margin-left: auto; white-space: nowrap; }
        :host([data-state="waiting"]) header i,
        :host([data-state="stale"]) header i { box-shadow: none; }
        @media (max-width: 520px) {
          :host {
            right: max(8px, env(safe-area-inset-right));
            bottom: max(92px, calc(78px + env(safe-area-inset-bottom)));
            width: min(218px, calc(100vw - 16px));
          }
          .panel { grid-template-rows: auto 58px auto; }
          header, footer { padding: 6px 7px; }
          header span { font-size: 8px; }
          header strong { font-size: 14px; }
        }
        @media (prefers-reduced-transparency: reduce) {
          .panel { background: #07131f; backdrop-filter: none; }
        }
      </style>
      <section class="panel" aria-label="Polar accelerometer breathing waveform">
        <header><span><i aria-hidden="true"></i><b>POLAR ACC BREATH</b></span><strong>--</strong></header>
        <div class="plot"><canvas aria-label="Breathing waveform from zero to one"></canvas></div>
        <footer><span>WAITING FOR CALIBRATED ACC</span><span>RELATIVE 0–1</span></footer>
      </section>`;

    this.canvas = shadow.querySelector("canvas");
    this.context = this.canvas.getContext("2d");
    this.value = shadow.querySelector("header strong");
    this.label = shadow.querySelector("header b");
    this.status = shadow.querySelector("footer span");

    host.dataset.state = "waiting";
    host.dataset.value = "";
    host.dataset.direction = "pause";
    host.dataset.points = "0";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    host.setAttribute(
      "aria-label",
      "Polar accelerometer breathing waveform waiting for calibration",
    );

    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(this.canvas);
    this.staleTimer = window.setInterval(() => this.checkStale(), 200);
    this.listen();
    this.draw();
  }

  listen() {
    window.addEventListener(ECGAMING_BREATHING_EVENT, (event) => {
      this.receive(event.detail);
    });
    if (typeof BroadcastChannel === "undefined") return;
    try {
      this.channel = new BroadcastChannel(ECGAMING_BREATHING_CHANNEL);
      this.channel.addEventListener("message", ({ data }) => this.receive(data));
    } catch {
      // The game remains playable without the optional same-origin signal bus.
    }
  }

  receive(envelope) {
    const signal = parseBreathingSignal(envelope);
    if (!signal) return;
    const now = performance.now();
    if (!signal.ready) {
      if (now - this.lastReadyAt > STALE_AFTER_MS) this.setWaiting();
      return;
    }

    const previous = this.points.at(-1);
    if (previous && now - previous.at < 30 && Math.abs(previous.value - signal.volume01) < 0.0005)
      previous.at = now;
    else this.points.push({ at: now, value: signal.volume01 });
    if (this.points.length > MAX_POINTS)
      this.points.splice(0, this.points.length - MAX_POINTS);
    this.points = this.points.filter((point) => now - point.at <= DISPLAY_WINDOW_MS);
    this.lastReadyAt = now;
    this.state = signal.simulated ? "simulated" : "live";
    this.host.dataset.state = this.state;
    this.host.dataset.value = signal.volume01.toFixed(3);
    this.host.dataset.points = String(this.points.length);
    this.value.textContent = signal.volume01.toFixed(2);
    this.label.textContent = signal.simulated ? "SIMULATED BREATH" : "POLAR ACC BREATH";
    this.status.textContent = signal.simulated ? "SIMULATED · NOT POLAR" : "LIVE CHEST-MOTION WAVEFORM";
    this.host.setAttribute(
      "aria-label",
      `${signal.simulated ? "Simulated" : "Polar accelerometer"} breathing waveform ${signal.volume01.toFixed(2)} on a zero to one scale`,
    );
    this.draw();
  }

  setWaiting() {
    this.state = "waiting";
    this.host.dataset.state = "waiting";
    this.host.dataset.value = "";
    this.value.textContent = "--";
    this.label.textContent = "POLAR ACC BREATH";
    this.status.textContent = "WAITING FOR CALIBRATED ACC";
    this.host.setAttribute(
      "aria-label",
      "Polar accelerometer breathing waveform waiting for calibration",
    );
    this.draw();
  }

  checkStale() {
    if (!["live", "simulated"].includes(this.state)) return;
    if (performance.now() - this.lastReadyAt <= STALE_AFTER_MS) return;
    this.state = "stale";
    this.host.dataset.state = "stale";
    this.status.textContent = "ACC SIGNAL STALE";
    this.host.setAttribute(
      "aria-label",
      "Polar accelerometer breathing waveform signal is stale",
    );
    this.draw();
  }

  direction() {
    if (this.points.length < 2) return "pause";
    const count = Math.min(6, this.points.length);
    const latest = this.points.at(-1).value;
    const base = this.points[this.points.length - count].value;
    const trend = latest - base;
    return trend > 0.002 ? "inhale" : trend < -0.002 ? "exhale" : "pause";
  }

  draw() {
    if (!this.context) return;
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width < 2 || bounds.height < 2) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(bounds.width * ratio));
    const height = Math.max(1, Math.round(bounds.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const context = this.context;
    context.clearRect(0, 0, width, height);

    const padLeft = 27 * ratio;
    const padRight = 11 * ratio;
    const padY = 9 * ratio;
    const drawWidth = width - padLeft - padRight;
    const drawHeight = height - padY * 2;
    const direction = this.direction();
    this.host.dataset.direction = direction;

    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.font = `700 ${7 * ratio}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.textBaseline = "middle";
    context.fillStyle = "rgba(195, 220, 226, .65)";
    context.fillText("1", 8 * ratio, padY);
    context.fillText("0", 8 * ratio, height - padY);

    context.beginPath();
    context.moveTo(padLeft, padY + drawHeight / 2);
    context.lineTo(width - padRight, padY + drawHeight / 2);
    context.strokeStyle = "rgba(155, 192, 201, .22)";
    context.lineWidth = ratio;
    context.setLineDash([3 * ratio, 5 * ratio]);
    context.stroke();
    context.setLineDash([]);

    const now = performance.now();
    const visible = this.points.filter((point) => now - point.at <= DISPLAY_WINDOW_MS);
    if (visible.length) {
      const point = (sample) => ({
        x: padLeft + (1 - Math.min(1, (now - sample.at) / DISPLAY_WINDOW_MS)) * drawWidth,
        y: padY + (1 - sample.value) * drawHeight,
      });
      context.beginPath();
      visible.forEach((sample, index) => {
        const current = point(sample);
        if (index === 0) context.moveTo(current.x, current.y);
        else context.lineTo(current.x, current.y);
      });
      const color = this.state === "simulated" ? "244, 179, 58" : "105, 212, 222";
      const gradient = context.createLinearGradient(padLeft, 0, width - padRight, 0);
      gradient.addColorStop(0, `rgba(${color}, .08)`);
      gradient.addColorStop(0.35, `rgba(${color}, .42)`);
      gradient.addColorStop(1, `rgba(${color}, 1)`);
      context.strokeStyle = gradient;
      context.lineWidth = 1.6 * ratio;
      context.stroke();

      const latest = point(visible.at(-1));
      context.beginPath();
      context.arc(latest.x, latest.y, 4 * ratio, 0, Math.PI * 2);
      context.fillStyle = "#07131f";
      context.fill();
      context.strokeStyle = `rgb(${color})`;
      context.lineWidth = 1.8 * ratio;
      context.stroke();
    }

    context.textAlign = "right";
    context.font = `800 ${7 * ratio}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.fillStyle =
      direction === "inhale"
        ? "#69d4de"
        : direction === "exhale"
          ? "#f4b33a"
          : "#90a4ab";
    context.fillText(
      direction === "inhale" ? "INHALE ↑" : direction === "exhale" ? "EXHALE ↓" : "PAUSE",
      width - 8 * ratio,
      8 * ratio,
    );
    context.restore();
  }

  disconnect() {
    clearInterval(this.staleTimer);
    this.resizeObserver?.disconnect();
    this.channel?.close();
  }
}

export function installBreathingVisualizer() {
  const existing = document.getElementById("ecgaming-breathing-visualizer");
  if (existing) return existing;
  const host = document.createElement("aside");
  host.id = "ecgaming-breathing-visualizer";
  document.body.append(host);
  const visualizer = new BreathingVisualizer(host);
  host.visualizer = visualizer;

  const visibility = document.body.dataset.ecgamingBreathVisibility ?? "always";
  const syncVisibility = () => {
    host.hidden = visibility === "cockpit" && !document.body.classList.contains("cockpit-mode");
  };
  syncVisibility();
  const visibilityObserver = new MutationObserver(syncVisibility);
  visibilityObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  addEventListener(
    "beforeunload",
    () => {
      visibilityObserver.disconnect();
      visualizer.disconnect();
    },
    { once: true },
  );
  return host;
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", installBreathingVisualizer, { once: true });
  else installBreathingVisualizer();
}
