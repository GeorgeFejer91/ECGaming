import * as THREE from "three";
import type { FlightFrame } from "../protocol/types";
import type { EcgGameModule, GameSnapshot } from "./ecg-game-module";
import {
  aircraftAttitude,
  applyRingResult,
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
  private rings: RingActor[] = [];
  private worldActors: WorldActor[] = [];
  private running = false;
  private paused = false;
  private score = 0;
  private lives = 3;
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
  private pulse = 0;
  private disposed = false;

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
    const yellow = new THREE.MeshStandardMaterial({
        color: "#f4b33a",
        roughness: 0.58,
        metalness: 0.08,
      }),
      navy = new THREE.MeshStandardMaterial({
        color: "#123a58",
        roughness: 0.68,
      }),
      orange = new THREE.MeshStandardMaterial({
        color: "#e95f37",
        roughness: 0.62,
      }),
      glass = new THREE.MeshStandardMaterial({
        color: "#71cfe0",
        roughness: 0.18,
        metalness: 0.24,
      }),
      rubber = new THREE.MeshStandardMaterial({
        color: "#17222a",
        roughness: 0.92,
      }),
      redLight = new THREE.MeshStandardMaterial({
        color: "#ff4e43",
        emissive: "#ff2417",
        emissiveIntensity: 1.8,
      }),
      greenLight = new THREE.MeshStandardMaterial({
        color: "#67e88d",
        emissive: "#1ed760",
        emissiveIntensity: 1.8,
      });
    const add = (
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      position: [number, number, number],
      rotation: [number, number, number] = [0, 0, 0],
    ) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.rotation.set(...rotation);
      mesh.castShadow = true;
      this.plane.add(mesh);
      return mesh;
    };

    const surface = (
      points: [number, number][],
      thickness: number,
      material: THREE.Material,
      y: number,
    ) => {
      const shape = new THREE.Shape();
      points.forEach(([x, z], index) => {
        if (index === 0) shape.moveTo(x, z);
        else shape.lineTo(x, z);
      });
      shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: thickness,
        bevelEnabled: false,
      });
      geometry.rotateX(Math.PI / 2);
      geometry.translate(0, thickness / 2, 0);
      return add(geometry, material, [0, y, 0]);
    };

    // The airplane points down -Z. A tapered low wing and swept tailplane
    // keep its silhouette readable from the game's rear chase camera.
    add(
      new THREE.CapsuleGeometry(0.62, 3.75, 7, 16),
      yellow,
      [0, 0.03, -0.05],
      [Math.PI / 2, 0, 0],
    );
    add(
      new THREE.CylinderGeometry(0.64, 0.59, 0.72, 16),
      orange,
      [0, 0.02, -2.18],
      [Math.PI / 2, 0, 0],
    );
    add(
      new THREE.ConeGeometry(0.59, 0.92, 16),
      yellow,
      [0, 0.02, -2.99],
      [-Math.PI / 2, 0, 0],
    );
    add(new THREE.BoxGeometry(0.72, 0.16, 3.45), navy, [0, -0.55, 0.05]);

    surface(
      [
        [-0.25, -0.72],
        [-3.28, -0.04],
        [-3, 0.77],
        [-0.2, 0.93],
        [0.2, 0.93],
        [3, 0.77],
        [3.28, -0.04],
        [0.25, -0.72],
      ],
      0.17,
      navy,
      -0.08,
    );
    surface(
      [
        [-0.38, 0.63],
        [-3.02, 0.57],
        [-2.94, 0.78],
        [-0.34, 0.88],
      ],
      0.055,
      orange,
      0.025,
    );
    surface(
      [
        [0.38, 0.63],
        [3.02, 0.57],
        [2.94, 0.78],
        [0.34, 0.88],
      ],
      0.055,
      orange,
      0.025,
    );
    surface(
      [
        [-0.16, 1.22],
        [-1.68, 1.58],
        [-1.45, 2.16],
        [-0.12, 1.98],
        [0.12, 1.98],
        [1.45, 2.16],
        [1.68, 1.58],
        [0.16, 1.22],
      ],
      0.13,
      yellow,
      0.12,
    );

    const finShape = new THREE.Shape();
    finShape.moveTo(1.16, 0);
    finShape.lineTo(1.43, 1.52);
    finShape.lineTo(2.05, 0.32);
    finShape.lineTo(2.18, 0);
    finShape.closePath();
    const finGeometry = new THREE.ShapeGeometry(finShape);
    finGeometry.rotateY(-Math.PI / 2);
    const fin = add(finGeometry, navy, [0, 0.25, 0]);
    fin.material.side = THREE.DoubleSide;

    const rudderShape = new THREE.Shape();
    rudderShape.moveTo(1.72, 0.25);
    rudderShape.lineTo(1.47, 1.34);
    rudderShape.lineTo(2.01, 0.31);
    rudderShape.closePath();
    const rudderGeometry = new THREE.ShapeGeometry(rudderShape);
    rudderGeometry.rotateY(-Math.PI / 2);
    const rudder = add(rudderGeometry, orange, [-0.012, 0.25, 0]);
    rudder.material.side = THREE.DoubleSide;

    add(
      new THREE.SphereGeometry(0.5, 16, 10),
      glass,
      [0, 0.51, -0.28],
      [0, 0, 0],
    ).scale.set(0.88, 0.72, 1.45);
    add(new THREE.BoxGeometry(0.92, 0.07, 0.1), navy, [0, 0.58, -0.27]);

    const propeller = new THREE.Group();
    propeller.name = "propeller";
    propeller.position.set(0, 0.02, -3.48);
    for (const angle of [0, Math.PI / 2]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.5, 0.09), navy);
      blade.rotation.z = angle;
      blade.castShadow = true;
      propeller.add(blade);
    }
    this.plane.add(propeller);
    add(
      new THREE.CylinderGeometry(0.2, 0.2, 0.28, 12),
      orange,
      [0, 0.02, -3.35],
      [Math.PI / 2, 0, 0],
    );

    for (const side of [-1, 1]) {
      add(
        new THREE.BoxGeometry(0.08, 0.92, 0.08),
        navy,
        [side * 0.72, -0.41, 0.12],
        [0, 0, side * 0.38],
      );
      add(
        new THREE.CylinderGeometry(0.23, 0.23, 0.15, 12),
        rubber,
        [side * 1.02, -0.79, 0.13],
        [0, 0, Math.PI / 2],
      );
      add(
        new THREE.CylinderGeometry(0.08, 0.08, 0.17, 10),
        orange,
        [side * 1.02, -0.79, 0.13],
        [0, 0, Math.PI / 2],
      );
    }

    add(new THREE.SphereGeometry(0.105, 10, 7), redLight, [-3.25, 0.01, -0.03]);
    add(
      new THREE.SphereGeometry(0.105, 10, 7),
      greenLight,
      [3.25, 0.01, -0.03],
    );

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
    let axis =
      (this.keys.has("a") || this.keys.has("arrowleft") ? -1 : 0) +
      (this.keys.has("d") || this.keys.has("arrowright") ? 1 : 0);
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad) continue;
      const candidate =
        Math.abs(pad.axes[2] ?? 0) > 0.1
          ? (pad.axes[2] ?? 0)
          : (pad.axes[0] ?? 0);
      if (Math.abs(candidate) > 0.12) axis = candidate;
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
    this.plane.getObjectByName("propeller")!.rotation.z +=
      delta * (30 + this.frame.throttle * 45);
    this.pulse = Math.max(0, this.pulse - delta * 3.5);
    this.plane.scale.setScalar(1 + this.pulse * 0.08);
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
        const result = applyRingResult(this.score, this.lives, passed);
        this.score = result.score;
        this.lives = result.lives;
        if (passed) {
          this.dispatchEvent(
            event("score", {
              score: this.score,
              lives: this.lives,
              kind: "pass",
            }),
          );
          ring.mesh.scale.setScalar(1.22);
        } else {
          this.dispatchEvent(
            event("score", {
              score: this.score,
              lives: this.lives,
              kind: "miss",
            }),
          );
          if (result.gameOver) {
            this.running = false;
            this.dispatchEvent(event("gameover", this.snapshot()));
          }
        }
        if (ring.mesh.position.z > 24) {
          this.scene.remove(ring.mesh);
          this.rings.splice(this.rings.indexOf(ring), 1);
        }
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
    this.plane.getObjectByName("propeller")!.rotation.z += delta * 18;
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
    this.lives = 3;
    this.spawnClock = 0;
    this.horizontal = 0;
    this.horizontalVelocity = 0;
    this.dragBankVelocity = 0;
    this.plane.position.set(0, 2.4, 0);
    this.plane.rotation.set(0, 0, 0);
    this.start();
    this.dispatchEvent(event("score", { score: 0, lives: 3, kind: "restart" }));
  }
  setControls(frame: FlightFrame) {
    this.frame = { ...frame };
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
      lives: this.lives,
      immersive: this.renderer.xr.isPresenting,
    };
  }
  async immersiveSupported() {
    return Boolean(
      navigator.xr && (await navigator.xr.isSessionSupported("immersive-vr")),
    );
  }
  async enterImmersive() {
    if (!navigator.xr)
      throw new Error("WebXR is not available in this browser.");
    const session = await navigator.xr.requestSession("immersive-vr", {
      optionalFeatures: ["local-floor", "bounded-floor"],
    });
    session.addEventListener(
      "end",
      () => this.dispatchEvent(event("xrchange", this.snapshot())),
      { once: true },
    );
    await this.renderer.xr.setSession(session);
    this.dispatchEvent(event("xrchange", this.snapshot()));
  }
  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
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
