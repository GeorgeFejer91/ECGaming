import * as THREE from "three";
import type { FlightFrame } from "../protocol/types";
import {
  createProceduralAircraftVisual,
  DEFAULT_AIRCRAFT_ID,
  disposeAircraftVisual,
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
  private dragBankVelocity = 0;
  private steeringAxis = 0;
  private pulse = 0;
  private disposed = false;
  private xrEntry?: Promise<void>;
  private xrSession?: XRSession;
  private readonly headsetQuaternion = new THREE.Quaternion();
  private readonly headsetEuler = new THREE.Euler(0, 0, 0, "YXZ");

  constructor(private container: HTMLElement) {
    super();
    this.scene.background = new THREE.Color("#82d5ea");
    this.scene.fog = new THREE.Fog("#82d5ea", 48, 230);
    this.camera.position.set(0, 7.2, 14.5);
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
    this.buildLighting();
    this.buildPlane();
    this.buildWorld();
    this.bindInputs();
    this.resize();
    addEventListener("resize", this.resize);
    this.renderer.setAnimationLoop(this.animate);
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
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(500, 620, 14, 20),
      new THREE.MeshStandardMaterial({
        color: "#2d8a91",
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
          index % 3 === 0 ? "#517a5f" : index % 3 === 1 ? "#647f60" : "#315e55",
        roughness: 1,
        flatShading: true,
      });
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
    }
    const side = index % 2 ? -1 : 1;
    group.position.set(side * (16 + (index % 5) * 7), -2, -30 - index * 15);
    this.scene.add(group);
    this.worldActors.push({ object: group, resetZ: -290 });
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
    group.position.set((Math.random() - 0.5) * 12, 0.5 + Math.random() * 5, z);
    this.scene.add(group);
    this.rings.push({ mesh: group, resolved: false });
  }
  private bindInputs() {
    addEventListener("keydown", this.keyDown);
    addEventListener("keyup", this.keyUp);
    this.renderer.domElement.addEventListener("pointerdown", this.pointerDown);
    this.renderer.domElement.addEventListener("pointermove", this.pointerMove);
    this.renderer.domElement.addEventListener("pointerup", this.pointerUp);
    this.renderer.domElement.addEventListener("pointercancel", this.pointerUp);
  }
  private keyDown = (event: KeyboardEvent) => {
    this.keys.add(event.key.toLowerCase());
  };
  private keyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.key.toLowerCase());
  };
  private pointerDown = (event: PointerEvent) => {
    this.touchX = event.clientX;
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };
  private pointerMove = (event: PointerEvent) => {
    if (this.touchX === undefined) return;
    const movement =
      ((event.clientX - this.touchX) / Math.max(300, innerWidth)) * 2;
    this.horizontal = clamp(this.horizontal + movement, -1, 1);
    this.dragBankVelocity = clamp(movement * 26, -5, 5);
    this.touchX = event.clientX;
  };
  private pointerUp = () => {
    this.touchX = undefined;
  };
  private resize = () => {
    const width = this.container.clientWidth || innerWidth,
      height = this.container.clientHeight || innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };
  private animate = (time: number) => {
    if (this.disposed) return;
    const delta = Math.min(0.05, Math.max(0, (time - this.lastTime) / 1000));
    this.lastTime = time;
    if (this.running && !this.paused) this.update(delta, time);
    else this.updateIdle(delta, time);
    this.renderer.render(this.scene, this.camera);
  };
  private updateInput(delta: number) {
    let axis: number;
    if (this.renderer.xr.isPresenting) {
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
      axis = clamp(this.steeringAxis + keyboard, -1, 1);
      for (const pad of navigator.getGamepads?.() ?? []) {
        if (!pad) continue;
        const candidate =
          Math.abs(pad.axes[2] ?? 0) > 0.1
            ? (pad.axes[2] ?? 0)
            : (pad.axes[0] ?? 0);
        if (Math.abs(candidate) > 0.12) axis = candidate;
      }
    }
    this.horizontalVelocity +=
      (axis * 9 - this.horizontalVelocity) * Math.min(1, delta * 7);
    this.dragBankVelocity +=
      (0 - this.dragBankVelocity) * Math.min(1, delta * 5.5);
    this.horizontal = clamp(
      this.horizontal + this.horizontalVelocity * delta,
      -1,
      1,
    );
  }
  private update(delta: number, time: number) {
    this.updateInput(delta);
    const speed = worldSpeed(this.frame.throttle),
      attitude = aircraftAttitude(
        this.horizontalVelocity,
        this.dragBankVelocity,
      );
    const targetY = 0.5 + (clamp(this.frame.altitude, -1, 1) + 1) * 2.65;
    this.plane.position.x +=
      (this.horizontal * 8 - this.plane.position.x) * Math.min(1, delta * 4.5);
    this.plane.position.y +=
      (targetY - this.plane.position.y) * Math.min(1, delta * 3.2);
    this.plane.rotation.z +=
      (attitude.roll - this.plane.rotation.z) * Math.min(1, delta * 6);
    this.plane.rotation.y +=
      (attitude.yaw - this.plane.rotation.y) * Math.min(1, delta * 4.5);
    this.plane.rotation.x = Math.sin(time * 0.002) * 0.025;
    for (const propeller of this.propellers)
      spinAircraftPropeller(
        propeller,
        delta * (30 + this.frame.throttle * 45),
      );
    this.pulse = Math.max(0, this.pulse - delta * 3.5);
    this.aircraftPulseRoot.scale.setScalar(1 + this.pulse * 0.06);
    for (const actor of this.worldActors) {
      actor.object.position.z += speed * delta;
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
        this.rings.splice(this.rings.indexOf(ring), 1);
      }
    }
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
    for (const ring of this.rings) this.scene.remove(ring.mesh);
    this.rings = [];
    for (let index = 0; index < 4; index += 1) this.spawnRing(-28 - index * 32);
    this.score = 0;
    this.spawnClock = 0;
    this.horizontal = 0;
    this.horizontalVelocity = 0;
    this.dragBankVelocity = 0;
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
  async setAircraft(requestedId: AircraftId) {
    const token = ++this.aircraftLoadToken;
    let visual;
    let loadError: unknown;
    try {
      visual = await loadAircraftVisual(requestedId);
    } catch (error) {
      loadError = error;
      visual = await loadAircraftVisual(DEFAULT_AIRCRAFT_ID);
    }

    if (this.disposed || token !== this.aircraftLoadToken) {
      disposeAircraftVisual(visual.root);
      return this.aircraftId;
    }

    const previous = this.aircraftVisual;
    this.aircraftPulseRoot.clear();
    this.aircraftPulseRoot.add(visual.root);
    this.aircraftVisual = visual.root;
    this.propellers = visual.propellers;
    this.aircraftId = visual.id;
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
    this.dispatchEvent(event("state", this.snapshot()));
  }
  heartbeat() {
    this.pulse = 1;
    this.dispatchEvent(event("heartbeat", this.snapshot()));
  }
  snapshot(): GameSnapshot {
    return {
      running: this.running,
      paused: this.paused,
      score: this.score,
      immersive: this.renderer.xr.isPresenting,
      aircraftId: this.aircraftId,
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
    this.aircraftLoadToken += 1;
    void this.xrSession?.end().catch(() => undefined);
    this.xrSession = undefined;
    this.renderer.setAnimationLoop(null);
    if (this.aircraftVisual) disposeAircraftVisual(this.aircraftVisual);
    this.renderer.dispose();
    this.container.replaceChildren();
    removeEventListener("resize", this.resize);
    removeEventListener("keydown", this.keyDown);
    removeEventListener("keyup", this.keyUp);
    this.renderer.domElement.removeEventListener(
      "pointerdown",
      this.pointerDown,
    );
    this.renderer.domElement.removeEventListener(
      "pointermove",
      this.pointerMove,
    );
    this.renderer.domElement.removeEventListener("pointerup", this.pointerUp);
    this.renderer.domElement.removeEventListener(
      "pointercancel",
      this.pointerUp,
    );
  }
}

export function createFlightScene(container: HTMLElement): EcgGameModule {
  return new HeartbeatFlightGame(container);
}
