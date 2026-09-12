import * as THREE from "three";
import { loadAircraftVisual, disposeAircraftVisual, spinAircraftPropeller, type AircraftId, type AircraftVisual } from "./game/aircraft";
import { cardiacEnvelope } from "./game/flight-mechanics";
import { FlightEffects } from "./game/flight-effects";
import { WingEcgProjection } from "./game/wing-ecg-projection";
import { syntheticEcgMicrovolts } from "./vendor/affect-tracker/polar-replay.js";
const host = document.querySelector<HTMLElement>("#view")!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = .95;
host.prepend(renderer.domElement);
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute("aria-label", "Cardiac aircraft. Drag or press left and right arrows to rotate.");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.add(new THREE.HemisphereLight(0xf4f6ff, 0x35303b, 1.4));
const light = new THREE.DirectionalLight(0xffffff, 3);
light.position.set(-4, 6, 5); scene.add(light);
const fill = new THREE.DirectionalLight(0xffddd0, 1.1);
fill.position.set(4, 1, -2); scene.add(fill);
const camera = new THREE.PerspectiveCamera(33, 1, .1, 60);
const plane = new THREE.Group();
const pulseRoot = new THREE.Group(); plane.add(pulseRoot); scene.add(plane);
plane.rotation.y = -.5;
const effects = new FlightEffects(scene);
const wingEcg = new WingEcgProjection();
let ecgCursor = performance.now(), simulatedBeatAt = ecgCursor;
let exhausts: THREE.Object3D[] = [];
let visual: AircraftVisual | undefined;
let request = 0, age = Infinity, last = performance.now(), next = last+800, active = true, beats = 0;
const select = document.querySelector<HTMLSelectElement>("#aircraft")!;
const rr = document.querySelector<HTMLInputElement>("#rr")!;
const excitement = document.querySelector<HTMLInputElement>("#excitement")!;
const state = document.querySelector("#state")!;
let parts: { object: THREE.Object3D; scale: THREE.Vector3; roll: number }[] = [];
let materials: THREE.MeshStandardMaterial[] = [];
async function load() {
  const token = ++request;
  select.disabled = true;
  state.textContent = "Loading the Blender model…";
  let result: AircraftVisual;
  try {
    result = await loadAircraftVisual(select.value as AircraftId);
  } catch {
    if (token === request) {
      select.disabled = false;
      state.textContent = "The aircraft could not load. Select another model or reload to retry.";
    }
    return;
  }
  if (token !== request) { disposeAircraftVisual(result.root); return; }
  wingEcg.unbind();
  if (visual) { pulseRoot.remove(visual.root); disposeAircraftVisual(visual.root); }
  visual = result; pulseRoot.add(visual.root);
  parts = []; materials = [];
  exhausts = [];
  result.root.traverse(object => {
    if (object.name.startsWith("Exhaust_aperture")) exhausts.push(object);
    if (object.name === "VentricleCore" || object.name.includes("capillary_wing")) parts.push({ object, scale: object.scale.clone(), roll: object.rotation.z });
    if (object instanceof THREE.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material])
      if (material instanceof THREE.MeshStandardMaterial && material.name.startsWith("CardiacPulse") && !materials.includes(material)) materials.push(material);
  });
  wingEcg.bind(result.root);
  select.disabled = false;
  host.dataset.aircraft = result.id;
  state.textContent = active ? "Simulated RR · waiting for next beat" : "Simulation paused";
}
select.addEventListener("change", () => void load());
rr.addEventListener("input", () => {
  document.querySelector("#rr-value")!.textContent = `${rr.value} ms / ${Math.round(60000/Number(rr.value))} BPM`;
  next = performance.now()+Number(rr.value);
});
excitement.addEventListener("input", () => document.querySelector("#excite-value")!.textContent = Number(excitement.value).toFixed(2));
document.querySelector("#toggle")!.addEventListener("click", event => {
  active = !active; next = performance.now()+Number(rr.value);
  ecgCursor = performance.now();
  if (!active) wingEcg.accept(null);
  (event.target as HTMLElement).textContent = active ? "Pause heartbeat" : "Resume heartbeat";
  state.textContent = active ? "Simulated RR resumed" : "Simulation paused";
});
let drag: number | undefined;
renderer.domElement.addEventListener("pointerdown", event => { drag = event.clientX; renderer.domElement.setPointerCapture(event.pointerId); });
renderer.domElement.addEventListener("pointermove", event => { if (drag !== undefined) { plane.rotation.y += (event.clientX-drag)*.008; drag = event.clientX; } });
for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) renderer.domElement.addEventListener(name, () => { drag = undefined; });
renderer.domElement.addEventListener("keydown", event => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  plane.rotation.y += event.key === "ArrowLeft" ? -.12 : .12;
});
const resize = () => {
  camera.aspect = host.clientWidth/host.clientHeight;
  camera.position.set(0, 2.5, camera.aspect < 1 ? 7.5 : 5.7);
  camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
  renderer.setSize(host.clientWidth, host.clientHeight);
};
const observer = new ResizeObserver(resize);
observer.observe(host); resize(); void load();
renderer.setAnimationLoop(now => {
  const dt = Math.min(.05, (now-last)/1000); last = now; age += dt;
  if (active && visual && now >= next) {
    next = now+Number(rr.value); age = 0; beats++;
    simulatedBeatAt = now;
    plane.updateMatrixWorld(true);
    for (const exhaust of exhausts) effects.heartbeat(exhaust.getWorldPosition(new THREE.Vector3()),
      new THREE.Vector3(0, 0, 1).transformDirection(plane.matrixWorld));
    state.textContent = `Simulated beat ${beats} · ${rr.value} ms RR`;
  }
  if (active) {
    if (now-ecgCursor > 500) ecgCursor = now;
    const samples: number[] = [];
    while (ecgCursor+1000/130 <= now) {
      ecgCursor += 1000/130;
      const phase = ((.405+(ecgCursor-simulatedBeatAt)/Number(rr.value))%1+1)%1;
      samples.push(syntheticEcgMicrovolts(phase, ecgCursor/1000));
    }
    if (samples.length) wingEcg.accept({ microvolts: samples,
      sensorTimestampNs: String(Math.round(ecgCursor*1e6)), sourceId: "preview-simulated-ecg", simulated: true }, now);
  }
  wingEcg.update(now);
  const pulse = cardiacEnvelope(age, Number(rr.value));
  pulseRoot.scale.set(1-pulse*.10, 1+pulse*.17, 1-pulse*.07);
  for (const part of parts) {
    if (part.object.name.includes("capillary_wing")) part.object.rotation.z = part.roll+(part.object.name.startsWith("Left") ? -1 : 1)*pulse*.1;
    else part.object.scale.copy(part.scale).multiplyScalar(1+pulse*.17);
  }
  for (const material of materials) material.emissiveIntensity = .3+pulse*2;
  plane.position.y += ((Number(excitement.value)-.5)*1.7-plane.position.y)*(1-Math.exp(-3.2*dt));
  for (const prop of visual?.propellers ?? []) spinAircraftPropeller(prop, dt*26);
  effects.update(dt, 1.4); renderer.render(scene, camera);
});
