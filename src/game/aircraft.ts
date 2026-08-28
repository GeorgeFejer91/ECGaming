import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export const AIRCRAFT_MAX_WIDTH = 3.2;
export const AIRCRAFT_MAX_HEIGHT = 2.5;

export interface AircraftDefinition {
  id: string;
  label: string;
  assetPath: string | null;
  sourceUrl: string;
  license: "Project" | "CC0-1.0" | "CC-BY-3.0" | "CC-BY-4.0";
  /** Applied before centering and fit normalization. */
  rotation: readonly [number, number, number];
}

export const AIRCRAFT_CATALOG = [
  {
    id: "ecgaming-classic",
    label: "ECGaming Classic",
    assetPath: null,
    sourceUrl: "https://github.com/GeorgeFejer91/ECGaming",
    license: "Project",
    rotation: [0, 0, 0],
  },
  {
    id: "og-cartoon-plane",
    label: "Cartoon Scout",
    assetPath: "/assets/aircraft/og-cartoon-plane.glb",
    sourceUrl: "https://opengameart.org/content/low-poly-cartoon-plane",
    license: "CC0-1.0",
    rotation: [0, 0, 0],
  },
  {
    id: "og-biplane",
    label: "Fire Biplane",
    assetPath: "/assets/aircraft/og-biplane.glb",
    sourceUrl: "https://opengameart.org/content/low-poly-biplane",
    license: "CC0-1.0",
    rotation: [0, -Math.PI / 2, 0],
  },
  {
    id: "styloo-plancestylized",
    label: "Tiny Plane · Classic",
    assetPath: "/assets/aircraft/styloo-plancestylized.glb",
    sourceUrl: "https://styloo.itch.io/plane",
    license: "CC0-1.0",
    rotation: [0, -Math.PI / 2, 0],
  },
  {
    id: "styloo-plancestylized-001",
    label: "Tiny Plane · Classic II",
    assetPath: "/assets/aircraft/styloo-plancestylized-001.glb",
    sourceUrl: "https://styloo.itch.io/plane",
    license: "CC0-1.0",
    rotation: [0, -Math.PI / 2, 0],
  },
  {
    id: "styloo-planeanimal",
    label: "Tiny Plane · Animal",
    assetPath: "/assets/aircraft/styloo-planeanimal.glb",
    sourceUrl: "https://styloo.itch.io/plane",
    license: "CC0-1.0",
    rotation: [0, -Math.PI / 2, 0],
  },
  {
    id: "styloo-planeanimal-001",
    label: "Tiny Plane · Animal II",
    assetPath: "/assets/aircraft/styloo-planeanimal-001.glb",
    sourceUrl: "https://styloo.itch.io/plane",
    license: "CC0-1.0",
    rotation: [0, -Math.PI / 2, 0],
  },
  {
    id: "styloo-planeazer",
    label: "Tiny Plane · Azer",
    assetPath: "/assets/aircraft/styloo-planeazer.glb",
    sourceUrl: "https://styloo.itch.io/plane",
    license: "CC0-1.0",
    rotation: [0, -Math.PI / 2, 0],
  },
  {
    id: "styloo-planeazer-001",
    label: "Tiny Plane · Azer II",
    assetPath: "/assets/aircraft/styloo-planeazer-001.glb",
    sourceUrl: "https://styloo.itch.io/plane",
    license: "CC0-1.0",
    rotation: [0, -Math.PI / 2, 0],
  },
  {
    id: "styloo-planeazer-002",
    label: "Tiny Plane · Azer III",
    assetPath: "/assets/aircraft/styloo-planeazer-002.glb",
    sourceUrl: "https://styloo.itch.io/plane",
    license: "CC0-1.0",
    rotation: [0, -Math.PI / 2, 0],
  },
  {
    id: "styloo-planehelice",
    label: "Tiny Plane · Propeller",
    assetPath: "/assets/aircraft/styloo-planehelice.glb",
    sourceUrl: "https://styloo.itch.io/plane",
    license: "CC0-1.0",
    rotation: [0, -Math.PI / 2, 0],
  },
  {
    id: "styloo-planehelice-001",
    label: "Tiny Plane · Propeller II",
    assetPath: "/assets/aircraft/styloo-planehelice-001.glb",
    sourceUrl: "https://styloo.itch.io/plane",
    license: "CC0-1.0",
    rotation: [0, -Math.PI / 2, 0],
  },
  {
    id: "styloo-planehuge",
    label: "Tiny Plane · Heavy",
    assetPath: "/assets/aircraft/styloo-planehuge.glb",
    sourceUrl: "https://styloo.itch.io/plane",
    license: "CC0-1.0",
    rotation: [0, -Math.PI / 2, 0],
  },
  {
    id: "styloo-planesty",
    label: "Tiny Plane · Sty",
    assetPath: "/assets/aircraft/styloo-planesty.glb",
    sourceUrl: "https://styloo.itch.io/plane",
    license: "CC0-1.0",
    rotation: [0, -Math.PI / 2, 0],
  },
  {
    id: "styloo-planesty-001",
    label: "Tiny Plane · Sty II",
    assetPath: "/assets/aircraft/styloo-planesty-001.glb",
    sourceUrl: "https://styloo.itch.io/plane",
    license: "CC0-1.0",
    rotation: [0, -Math.PI / 2, 0],
  },
  {
    id: "styloo-planesty-002",
    label: "Tiny Plane · Sty III",
    assetPath: "/assets/aircraft/styloo-planesty-002.glb",
    sourceUrl: "https://styloo.itch.io/plane",
    license: "CC0-1.0",
    rotation: [0, -Math.PI / 2, 0],
  },
  {
    id: "styloo-planesty-003",
    label: "Tiny Plane · Sty IV",
    assetPath: "/assets/aircraft/styloo-planesty-003.glb",
    sourceUrl: "https://styloo.itch.io/plane",
    license: "CC0-1.0",
    rotation: [0, -Math.PI / 2, 0],
  },
  {
    id: "styloo-planestylized-001",
    label: "Tiny Plane · Stylized",
    assetPath: "/assets/aircraft/styloo-planestylized-001.glb",
    sourceUrl: "https://styloo.itch.io/plane",
    license: "CC0-1.0",
    rotation: [0, -Math.PI / 2, 0],
  },
  {
    id: "poly-cute-airplane",
    label: "Cute Cloudhopper",
    assetPath: "/assets/aircraft/poly-cute-airplane.glb",
    sourceUrl: "https://poly.pizza/m/3UtIosDm9u-",
    license: "CC-BY-3.0",
    rotation: [0, 0, 0],
  },
  {
    id: "poly-small-airplane",
    label: "Small Skyplane",
    assetPath: "/assets/aircraft/poly-small-airplane.glb",
    sourceUrl: "https://poly.pizza/m/7cvx6ex-xfL",
    license: "CC-BY-3.0",
    rotation: [0, 0, 0],
  },
  {
    id: "magic-low-poly-airplane",
    label: "Low-Poly Sport",
    assetPath: "/assets/aircraft/magic-low-poly-airplane.glb",
    sourceUrl: "https://magic-games.itch.io/low-poly-airplane",
    license: "CC-BY-4.0",
    rotation: [0, 0, 0],
  },
] as const satisfies readonly AircraftDefinition[];

