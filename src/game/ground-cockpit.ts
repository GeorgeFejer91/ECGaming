import { isFreshBeat } from "../protocol/flight-frame";
import type { FlightFrame } from "../protocol/types";
import {
  AIRCRAFT_CATALOG,
  DEFAULT_AIRCRAFT_ID,
  getAircraftPersona,
  isAircraftId,
  type AircraftId,
} from "./aircraft";
import { AircraftPreview } from "./aircraft-preview";
import type { EcgGameModule } from "./ecg-game-module";
import { createFlightScene } from "./flight-scene";
import { FlightSound } from "./sound";

const AIRCRAFT_KEY = "ecgaming-aircraft-v1";
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const setText = (id: string, value: string) => {
  element(id).textContent = value;
};

export interface CockpitTelemetry {
  frame: FlightFrame;
  sourceLabel: string;
  signalLabel: string;
  route: "local" | "direct" | "relay" | "unknown";
  latencyMs?: number;
  ready: boolean;
  holdReason?: string;
}

const COCKPIT_RECOVERY_MS = 3_000;

export interface CockpitRecoverySnapshot {
  ready: boolean;
  holding: boolean;
  countdownSeconds?: number;
}

/**
 * Keeps transient source recovery separate from effective game readiness.
 * Initial launch may begin immediately because Ground Control already gated it;
 * every later loss requires three continuous ready seconds before resuming.
 */
export class CockpitRecoveryGate {
  private holding = false;
  private readySince?: number;

  begin(ready: boolean, nowMs: number): CockpitRecoverySnapshot {
    this.holding = !ready;
    this.readySince = undefined;
    return this.update(ready, nowMs);
  }

  update(ready: boolean, nowMs: number): CockpitRecoverySnapshot {
    if (!ready) {
      this.holding = true;
      this.readySince = undefined;
      return { ready: false, holding: true };
    }
    if (!this.holding) return { ready: true, holding: false };
    if (this.readySince === undefined) this.readySince = nowMs;
    const elapsed = Math.max(0, nowMs - this.readySince);
    if (elapsed >= COCKPIT_RECOVERY_MS) {
      this.holding = false;
      this.readySince = undefined;
      return { ready: true, holding: false };
    }
    return {
      ready: false,
      holding: true,
      countdownSeconds: Math.ceil((COCKPIT_RECOVERY_MS - elapsed) / 1_000),
    };
  }
}

/**
 * Projects the reusable game module into the Ground Control document.
 * Signal selection, mapping, readiness, and transport remain owned by Ground
 * Control; this class owns only the cockpit presentation and game lifecycle.
 */
export class GroundCockpit extends EventTarget {
  private game?: EcgGameModule;
  private gameFailure?: Error;
  private readonly sound = new FlightSound();
  private readonly preview: AircraftPreview;
  private started = false;
  private visible = false;
  private muted = false;
  private lastBeatCounter?: number;
  private rewardTimer?: number;
  private aircraftRequest = 0;
  private aircraftReady: Promise<void> = Promise.resolve();
  private aircraftLoading = false;
  private aircraftAvailable = true;
  private selectedAircraftId: AircraftId;
  private readonly recovery = new CockpitRecoveryGate();
  private effectiveReady = false;
  private readonly steeringPointers = new Map<
    number,
    { axis: -1 | 1; button: HTMLButtonElement }
  >();

  constructor() {
    super();
    const persisted = localStorage.getItem(AIRCRAFT_KEY);
    this.selectedAircraftId =
      persisted && isAircraftId(persisted) ? persisted : DEFAULT_AIRCRAFT_ID;
    this.preview = new AircraftPreview(element("ground-aircraft-preview"));
    this.hydrateAircraftSelector();
    this.bindActions();
  }

  private ensureGame() {
    if (this.game) return this.game;
    if (this.gameFailure) throw this.gameFailure;
    try {
      this.game = createFlightScene(element("cockpit-game-canvas"));
    } catch (error) {
      this.gameFailure =
        error instanceof Error ? error : new Error(String(error));
      throw this.gameFailure;
    }
    this.game.addEventListener("score", this.handleScore as EventListener);
    this.aircraftReady = this.selectAircraft(this.selectedAircraftId);
    return this.game;
  }

