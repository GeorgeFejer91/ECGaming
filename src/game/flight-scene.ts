import * as THREE from "three";
import "./flight-options.css";
import { PhoneTiltHost } from "../phone-tilt/host";
import { phoneThrottle } from "../phone-tilt/controls";
import { FlightEffects } from "./flight-effects";
import { WingEcgProjection } from "./wing-ecg-projection";
import type { WingEcgFrame } from "../signals/wing-ecg-signal";
import { advanceSteering, cardiacEnvelope, RrBeatClock, touchesMountain, type MountainPeak, type RrHeartbeatSignal } from "./flight-mechanics";
import type { FlightFrame } from "../protocol/types";
import {
  createProceduralAircraftVisual,
  DEFAULT_AIRCRAFT_ID,
  disposeAircraftVisual,
  flightAssetUrl,
  loadAircraftVisual,
  spinAircraftPropeller,
  type AircraftId,
} from "./aircraft";
import type { EcgGameModule, GameSnapshot } from "./ecg-game-module";
import {
  aircraftAttitude,
  applyRingResult,
  headTiltSteering,
  ringIntervalSeconds,
  ringPassed,
  worldSpeed,
} from "./rules";

const event = <T>(type: string, detail: T) => {
  const value = new Event(type);
  Object.defineProperty(value, "detail", { value: detail, enumerable: true });
  return value;
};
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

interface RingActor {
  mesh: THREE.Group;
  resolved: boolean;
}
interface WorldActor {
  object: THREE.Object3D;
  resetZ: number;
  initialZ?: number;
  peaks?: MountainPeak[];
}