export type AircraftId = (typeof AIRCRAFT_CATALOG)[number]["id"];
export type AircraftCatalogEntry = (typeof AIRCRAFT_CATALOG)[number];
export const DEFAULT_AIRCRAFT_ID: AircraftId = "ecgaming-classic";

export interface AircraftPersona {
  name: string;
  tagline: string;
}

/** Player-facing hangar callsigns; source/credit labels remain in the catalog. */
export const AIRCRAFT_PERSONAS = {
  "ecgaming-classic": {
    name: "Pulsefire Mk I",
    tagline: "The original heartbeat hot-rod.",
  },
  "og-cartoon-plane": {
    name: "Beatwing Scout",
    tagline: "Light wings. Loud pulse. Zero hesitation.",
  },
  "og-biplane": {
    name: "Double-Bypass",
    tagline: "Two wings and absolutely no clogged airways.",
  },
  "styloo-plancestylized": {
    name: "Sinus Sprinter",
    tagline: "Regular rhythm, irregular amounts of speed.",
  },
  "styloo-plancestylized-001": {
    name: "Tachy Turbo",
    tagline: "Fast enough to raise its own heart rate.",
  },
  "styloo-planeanimal": {
    name: "Atrial Animal",
    tagline: "Wild-hearted and ring-hungry.",
  },
  "styloo-planeanimal-001": {
    name: "Ventricle Varmint",
    tagline: "Small body. Four-chamber attitude.",
  },
  "styloo-planeazer": {
    name: "Aorta Arrow",
    tagline: "Straight out of the heart and into the sky.",
  },
  "styloo-planeazer-001": {
    name: "Systolic Streak",
    tagline: "Maximum pressure on every pass.",
  },
  "styloo-planeazer-002": {
    name: "Diastolic Dart",
    tagline: "Relax, refill, and punch it.",
  },
  "styloo-planehelice": {
    name: "Prop Palpitation",
    tagline: "Every propeller turn skips a beat.",
  },
  "styloo-planehelice-001": {
    name: "R-R Rocket",
    tagline: "Interval-tuned for perfectly timed trouble.",
  },
  "styloo-planehuge": {
    name: "Big Heart Hauler",
    tagline: "Cardiomegaly, but make it aerodynamic.",
  },
  "styloo-planesty": {
    name: "Myocardial Maverick",
    tagline: "Pure muscle from nose to tail.",
  },
  "styloo-planesty-001": {
    name: "SA Node Stinger",
    tagline: "The natural pacemaker of the flight line.",
  },
  "styloo-planesty-002": {
    name: "AV Node Ace",
    tagline: "A tiny delay, then full-throttle conduction.",
  },
  "styloo-planesty-003": {
    name: "Purkinje Pursuer",
    tagline: "Rapid delivery to every wingtip.",
  },
  "styloo-planestylized-001": {
    name: "Visceral Velocity",
    tagline: "All guts, all heart, all altitude.",
  },
  "poly-cute-airplane": {
    name: "Heartthrob Hopper",
    tagline: "Cute enough to cause a measurable response.",
  },
  "poly-small-airplane": {
    name: "Little Ventricle",
    tagline: "Compact chamber. Serious cardiac output.",
  },
  "magic-low-poly-airplane": {
    name: "Cardiac Comet",
    tagline: "A bright streak on the ECG flight path.",
  },
} as const satisfies Record<AircraftId, AircraftPersona>;