  private showGameUnavailable(error: unknown) {
    console.error(error);
    element("cockpit-runway-panel").hidden = false;
    setText("cockpit-runway-title", "3D cockpit unavailable in this browser.");
    setText(
      "cockpit-runway-copy",
      "Ground Control is still available, but this browser could not create the WebGL flight display. Try a browser with hardware-accelerated WebGL.",
    );
    element<HTMLButtonElement>("cockpit-enter-xr").hidden = true;
    element("cockpit-game-canvas").setAttribute(
      "aria-label",
      "Cockpit unavailable because WebGL could not start",
    );
  }

  private hydrateAircraftSelector() {
    const select = element<HTMLSelectElement>("ground-aircraft");
    select.replaceChildren(
      ...AIRCRAFT_CATALOG.map(({ id, label }) => {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = label;
        return option;
      }),
    );
    this.updateAircraftPresentation(this.selectedAircraftId);
    select.addEventListener("change", () => {
      const id = isAircraftId(select.value)
        ? select.value
        : DEFAULT_AIRCRAFT_ID;
      this.aircraftReady = this.selectAircraft(id);
    });
    element<HTMLButtonElement>("ground-aircraft-prev").addEventListener(
      "click",
      () => this.stepAircraft(-1),
    );
    element<HTMLButtonElement>("ground-aircraft-next").addEventListener(
      "click",
      () => this.stepAircraft(1),
    );
    this.aircraftReady = this.selectAircraft(this.selectedAircraftId);
  }

  private stepAircraft(direction: -1 | 1) {
    const current = AIRCRAFT_CATALOG.findIndex(
      ({ id }) => id === this.selectedAircraftId,
    );
    const next =
      (Math.max(0, current) + direction + AIRCRAFT_CATALOG.length) %
      AIRCRAFT_CATALOG.length;
    this.aircraftReady = this.selectAircraft(AIRCRAFT_CATALOG[next].id);
  }

  private updateAircraftPresentation(id: AircraftId) {
    const index = AIRCRAFT_CATALOG.findIndex((aircraft) => aircraft.id === id);
    const aircraft = AIRCRAFT_CATALOG[Math.max(0, index)];
    const persona = getAircraftPersona(id);
    element<HTMLSelectElement>("ground-aircraft").value = id;
    setText("ground-aircraft-source-name", aircraft.label);
    setText("ground-aircraft-name", persona.name);
    setText("ground-aircraft-tagline", persona.tagline);
    setText(
      "ground-aircraft-counter",
      `${String(Math.max(0, index) + 1).padStart(2, "0")} / ${AIRCRAFT_CATALOG.length}`,
    );
    element("ground-aircraft-preview").setAttribute(
      "aria-label",
      `Rotating preview of ${persona.name}`,
    );
  }

  private async selectAircraft(id: AircraftId) {
    const request = ++this.aircraftRequest;
    const select = element<HTMLSelectElement>("ground-aircraft");
    const previous = element<HTMLButtonElement>("ground-aircraft-prev");
    const next = element<HTMLButtonElement>("ground-aircraft-next");
    const previewHost = element("ground-aircraft-preview");
    this.aircraftLoading = true;
    this.aircraftAvailable = false;
    select.disabled = true;
    previous.disabled = true;
    next.disabled = true;
    previewHost.classList.add("is-loading");
    this.updateAircraftPresentation(id);
    setText("ground-aircraft-status", "LOADING // PREPARING FLIGHT MODEL");
    try {
      const previewPromise = this.preview.setAircraft(id).catch((error) => {
        console.warn("Aircraft hangar preview failed", error);
        return id;
      });
      const gamePromise = this.game
        ? this.game.setAircraft(id)
        : previewPromise;
      const [previewId, actualId] = await Promise.all([
        previewPromise,
        gamePromise,
      ]);
      if (request !== this.aircraftRequest) return;
      if (actualId !== previewId) await this.preview.setAircraft(actualId);
      if (request !== this.aircraftRequest) return;
      this.selectedAircraftId = actualId;
      this.aircraftAvailable = true;
      this.updateAircraftPresentation(actualId);
      localStorage.setItem(AIRCRAFT_KEY, actualId);
      setText(
        "ground-aircraft-status",
        "READY // RING-SAFE // ANIMATED PROPELLER",
      );
    } catch (error) {
      if (request !== this.aircraftRequest) return;
      console.error(error);
      setText("ground-aircraft-status", "HANGAR HOLD // AIRCRAFT UNAVAILABLE");
    } finally {
      if (request === this.aircraftRequest) {
        this.aircraftLoading = false;
        select.disabled = false;
        previous.disabled = false;
        next.disabled = false;
        previewHost.classList.remove("is-loading");
      }
    }
  }

