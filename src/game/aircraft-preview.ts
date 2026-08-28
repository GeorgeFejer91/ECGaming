import * as THREE from "three";
import {
  DEFAULT_AIRCRAFT_ID,
  disposeAircraftVisual,
  loadAircraftVisual,
  type AircraftId,
  type AircraftVisual,
} from "./aircraft";

/** Lightweight hangar renderer used only by the Ground Control carousel. */
export class AircraftPreview {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  private readonly turntable = new THREE.Group();
  private renderer?: THREE.WebGLRenderer;
  private visual?: AircraftVisual;
  private resizeObserver?: ResizeObserver;
  private frameId?: number;
  private active = true;
  private request = 0;
  private lastTime = performance.now();
  private readonly reduceMotion = matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  constructor(private readonly host: HTMLElement) {
    this.host.classList.add("aircraft-preview-host");
    if (!this.webGlAvailable()) {
      this.host.classList.add("is-unavailable");
      return;
    }
    try {
      this.renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.15;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
      this.renderer.domElement.setAttribute("aria-hidden", "true");
      this.renderer.domElement.tabIndex = -1;
      this.host.prepend(this.renderer.domElement);
      this.buildScene();
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.host);
      this.resize();
      this.schedule();
    } catch (error) {
      this.host.classList.add("is-unavailable");
      console.warn("Aircraft preview unavailable", error);
    }
  }

  private webGlAvailable() {
    const canvas = document.createElement("canvas");
    const context =
      canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true }) ??
      canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true });
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  }

  private buildScene() {
    this.camera.position.set(5.6, 2.7, -7.4);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(this.turntable);

    const hemisphere = new THREE.HemisphereLight("#dffcff", "#07131f", 2.2);
    this.scene.add(hemisphere);
    const key = new THREE.DirectionalLight("#fff3c0", 5.2);
    key.position.set(-3.5, 6, -4);
    key.castShadow = true;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight("#69d4de", 3.4);
    rim.position.set(5, 2.5, 4);
    this.scene.add(rim);

    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(2.35, 2.48, 0.08, 64),
      new THREE.MeshStandardMaterial({
        color: "#081b27",
        emissive: "#0e3647",
        emissiveIntensity: 0.5,
        metalness: 0.25,
        roughness: 0.62,
        transparent: true,
        opacity: 0.92,
      }),
    );
    platform.position.y = -1.38;
    platform.receiveShadow = true;
    this.scene.add(platform);

    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(2.28, 0.025, 8, 96),
      new THREE.MeshBasicMaterial({
        color: "#f4b33a",
        transparent: true,
        opacity: 0.9,
      }),
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = -1.32;
    this.scene.add(halo);
  }

  private resize() {
    if (!this.renderer) return;
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  async setAircraft(id: AircraftId): Promise<AircraftId> {
    const request = ++this.request;
    if (!this.renderer) return id;
    let visual: AircraftVisual;
    try {
      visual = await loadAircraftVisual(id);
    } catch (error) {
      console.warn(`Preview could not load ${id}; using project aircraft.`, error);
      visual = await loadAircraftVisual(DEFAULT_AIRCRAFT_ID);
    }
    if (request !== this.request) {
      disposeAircraftVisual(visual.root);
      return visual.id;
    }
    if (this.visual) {
      this.turntable.remove(this.visual.root);
      disposeAircraftVisual(this.visual.root);
    }
    this.visual = visual;
    this.turntable.rotation.set(0, -0.55, 0);
    this.turntable.add(visual.root);
    this.host.classList.remove("is-loading");
    this.host.dataset.aircraft = visual.id;
    return visual.id;
  }

  private schedule() {
    if (!this.renderer || !this.active || this.frameId !== undefined) return;
    this.lastTime = performance.now();
    this.frameId = requestAnimationFrame(this.render);
  }

  private render = (time: number) => {
    this.frameId = undefined;
    if (!this.renderer || !this.active) return;
    if (time - this.lastTime < 32) {
      this.frameId = requestAnimationFrame(this.render);
      return;
    }
    const delta = Math.min(50, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    if (!this.reduceMotion) {
      this.turntable.rotation.y += delta * 0.00042;
      this.turntable.position.y = Math.sin(time * 0.0014) * 0.07;
      for (const propeller of this.visual?.propellers ?? [])
        propeller.rotation.z -= delta * 0.024;
    }
    this.renderer.render(this.scene, this.camera);
    this.frameId = requestAnimationFrame(this.render);
  };

  setActive(active: boolean) {
    this.active = active;
    if (!active && this.frameId !== undefined) {
      cancelAnimationFrame(this.frameId);
      this.frameId = undefined;
    }
    if (active) {
      this.resize();
      this.schedule();
    }
  }

  dispose() {
    this.setActive(false);
    this.resizeObserver?.disconnect();
    if (this.visual) disposeAircraftVisual(this.visual.root);
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}