export const getAircraftPersona = (id: AircraftId): AircraftPersona =>
  AIRCRAFT_PERSONAS[id];

export interface AircraftVisual {
  id: AircraftId;
  root: THREE.Group;
  propellers: THREE.Group[];
}

export const isAircraftId = (value: string): value is AircraftId =>
  AIRCRAFT_CATALOG.some((entry) => entry.id === value);

export const getAircraftDefinition = (id: AircraftId) =>
  AIRCRAFT_CATALOG.find((entry) => entry.id === id)!;

export const aircraftAssetUrl = (id: AircraftId) => {
  const path = getAircraftDefinition(id).assetPath;
  if (!path) return null;
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
};

/** Center and uniformly fit an aircraft inside the ring's safe X/Y opening. */
export function normalizeAircraftVisual(
  root: THREE.Object3D,
  maxWidth = 3,
  maxHeight = 2.3,
) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  if (
    !Number.isFinite(size.x) ||
    !Number.isFinite(size.y) ||
    size.x <= 0 ||
    size.y <= 0
  )
    throw new Error("Aircraft model has no measurable geometry.");

  const scale = Math.min(maxWidth / size.x, maxHeight / size.y);
  root.scale.multiplyScalar(scale);
  root.updateMatrixWorld(true);

  const fitted = new THREE.Box3().setFromObject(root);
  const center = fitted.getCenter(new THREE.Vector3());
  root.position.sub(center);
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
}

const createOwnedPropeller = (noseZ: number, modelHeight: number) => {
  const propeller = new THREE.Group();
  propeller.name = "propeller";
  propeller.userData.ecgamingAnimatedPropeller = true;
  propeller.position.set(0, 0, noseZ - 0.08);
  const bladeLength = Math.min(1.65, Math.max(0.86, modelHeight * 0.72));
  const bladeMaterial = new THREE.MeshStandardMaterial({
    color: "#173b55",
    roughness: 0.65,
  });
  for (const angle of [0, Math.PI / 2]) {
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.095, bladeLength, 0.075),
      bladeMaterial,
    );
    blade.rotation.z = angle;
    blade.castShadow = true;
    propeller.add(blade);
  }
  const hub = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 10, 7),
    new THREE.MeshStandardMaterial({ color: "#e86139", roughness: 0.55 }),
  );
  hub.position.z = -0.035;
  hub.castShadow = true;
  propeller.add(hub);
  return propeller;
};

export const createProceduralAircraftVisual = (): AircraftVisual => {
  const root = new THREE.Group();
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
    root.add(mesh);
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

  add(new THREE.SphereGeometry(0.5, 16, 10), glass, [0, 0.51, -0.28]).scale.set(
    0.88,
    0.72,
    1.45,
  );
  add(new THREE.BoxGeometry(0.92, 0.07, 0.1), navy, [0, 0.58, -0.27]);

  const propeller = new THREE.Group();
  propeller.name = "propeller";
  propeller.userData.ecgamingAnimatedPropeller = true;
  propeller.position.set(0, 0.02, -3.48);
  for (const angle of [0, Math.PI / 2]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.5, 0.09), navy);
    blade.rotation.z = angle;
    blade.castShadow = true;
    propeller.add(blade);
  }
  root.add(propeller);
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
  normalizeAircraftVisual(root);
  return { id: DEFAULT_AIRCRAFT_ID, root, propellers: [propeller] };
};

const loadGltf = (url: string) => new GLTFLoader().loadAsync(url);

export async function loadAircraftVisual(
  id: AircraftId,
): Promise<AircraftVisual> {
  if (id === DEFAULT_AIRCRAFT_ID) {
    return createProceduralAircraftVisual();
  }

  const definition = getAircraftDefinition(id);
  const url = aircraftAssetUrl(id);
  if (!url) throw new Error(`Aircraft ${id} has no model asset.`);
  const gltf = await loadGltf(url);
  const root = new THREE.Group();
  root.name = `aircraft-${id}`;
  gltf.scene.rotation.set(
    definition.rotation[0],
    definition.rotation[1],
    definition.rotation[2],
  );
  root.add(gltf.scene);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });

  // Leave a little room for the project-owned propeller, then run a final fit
  // pass so even unusually tall or wide source models remain ring-safe.
  normalizeAircraftVisual(root, 3, 2.3);
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const propeller = createOwnedPropeller(bounds.min.z, size.y);
  root.add(propeller);
  normalizeAircraftVisual(root);
  return { id, root, propellers: [propeller] };
}

export function disposeAircraftVisual(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const meshMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of meshMaterials) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material))
      if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
}