  private bindActions() {
    for (const id of ["cockpit-return-ground", "cockpit-runway-ground"])
      element(id).addEventListener("click", () =>
        this.dispatchEvent(new Event("requestground")),
      );
    element<HTMLButtonElement>("cockpit-mute").addEventListener(
      "click",
      (event) => {
        this.muted = !this.muted;
        this.sound.setMuted(this.muted);
        const button = event.currentTarget as HTMLButtonElement;
        button.textContent = this.muted ? "SOUND OFF" : "SOUND ON";
        button.setAttribute("aria-pressed", String(this.muted));
      },
    );
    const xrButton = element<HTMLButtonElement>("cockpit-enter-xr");
    xrButton.addEventListener("click", async () => {
      try {
        const game = this.ensureGame();
        await this.sound.unlock();
        await game.enterImmersive();
        xrButton.textContent = "IMMERSIVE ACTIVE";
      } catch (error) {
        xrButton.textContent = "WEBXR FAILED";
        console.error(error);
      }
    });
    this.bindSteeringButton("cockpit-steer-left", -1);
    this.bindSteeringButton("cockpit-steer-right", 1);
  }

  private updateSteering() {
    const latest = Array.from(this.steeringPointers.values()).at(-1);
    this.game?.setSteering(latest?.axis ?? 0);
  }

  private releaseSteering(pointerId?: number) {
    if (pointerId === undefined) {
      for (const { button } of this.steeringPointers.values()) {
        button.classList.remove("is-held");
        button.setAttribute("aria-pressed", "false");
      }
      this.steeringPointers.clear();
    } else {
      const active = this.steeringPointers.get(pointerId);
      this.steeringPointers.delete(pointerId);
      if (
        active &&
        !Array.from(this.steeringPointers.values()).some(
          ({ button }) => button === active.button,
        )
      ) {
        active.button.classList.remove("is-held");
        active.button.setAttribute("aria-pressed", "false");
      }
    }
    this.updateSteering();
  }