export class HeartbeatFlightGame extends EventTarget implements EcgGameModule {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, 450);
  readonly renderer: THREE.WebGLRenderer;
  readonly plane = new THREE.Group();
  private readonly aircraftPulseRoot = new THREE.Group();
  private aircraftVisual?: THREE.Group;
  private propellers: THREE.Group[] = [];
  private aircraftId: AircraftId = DEFAULT_AIRCRAFT_ID;
  private aircraftLoadToken = 0;
  private rings: RingActor[] = [];
  private worldActors: WorldActor[] = [];
  private running = false;
  private paused = false;
  private score = 0;
  private frame: FlightFrame = {
    sequence: 0,
    beatCounter: 0,
    altitude: 0,
    throttle: 0.5,
    traffic: 0.5,
    beatAgeMs: 999999,
    quality: 0,
    flags: 0,
  };
  private lastTime = performance.now();
  private spawnClock = 0;
  private horizontal = 0;
  private horizontalVelocity = 0;
  private keys = new Set<string>();
  private touchX?: number;
  private pointerId?: number;
  private touchAxis = 0;
  private steeringAxis = 0;
  private pulseAge = Infinity;
  private pulseInterval = 800;
  private readonly beatClock = new RrBeatClock();
  private readonly effects: FlightEffects;
  private readonly wingEcg = new WingEcgProjection();
  private readonly ecgReadout = document.createElement("p");
  private pulseMaterials: THREE.MeshStandardMaterial[] = [];
  private pulseParts: { object: THREE.Object3D; scale: THREE.Vector3; roll: number }[] = [];
  private readonly exhaustPosition = new THREE.Vector3();
  private exhaustSockets: THREE.Object3D[] = [];
  private readonly previousPlanePosition = new THREE.Vector3();
  private crashed = false;
  private crashAge = 0;
  private mountainCollisions = false;
  private readonly options = document.createElement("details");
  private readonly phoneController: PhoneTiltHost;
  private readonly crashPanel = document.createElement("section");
  private readonly crashRestart = document.createElement("button");
  private readonly beatReadout = document.createElement("p");
  private tissueTexture?: THREE.Texture;
  private disposed = false;
  private xrEntry?: Promise<void>;
  private xrSession?: XRSession;
  private readonly headsetQuaternion = new THREE.Quaternion();
  private readonly headsetEuler = new THREE.Euler(0, 0, 0, "YXZ");

  constructor(private container: HTMLElement) {
    super();
    this.scene.background = new THREE.Color("#c4ded7");
    this.scene.fog = new THREE.Fog("#c4ded7", 58, 230);
    this.camera.position.set(0, 6.3, 11.5);
    this.camera.lookAt(0, 2.6, -25);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType("local");
    // A small XR framebuffer reduction is a useful safety margin on standalone
    // headsets. Three.js ignores fixed foveation where the runtime lacks it.
    this.renderer.xr.setFramebufferScaleFactor(0.9);
    this.container.append(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = "none";
    this.effects = new FlightEffects(this.scene);
    this.buildOptions();
    this.phoneController = new PhoneTiltHost(this.options, () => this.running && !this.paused && !this.crashed);
    this.buildLighting();
    this.buildPlane();
    this.buildWorld();
    this.bindInputs();
    this.resize();
    addEventListener("resize", this.resize);
    this.renderer.setAnimationLoop(this.animate);
  }
  private buildOptions() {
    this.options.className = "flight-game-options";
    const summary = document.createElement("summary");
    summary.textContent = "Flight options";
    const label = document.createElement("label");
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    try { this.mountainCollisions = localStorage.getItem("ecgaming-mountain-crashes-v1") === "true"; } catch { /* Storage is optional. */ }
    toggle.checked = this.mountainCollisions;
    toggle.addEventListener("change", () => this.setMountainCollisions(toggle.checked));
    label.append(toggle, "Explode on mountain impact");
    const hint = document.createElement("p");
    hint.textContent = "A/D or arrows: gentle bank. Drag and hold: steer. Excitometer: height. RR heartbeat: contraction, wing flex and a smoke puff.";
    this.beatReadout.textContent = "Waiting for Polar RR beats";
    this.beatReadout.setAttribute("data-rr-status", "waiting");
    this.options.append(summary, label, hint, this.beatReadout);
    const ecgLabel = document.createElement("label");
    const ecgToggle = document.createElement("input");
    ecgToggle.type = "checkbox";
    ecgToggle.checked = true;
    ecgToggle.addEventListener("change", () => this.wingEcg.setEnabled(ecgToggle.checked));
    ecgLabel.append(ecgToggle, "Show local ECG on wings");
    this.ecgReadout.dataset.ecgWings = "waiting";
    this.ecgReadout.textContent = "Wing ECG: waiting for local Polar samples";
    this.options.append(ecgLabel, this.ecgReadout);
    this.crashPanel.className = "flight-crash-panel";
    this.crashPanel.hidden = true;
    this.crashPanel.setAttribute("role", "status");
    const title = document.createElement("h2");
    title.textContent = "Mountain impact";
    const copy = document.createElement("p");
    copy.textContent = "Your flight has ended. Steer toward the open valley and try again.";
    this.crashRestart.type = "button";
    this.crashRestart.textContent = "Fly again";
    this.crashRestart.addEventListener("click", () => {
      if (this.paused || this.crashAge < 1.2) return;
      this.restart();
      this.renderer.domElement.focus({ preventScroll: true });
    });
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute("aria-label", "Flight controls: A or left arrow, D or right arrow");
    this.crashPanel.append(title, copy, this.crashRestart);
    this.container.parentElement?.append(this.options, this.crashPanel);
  }
  private buildLighting() {
    this.scene.add(new THREE.HemisphereLight("#f2fdff", "#2b5445", 2.8));
    const sun = new THREE.DirectionalLight("#fff0c9", 3.1);
    sun.position.set(-25, 38, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -35;
    sun.shadow.camera.right = 35;
    sun.shadow.camera.top = 35;
    sun.shadow.camera.bottom = -20;
    this.scene.add(sun);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(10, 28),
      new THREE.MeshBasicMaterial({ color: "#ffd46a", fog: false }),
    );
    disc.position.set(-42, 32, -175);
    this.scene.add(disc);
  }
  private buildPlane() {
    const visual = createProceduralAircraftVisual();
    this.aircraftPulseRoot.add(visual.root);
    this.aircraftVisual = visual.root;
    this.propellers = visual.propellers;
    this.plane.add(this.aircraftPulseRoot);
    this.plane.position.set(0, 2.4, 0);
    this.scene.add(this.plane);
  }
  private buildWorld() {
    this.tissueTexture = new THREE.TextureLoader().load(flightAssetUrl("assets/flight/capillary-tissue.png"));
    this.tissueTexture.colorSpace = THREE.SRGBColorSpace;
    this.tissueTexture.wrapS = this.tissueTexture.wrapT = THREE.RepeatWrapping;
    this.tissueTexture.repeat.set(28, 36);
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(500, 620, 14, 20),
      new THREE.MeshStandardMaterial({
        color: "#7ba69a",
        map: this.tissueTexture,
        roughness: 0.9,
        flatShading: true,
      }),
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, -2, -115);
    sea.receiveShadow = true;
    this.scene.add(sea);
    for (let index = 0; index < 18; index += 1) this.createMountain(index);
    for (let index = 0; index < 20; index += 1) this.createCloud(index);
    for (let index = 0; index < 22; index += 1) this.createBuilding(index);
    for (let index = 0; index < 4; index += 1) this.spawnRing(-28 - index * 32);
  }
  private createMountain(index: number) {
    const group = new THREE.Group(),
      material = new THREE.MeshStandardMaterial({
        color:
          index % 3 === 0 ? "#ae736f" : index % 3 === 1 ? "#bd9082" : "#80666c",
        roughness: 1,
        flatShading: true,
      });
    const peaks: MountainPeak[] = [];
    for (let peak = 0; peak < 3; peak += 1) {
      const size = 4 + ((index * 7 + peak * 3) % 7);
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(size, size * 1.25, 5),
        material,
      );
      cone.position.set((peak - 1) * size * 0.7, size * 0.45, 0);
      cone.rotation.y = peak * 0.7;
      cone.castShadow = true;
      cone.receiveShadow = true;
      group.add(cone);
      peaks.push({ x: cone.position.x, y: cone.position.y - size * 1.25 / 2, z: 0, radius: size, height: size * 1.25, rotation: cone.rotation.y });
      // Conduction-like contour seams remain attached to the terrain.
      for (const fraction of [.28, .54, .76]) {
        const points = Array.from({ length: 6 }, (_, i) => {
          const angle = i * Math.PI * 2 / 5;
          return new THREE.Vector3(Math.sin(angle)*size*(1-fraction)*1.005,
            size*1.25*(fraction-.5), Math.cos(angle)*size*(1-fraction)*1.005);
        });
        const seam = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color: "#ecc4aa", transparent: true, opacity: .38 }));
        cone.add(seam);
      }
    }
    const side = index % 2 ? -1 : 1;
    group.position.set(side * (16 + (index % 5) * 7), -2, -30 - index * 15);
    this.scene.add(group);
    this.worldActors.push({ object: group, resetZ: -290, initialZ: group.position.z, peaks });
  }
  private createCloud(index: number) {
    const group = new THREE.Group(),
      material = new THREE.MeshLambertMaterial({
        color: index % 3 ? "#f5fcf4" : "#d8edf0",
        flatShading: true,
      });
    for (let puff = 0; puff < 4; puff += 1) {
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.4 + (puff % 2) * 0.65, 1),
        material,
      );
      mesh.position.set(puff * 1.5 - 2.2, Math.sin(puff) * 0.5, 0);
      group.add(mesh);
    }
    group.scale.setScalar(0.7 + (index % 4) * 0.22);
    group.position.set(
      (index % 2 ? -1 : 1) * (11 + (index % 7) * 5),
      8 + (index % 5) * 2.4,
      -25 - index * 19,
    );
    this.scene.add(group);
    this.worldActors.push({ object: group, resetZ: -385 });
  }
  private createBuilding(index: number) {
    const group = new THREE.Group(),
      colors = ["#d65b43", "#e8b34c", "#f1dfb2", "#4d7790"];
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(
        1.5 + (index % 3) * 0.6,
        1.8 + (index % 5) * 0.5,
        1.6,
      ),
      new THREE.MeshStandardMaterial({
        color: colors[index % colors.length],
        roughness: 0.9,
      }),
    );
    body.castShadow = true;
    group.add(body);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(1.4 + (index % 3) * 0.35, 0.9, 4),
      new THREE.MeshStandardMaterial({ color: "#8f3c38", roughness: 1 }),
    );
    roof.position.y = body.geometry.parameters.height / 2 + 0.4;
    roof.rotation.y = Math.PI / 4;
    group.add(roof);
    group.position.set(
      (index % 2 ? -1 : 1) * (9 + (index % 6) * 2.2),
      -1,
      -20 - index * 12,
    );
    this.scene.add(group);
    this.worldActors.push({ object: group, resetZ: -300 });
  }
  private spawnRing(z = -150) {
    const group = new THREE.Group(),
      gold = new THREE.MeshStandardMaterial({
        color: "#ffd15a",
        emissive: "#4b2604",
        roughness: 0.52,
      }),
      dark = new THREE.MeshStandardMaterial({
        color: "#bd6a26",
        roughness: 0.7,
      });
    const outer = new THREE.Mesh(
      new THREE.TorusGeometry(2.25, 0.22, 10, 28),
      gold,
    );
    outer.castShadow = true;
    group.add(outer);
    for (let index = 0; index < 8; index += 1) {
      const tab = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.42), dark);
      const angle = (index / 8) * Math.PI * 2;
      tab.position.set(Math.cos(angle) * 2.25, Math.sin(angle) * 2.25, 0);
      tab.rotation.z = angle;
      group.add(tab);
    }
    // A gently meandering route: each next gate stays reachable from its predecessor.
    const previous = this.rings.at(-1)?.mesh.position;
    group.position.set(clamp((previous?.x ?? 0) + (Math.random()-.5)*5, -5.5, 5.5),
      clamp((previous?.y ?? 3) + (Math.random()-.5)*2.5, 1.2, 5.3), z);
    this.scene.add(group);
    this.rings.push({ mesh: group, resolved: false });
  }
  private bindInputs() {
    addEventListener("keydown", this.keyDown);
    addEventListener("keyup", this.keyUp);
    addEventListener("blur", this.clearInputs);
    document.addEventListener("visibilitychange", this.visibilityChanged);
    this.renderer.domElement.addEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.addEventListener("pointermove", this.pointerMove);
    this.renderer.domElement.addEventListener("pointerup", this.pointerUp);
    this.renderer.domElement.addEventListener("pointercancel", this.pointerUp);
    this.renderer.domElement.addEventListener("lostpointercapture", this.pointerUp);
  }
  private keyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLElement && event.target.closest("input, select, textarea, button, summary, [contenteditable]")) return;
    if (!this.running || this.paused || this.crashed) return;
    if (["a", "d", "arrowleft", "arrowright"].includes(event.key.toLowerCase())) event.preventDefault();
    this.keys.add(event.key.toLowerCase());
  };
  private keyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.key.toLowerCase());
  };
  private pointerDown = (event: PointerEvent) => {
    if (this.pointerId !== undefined || !this.running || this.paused || this.crashed) return;
    this.pointerId = event.pointerId;
    this.touchX = event.clientX;
    this.touchAxis = 0;
    this.renderer.domElement.focus({ preventScroll: true });
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };
  private pointerMove = (event: PointerEvent) => {
    if (this.touchX === undefined || event.pointerId !== this.pointerId) return;
    this.touchAxis = clamp((event.clientX - this.touchX) / Math.max(60, this.container.clientWidth * .16), -1, 1);
  };
  private pointerUp = (event?: PointerEvent) => {
    if (event && event.pointerId !== this.pointerId) return;
    const id = this.pointerId;
    this.pointerId = undefined;
    this.touchX = undefined;
    this.touchAxis = 0;
    if (id !== undefined && this.renderer.domElement.hasPointerCapture(id))
      this.renderer.domElement.releasePointerCapture(id);
  };
  private clearInputs = () => {
    this.keys.clear(); this.steeringAxis = 0; this.horizontalVelocity = 0;
    this.pointerUp();
  };
  private visibilityChanged = () => { if (document.hidden) this.clearInputs(); };
  private resize = () => {
    const width = this.container.clientWidth || innerWidth,
      height = this.container.clientHeight || innerHeight;
    this.camera.aspect = width / height;
    if (!this.renderer.xr.isPresenting) this.camera.position.z = this.camera.aspect < .8 ? 15.5 : 11.5;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };
  private animate = (time: number) => {
    if (this.disposed) return;
    const delta = Math.min(0.05, Math.max(0, (time - this.lastTime) / 1000));
    this.lastTime = time;
    if (this.crashed) {
      if (!this.paused) { this.crashAge += delta; this.effects.update(delta, 0); }
      this.crashRestart.disabled = this.paused || this.crashAge < 1.2;
      this.crashRestart.textContent = this.paused ? "Waiting for signal…" : "Fly again";
    } else if (this.running && !this.paused) this.update(delta);
    else if (!this.running) this.updateIdle(delta, time);
    const ecgState = this.wingEcg.update(time);
    if (this.ecgReadout.dataset.ecgWings !== ecgState) {
      this.ecgReadout.dataset.ecgWings = ecgState;
      this.ecgReadout.textContent = ecgState === "live" ? "Wing ECG: local Polar waveform · 3 s · auto-scaled"
        : ecgState === "simulated" ? "Wing ECG: simulated waveform"
        : ecgState === "stale" ? "Wing ECG: samples stopped"
        : ecgState === "off" ? "Wing ECG: off"
        : ecgState === "unsupported" ? "Wing ECG: select a cardiac aircraft"
        : "Wing ECG: waiting for local Polar samples";
    }
    this.renderer.render(this.scene, this.camera);
  };
  private updateInput(delta: number) {
    let axis: number;
    const phone = this.phoneController.read();
    if (phone) {
      // Selected phone mode owns steering in both flat and immersive flight.
      // Loss produces neutral input until the user stops phone control.
      axis = phone.active ? phone.x : 0;
    } else if (this.renderer.xr.isPresenting) {
      let controllerAxis: number | undefined;
      const session = this.renderer.xr.getSession();
      for (const source of session?.inputSources ?? []) {
        const axes = source.gamepad?.axes;
        if (!axes) continue;
        const candidate =
          Math.abs(axes[2] ?? 0) > 0.12 ? (axes[2] ?? 0) : (axes[0] ?? 0);
        if (Math.abs(candidate) > 0.12) {
          controllerAxis = clamp(candidate, -1, 1);
          break;
        }
      }
      const xrCamera = this.renderer.xr.getCamera();
      const headsetCamera = xrCamera.cameras[0] ?? xrCamera;
      headsetCamera.getWorldQuaternion(this.headsetQuaternion);
      this.headsetEuler.setFromQuaternion(this.headsetQuaternion, "YXZ");
      axis = controllerAxis ?? headTiltSteering(this.headsetEuler.z);
    } else {
      const keyboard =
        (this.keys.has("a") || this.keys.has("arrowleft") ? -1 : 0) +
        (this.keys.has("d") || this.keys.has("arrowright") ? 1 : 0);
      axis = clamp(this.steeringAxis + keyboard + this.touchAxis, -1, 1);
      for (const pad of navigator.getGamepads?.() ?? []) {
        if (!pad) continue;
        const candidate =
          Math.abs(pad.axes[2] ?? 0) > 0.1
            ? (pad.axes[2] ?? 0)
            : (pad.axes[0] ?? 0);
        if (Math.abs(candidate) > 0.12) axis = candidate;
      }
    }
    const next = advanceSteering({ position: this.horizontal, velocity: this.horizontalVelocity }, axis, delta);
    this.horizontal = next.position;
    this.horizontalVelocity = next.velocity;
  }
  private update(delta: number) {
    this.previousPlanePosition.copy(this.plane.position);
    this.updateInput(delta);
    const beat = this.beatClock.advance(delta);
    if (beat !== undefined) { this.pulseInterval = beat; this.heartbeat(); }
    const phone = this.phoneController.read();
    const speed = worldSpeed(phone ? phoneThrottle(this.frame.throttle, phone) : this.frame.throttle),
      attitude = aircraftAttitude(
        this.horizontalVelocity,
      );
    const targetY = 0.5 + (clamp(this.frame.altitude, -1, 1) + 1) * 2.65;
    this.plane.position.x = this.horizontal;
    this.plane.position.y +=
      (targetY - this.plane.position.y) * Math.min(1, delta * 3.2);
    this.plane.rotation.z +=
      (attitude.roll - this.plane.rotation.z) * Math.min(1, delta * 6);
    this.plane.rotation.y +=
      (attitude.yaw - this.plane.rotation.y) * Math.min(1, delta * 4.5);
    this.plane.rotation.x += (clamp((targetY-this.plane.position.y)*.045, -.1, .1)-this.plane.rotation.x)*(1-Math.exp(-4*delta));
    for (const propeller of this.propellers)
      spinAircraftPropeller(
        propeller,
        delta * (30 + this.frame.throttle * 45),
      );
    this.updateCardiacMotion(delta);
    this.effects.update(delta, speed);
    if (!this.renderer.xr.isPresenting) {
      const follow = this.camera.aspect < .8 ? .92 : .6;
      this.camera.position.x += (this.horizontal*follow-this.camera.position.x)*(1-Math.exp(-5.5*delta));
      this.camera.lookAt(this.camera.position.x*.8, 2.6, -25);
    }
    for (const actor of this.worldActors) {
      actor.object.position.z += speed * delta;
      if (this.mountainCollisions && actor.peaks && Math.abs(actor.object.position.z) < 14) {
        for (const peak of actor.peaks) {
          const worldPeak = { ...peak, x: peak.x+actor.object.position.x, y: peak.y+actor.object.position.y, z: peak.z+actor.object.position.z };
          // Swept body and wingtip samples include this frame's scenery motion.
          for (let step = 0; step <= 4; step++) {
            const t = step / 4;
            for (const wing of [-1.05, 0, 1.05]) {
              const x = THREE.MathUtils.lerp(this.previousPlanePosition.x, this.plane.position.x, t) + wing*Math.cos(this.plane.rotation.z);
              const y = THREE.MathUtils.lerp(this.previousPlanePosition.y, this.plane.position.y, t) + wing*Math.sin(this.plane.rotation.z);
              const z = speed*delta*(1-t);
              if (touchesMountain(x, y, z, worldPeak, wing === 0 ? .48 : .23)) { this.crash(); return; }
            }
          }
        }
      }
      if (actor.object.position.z > 25)
        actor.object.position.z = actor.resetZ - Math.random() * 50;
    }
    const interval = ringIntervalSeconds(this.frame.traffic);
    this.spawnClock += delta;
    if (this.spawnClock >= interval) {
      this.spawnClock = 0;
      this.spawnRing(-165);
    }
    for (const ring of [...this.rings]) {
      ring.mesh.position.z += speed * delta;
      ring.mesh.rotation.z += delta * 0.18;
      if (!ring.resolved && ring.mesh.position.z >= -0.25) {
        ring.resolved = true;
        const passed = ringPassed(
          this.plane.position.x,
          this.plane.position.y,
          ring.mesh.position.x,
          ring.mesh.position.y,
        );
        const result = applyRingResult(this.score, passed);
        this.score = result.score;
        if (passed) {
          this.dispatchEvent(
            event("score", {
              score: this.score,
              points: result.points,
              kind: "pass",
            }),
          );
          ring.mesh.scale.setScalar(1.22);
        } else {
          this.dispatchEvent(
            event("score", {
              score: this.score,
              points: result.points,
              kind: "miss",
            }),
          );
        }
      }
      if (ring.mesh.position.z > 24) {
        this.scene.remove(ring.mesh);
        disposeAircraftVisual(ring.mesh);
        this.rings.splice(this.rings.indexOf(ring), 1);
      }
    }
  }
  private updateCardiacMotion(delta: number) {
    this.pulseAge += delta;
    const pulse = cardiacEnvelope(this.pulseAge, this.pulseInterval);
    const motion = matchMedia("(prefers-reduced-motion: reduce)").matches ? .3 : 1;
    this.aircraftPulseRoot.scale.set(1-pulse*.10*motion, 1+pulse*.17*motion, 1-pulse*.07*motion);
    for (const part of this.pulseParts) {
      if (part.object.name.includes("capillary_wing"))
        part.object.rotation.z = part.roll + (part.object.name.startsWith("Left") ? -1 : 1)*pulse*.1*motion;
      else part.object.scale.copy(part.scale).multiplyScalar(1+pulse*.17*motion);
    }
    for (const material of this.pulseMaterials) material.emissiveIntensity = .3 + pulse*2;
  }
  private crash() {
    if (this.crashed) return;
    this.crashed = true; this.crashAge = 0;
    this.clearInputs(); this.beatClock.clear();
    this.effects.explode(this.plane.position);
    this.plane.visible = false;
    this.crashPanel.hidden = false;
    this.crashRestart.disabled = true;
    this.dispatchEvent(event("crash", this.snapshot()));
    this.dispatchEvent(event("state", this.snapshot()));
  }
  private updateIdle(delta: number, time: number) {
    this.plane.rotation.z = Math.sin(time * 0.0012) * 0.07;
    this.plane.rotation.y +=
      (0 - this.plane.rotation.y) * Math.min(1, delta * 3);
    this.plane.position.y +=
      (2.4 + Math.sin(time * 0.0014) * 0.18 - this.plane.position.y) *
      Math.min(1, delta * 2);
    for (const propeller of this.propellers)
      spinAircraftPropeller(propeller, delta * 18);
  }
  start() {
    this.running = true;
    this.paused = false;
    this.dispatchEvent(event("state", this.snapshot()));
  }
  restart() {
    for (const ring of this.rings) { this.scene.remove(ring.mesh); disposeAircraftVisual(ring.mesh); }
    this.rings = [];
    for (let index = 0; index < 4; index += 1) this.spawnRing(-28 - index * 32);
    this.score = 0;
    this.spawnClock = 0;
    this.horizontal = 0;
    this.horizontalVelocity = 0;
    this.clearInputs(); this.beatClock.clear(); this.effects.clear();
    this.crashed = false; this.crashAge = 0; this.crashPanel.hidden = true;
    this.plane.visible = true; this.pulseAge = Infinity;
    this.updateCardiacMotion(0);
    for (const actor of this.worldActors) if (actor.initialZ !== undefined) actor.object.position.z = actor.initialZ;
    this.camera.position.x = 0;
    this.plane.position.set(0, 2.4, 0);
    this.plane.rotation.set(0, 0, 0);
    this.start();
    this.dispatchEvent(
      event("score", { score: 0, points: 0, kind: "restart" }),
    );
  }
  setControls(frame: FlightFrame) {
    this.frame = { ...frame };
  }
  setSteering(axis: number) {
    this.steeringAxis = Number.isFinite(axis) ? clamp(axis, -1, 1) : 0;
  }
  openPhoneController(role: "phone" | "cockpit" = "phone") {
    if (role === "cockpit") this.phoneController.openCockpit();
    else this.phoneController.open();
  }
  setMountainCollisions(enabled: boolean) {
    this.mountainCollisions = enabled;
    this.options.querySelector("input")!.checked = enabled;
    try { localStorage.setItem("ecgaming-mountain-crashes-v1", String(enabled)); } catch { /* Storage is optional. */ }
    this.dispatchEvent(event("state", this.snapshot()));
  }
  setHeartbeatSignal(signal: RrHeartbeatSignal) {
    this.beatClock.accept(signal, this.running && !this.paused && !this.crashed);
    const fresh = signal.ready && signal.ageMs >= 0 && signal.ageMs < 1500;
    this.beatReadout.textContent = fresh ? `${signal.simulated ? "Simulated RR" : "Polar RR"} · ${Math.round(signal.rrMs ?? this.beatClock.rrMs)} ms · exhaust puffs on each beat` : "Waiting for Polar RR beats";
    this.beatReadout.dataset.rrStatus = fresh ? "receiving" : "waiting";
  }
  setEcgSignal(frame: WingEcgFrame | null) { this.wingEcg.accept(frame); }
  async setAircraft(requestedId: AircraftId) {
    const token = ++this.aircraftLoadToken;
    let visual;
    let loadError: unknown;
    try {
      visual = await loadAircraftVisual(requestedId);
    } catch (error) {
      loadError = error;
      visual = createProceduralAircraftVisual();
    }

    if (this.disposed || token !== this.aircraftLoadToken) {
      disposeAircraftVisual(visual.root);
      return this.aircraftId;
    }

    const previous = this.aircraftVisual;
    this.wingEcg.unbind();
    this.aircraftPulseRoot.clear();
    this.aircraftPulseRoot.add(visual.root);
    this.aircraftVisual = visual.root;
    this.propellers = visual.propellers;
    this.aircraftId = visual.id;
    this.pulseMaterials = [];
    this.pulseParts = [];
    this.exhaustSockets = [];
    visual.root.traverse(object => {
      if (object.name.startsWith("Exhaust_aperture")) this.exhaustSockets.push(object);
      if (object.name === "VentricleCore" || object.name.includes("capillary_wing"))
        this.pulseParts.push({ object, scale: object.scale.clone(), roll: object.rotation.z });
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials)
        if (material instanceof THREE.MeshStandardMaterial && material.name.startsWith("CardiacPulse") && !this.pulseMaterials.includes(material))
          this.pulseMaterials.push(material);
    });
    this.wingEcg.bind(visual.root);
    if (previous) disposeAircraftVisual(previous);
    const detail = {
      requestedId,
      aircraftId: visual.id,
      fallback: visual.id !== requestedId,
    };
    this.dispatchEvent(event("aircraftchange", detail));
    if (loadError)
      this.dispatchEvent(
        event("aircrafterror", {
          ...detail,
          message:
            loadError instanceof Error
              ? loadError.message
              : "The aircraft model could not be loaded.",
        }),
      );
    return visual.id;
  }
  setPaused(value: boolean) {
    if (this.paused === value) return;
    this.paused = value;
    if (value) { this.clearInputs(); this.beatClock.clear(); this.pulseAge = Infinity; this.updateCardiacMotion(0); }
    this.dispatchEvent(event("state", this.snapshot()));
  }
  heartbeat() {
    if (!this.running || this.paused || this.crashed) return;
    this.pulseAge = 0;
    this.plane.updateMatrixWorld(true);
    if (this.exhaustSockets.length) {
      for (const socket of this.exhaustSockets) {
        socket.getWorldPosition(this.exhaustPosition);
        this.effects.heartbeat(this.exhaustPosition);
      }
    } else {
      this.exhaustPosition.set(0, -.03, 1.0);
      this.plane.localToWorld(this.exhaustPosition);
      this.effects.heartbeat(this.exhaustPosition);
    }
    this.dispatchEvent(event("heartbeat", this.snapshot()));
  }
  snapshot(): GameSnapshot {
    return {
      running: this.running,
      paused: this.paused,
      score: this.score,
      immersive: this.renderer.xr.isPresenting,
      aircraftId: this.aircraftId,
      crashed: this.crashed,
      mountainCollisions: this.mountainCollisions,
    };
  }
  async immersiveSupported() {
    return Boolean(
      navigator.xr && (await navigator.xr.isSessionSupported("immersive-vr")),
    );
  }
  enterImmersive() {
    if (!navigator.xr)
      return Promise.reject(
        new Error("WebXR is not available in this browser."),
      );
    if (this.renderer.xr.isPresenting) return Promise.resolve();
    if (this.xrEntry) return this.xrEntry;

    // requestSession must be invoked in the original click task. Do not put an
    // await (audio unlock, feature probing, etc.) before this call.
    const requested = navigator.xr.requestSession("immersive-vr");
    this.xrEntry = requested
      .then(async (session) => {
        this.xrSession = session;
        const changed = () =>
          this.dispatchEvent(event("xrchange", this.snapshot()));
        try {
          await this.renderer.xr.setSession(session);
        } catch (error) {
          if (this.xrSession === session) this.xrSession = undefined;
          void session.end().catch(() => undefined);
          throw error;
        }
        this.renderer.xr.setFoveation(0.75);
        session.addEventListener("visibilitychange", changed);
        session.addEventListener(
          "end",
          () => {
            session.removeEventListener("visibilitychange", changed);
            if (this.xrSession === session) this.xrSession = undefined;
            changed();
          },
          { once: true },
        );
        changed();
      })
      .finally(() => {
        this.xrEntry = undefined;
      });
    return this.xrEntry;
  }
  dispose() {
    this.disposed = true;
    this.phoneController.dispose();
    this.aircraftLoadToken += 1;
    void this.xrSession?.end().catch(() => undefined);
    this.xrSession = undefined;
    this.renderer.setAnimationLoop(null);
    this.effects.dispose();
    this.wingEcg.dispose();
    disposeAircraftVisual(this.scene);
    this.tissueTexture?.dispose();
    this.options.remove(); this.crashPanel.remove();
    this.renderer.dispose();
    this.container.replaceChildren();
    removeEventListener("resize", this.resize);
    removeEventListener("keydown", this.keyDown);
    removeEventListener("keyup", this.keyUp);
    removeEventListener("blur", this.clearInputs);
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    this.renderer.domElement.removeEventListener(
      "pointerdown",
      this.pointerDown,
    );
    this.renderer.domElement.removeEventListener(
      "pointermove",
      this.pointerMove,
    );
    this.renderer.domElement.removeEventListener("pointerup", this.pointerUp);
    this.renderer.domElement.removeEventListener("lostpointercapture", this.pointerUp);
    this.renderer.domElement.removeEventListener(
      "pointercancel",
      this.pointerUp,
    );
  }
}

export function createFlightScene(container: HTMLElement): EcgGameModule {
  return new HeartbeatFlightGame(container);
}