  private bindSteeringButton(id: string, axis: -1 | 1) {
    const button = element<HTMLButtonElement>(id);
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.steeringPointers.set(event.pointerId, { axis, button });
      button.classList.add("is-held");
      button.setAttribute("aria-pressed", "true");
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        /* Pointer capture is optional on older mobile browsers. */
      }
      this.updateSteering();
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      button.addEventListener(type, (event) =>
        this.releaseSteering((event as PointerEvent).pointerId),
      );
  }

  private handleScore = (event: CustomEvent) => {
    const { score, points = 0, kind } = event.detail;
    this.dispatchEvent(
      new CustomEvent("score", { detail: { score, points, kind } }),
    );
    setText("cockpit-score", String(score).padStart(3, "0"));
    if (kind !== "pass") return;
    this.sound.ring(true);
    const reward = element("cockpit-reward");
    reward.replaceChildren();
    const praise = document.createElement("strong");
    praise.textContent = "NICE FLYING!";
    const value = document.createElement("span");
    value.textContent = `+${points}`;
    reward.append(praise, value);
    reward.hidden = false;
    reward.classList.remove("is-active");
    requestAnimationFrame(() => reward.classList.add("is-active"));
    if (this.rewardTimer) clearTimeout(this.rewardTimer);
    this.rewardTimer = window.setTimeout(() => {
      reward.classList.remove("is-active");
      reward.hidden = true;
    }, 1_250);
  };

  async start(telemetry: CockpitTelemetry) {
    let game: EcgGameModule;
    try {
      game = this.ensureGame();
    } catch (error) {
      this.showGameUnavailable(error);
      return false;
    }
    await this.aircraftReady;
    await this.sound.unlock();
    this.started = true;
    this.effectiveReady = this.recovery.begin(
      telemetry.ready,
      performance.now(),
    ).ready;
    element("cockpit-runway-panel").hidden = true;
    this.lastBeatCounter = undefined;
    this.accept(telemetry);
    game.restart();
    game.setPaused(!this.effectiveReady || !this.visible);
    requestAnimationFrame(() => dispatchEvent(new Event("resize")));
    return true;
  }

  accept(telemetry: CockpitTelemetry) {
    if (!this.game) return;
    const { frame } = telemetry;
    const recovery = this.started
      ? this.recovery.update(telemetry.ready, performance.now())
      : { ready: false, holding: false };
    this.effectiveReady = recovery.ready;
    this.game.setControls(frame);
    const normalized = Math.max(0, Math.min(1, (frame.altitude + 1) / 2));
    setText("cockpit-signal-label", telemetry.signalLabel.toUpperCase());
    setText("cockpit-signal-value", normalized.toFixed(2));
    const bar = element("cockpit-signal-bar").querySelector<HTMLElement>("b");
    if (bar) bar.style.width = `${Math.round(normalized * 100)}%`;
    setText("cockpit-source", telemetry.sourceLabel || "—");
    setText(
      "cockpit-quality",
      telemetry.route === "local"
        ? `LOCAL · ${Math.round(frame.quality * 100)}%`
        : `${telemetry.route.toUpperCase()} · ${telemetry.latencyMs === undefined ? "—" : `${telemetry.latencyMs} MS`}`,
    );
    element("cockpit-link-dot").classList.toggle(
      "is-live",
      this.effectiveReady,
    );
    setText(
      "cockpit-link-state",
      this.effectiveReady
        ? "CARDIAC LINK LIVE"
        : telemetry.ready && recovery.countdownSeconds !== undefined
          ? "LINK RECOVERING"
          : "SIGNAL HOLD",
    );
    const pause = element("cockpit-pause-panel");
    pause.hidden = this.effectiveReady || !this.started;
    setText(
      "cockpit-pause-copy",
      telemetry.ready && recovery.countdownSeconds !== undefined
        ? `Signal recovered. Resuming in ${recovery.countdownSeconds}…`
        : (telemetry.holdReason ??
            "Return to Ground Control and restore the signal."),
    );
    if (this.started)
      this.game.setPaused(!this.effectiveReady || !this.visible);
    if (this.effectiveReady && isFreshBeat(frame, this.lastBeatCounter)) {
      this.lastBeatCounter = frame.beatCounter;
      this.game.heartbeat();
      this.sound.beat();
    } else if (frame.beatCounter !== this.lastBeatCounter) {
      this.lastBeatCounter = frame.beatCounter;
    }
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.preview.setActive(!visible);
    if (!visible) this.releaseSteering();
    element("ground-view").hidden = visible;
    element("cockpit-view").hidden = !visible;
    element<HTMLButtonElement>("ground-view-toggle").setAttribute(
      "aria-pressed",
      String(!visible),
    );
    element<HTMLButtonElement>("cockpit-view-toggle").setAttribute(
      "aria-pressed",
      String(visible),
    );
    document.body.classList.toggle("cockpit-mode", visible);
    element("cockpit-runway-panel").hidden = this.started;
    if (visible)
      try {
        this.ensureGame();
      } catch (error) {
        this.showGameUnavailable(error);
      }
    if (this.game && this.started)
      this.game.setPaused(!visible || !this.effectiveReady);
    if (visible) requestAnimationFrame(() => dispatchEvent(new Event("resize")));
  }

  hasStarted() {
    return this.started;
  }

  currentAircraft() {
    return this.selectedAircraftId;
  }

  aircraftIsReady() {
    return !this.aircraftLoading && this.aircraftAvailable;
  }

  async immersiveSupported() {
    try {
      const game = this.ensureGame();
      const supported = await game.immersiveSupported();
      element<HTMLButtonElement>("cockpit-enter-xr").hidden = !supported;
      return supported;
    } catch (error) {
      this.showGameUnavailable(error);
      return false;
    }
  }

  dispose() {
    if (this.rewardTimer) clearTimeout(this.rewardTimer);
    this.releaseSteering();
    this.preview.dispose();
    this.game?.dispose();
  }
}
