import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const structures = ["right-atrium", "left-atrium", "ventricular-wall", "right-ventricle", "left-ventricle", "ascending-aorta", "aortic-arch", "pulmonary-trunk", "superior-vena-cava", "left-coronary", "right-coronary"];

/** Small original pigment study shared by stone, brass, and anatomical metal. */
export function createPatinaTexture(): THREE.Texture {
  if (typeof document === "undefined" || typeof CanvasRenderingContext2D === "undefined") {
    const texture = new THREE.DataTexture(new Uint8Array([160, 155, 133, 255]), 1, 1);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const noise = (seed: number) => { const x = Math.sin(seed * 127.1 + 51.7) * 43758.5453; return x - Math.floor(x); };
  context.fillStyle = "#384443";
  context.fillRect(0, 0, 256, 256);
  const pigments = ["#161f24", "#263535", "#64746a", "#a18b58", "#465350", "#7c7458"];
  for (let index = 0; index < 1150; index++) {
    const x = noise(index + 3) * 256, y = noise(index + 91) * 256;
    const size = 1 + noise(index + 43) ** 3 * 29;
    context.globalAlpha = .18 + noise(index + 31) * .5;
    context.fillStyle = pigments[index % pigments.length];
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + size, y - size * .17);
    context.lineTo(x + size * .68, y + size * .35);
    context.lineTo(x - size * .3, y + size * .7);
    context.closePath();
    context.fill();
  }
  for (let index = 0; index < 2400; index++) {
    context.globalAlpha = .06 + noise(index + 711) * .22;
    context.fillStyle = index % 3 ? "#d5bd87" : "#071113";
    context.fillRect(noise(index + 301) * 256, noise(index + 591) * 256, .5 + noise(index + 343) * 2, .4 + noise(index + 443) * 3);
  }
  context.globalAlpha = .22;
  context.strokeStyle = "#b9a471";
  context.lineWidth = .5;
  for (let index = 0; index < 18; index++) {
    const x = noise(index + 401) * 256, y = noise(index + 591) * 256;
    context.beginPath(); context.moveTo(x, y); context.lineTo(x + 3, y + 9); context.lineTo(x + 1, y + 22); context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** A real anatomical heart carried by a pair of induction rails, facing -Z. */
export async function loadSpacecraft(id: string, url: string): Promise<{ root: THREE.Group; propellers: THREE.Group[] }> {
  if (id !== "systole-quiet" && id !== "systole-ember") throw new Error(`Unknown spacecraft: ${id}`);
  const loaded = await new GLTFLoader().loadAsync(url);
  if (structures.some(name => !loaded.scene.getObjectByName(name))) {
    const materials = new Set<THREE.Material>();
    loaded.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    materials.forEach(material => material.dispose());
    throw new Error("The anatomical heart asset is incomplete.");
  }
  const ember = id === "systole-ember";
  const root = new THREE.Group();
  root.name = id;
  root.userData.anatomySource = "DBCLS BodyParts3D";
  const patina = createPatinaTexture();
  patina.repeat.set(2, 2);
  const bone = new THREE.MeshStandardMaterial({ color: ember ? "#ba8954" : "#c2b185", map: patina, bumpMap: patina, bumpScale: .018, roughness: .72, metalness: .48 });
  const armor = new THREE.MeshStandardMaterial({ color: ember ? "#947269" : "#71958d", map: patina, bumpMap: patina, bumpScale: .025, roughness: .78, metalness: .44 });
  const dark = new THREE.MeshStandardMaterial({ color: "#101e27", roughness: .57, metalness: .72 });
  const light = new THREE.MeshStandardMaterial({ color: ember ? "#edbf71" : "#8ed8d1", emissive: ember ? "#d89339" : "#47c9c7", emissiveIntensity: .65, roughness: .44, metalness: .25 });
  light.name = "CardiacPulse induction";

  const core = new THREE.Group();
  core.name = "VentricleCore";
  const oldMaterials = new Set<THREE.Material>();
  const anatomicalMaterials = new Map<string, THREE.MeshStandardMaterial>();
  loaded.scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) oldMaterials.add(material);
    const structure = object.userData.structureId ?? object.parent?.name ?? object.name;
    const vessel = /aorta|aortic|coronary/.test(structure);
    const venous = /vena|pulmonary/.test(structure);
    const key = vessel ? "artery" : venous ? "vein" : "heart";
    let material = anatomicalMaterials.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        color: vessel ? "#c3a56b" : venous ? "#718d83" : ember ? "#b38665" : "#c1ad7f",
        map: patina, bumpMap: patina, bumpScale: .025,
        roughness: .7, metalness: .48,
        emissive: vessel ? "#3e2514" : venous ? "#142b29" : "#391820",
        emissiveIntensity: .2,
      });
      material.name = `CardiacPulse anatomical ${key}`;
      anatomicalMaterials.set(key, material);
    }
    // The scanned mesh has no photographic UVs. This cylindrical pigment
    // projection adds only a surface finish; source positions stay unchanged.
    if (!object.geometry.getAttribute("uv")) {
      const positions = object.geometry.getAttribute("position");
      const uv = new Float32Array(positions.count * 2);
      for (let index = 0; index < positions.count; index++) {
        uv[index * 2] = Math.atan2(positions.getZ(index), positions.getX(index)) / (Math.PI * 2) + .5;
        uv[index * 2 + 1] = (positions.getY(index) + 1.43) / 2.86;
      }
      object.geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    }
    object.material = material;
    object.castShadow = object.receiveShadow = true;
  });
  for (const material of oldMaterials) material.dispose();
  loaded.scene.scale.setScalar(.63);
  loaded.scene.rotation.set(.26, .46, -.2);
  core.add(loaded.scene);
  core.position.set(0, .14, .06);
  root.add(core);

  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number], rotation: [number, number, number] = [0, 0, 0]) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };

  // The asymmetric keel and open mantle leave the source anatomy readable.
  add(new THREE.BoxGeometry(.42, .19, 2.7), armor, [0, -.8, .03]);
  add(new THREE.BoxGeometry(.14, .05, 2.82), bone, [0, -.92, .03]);
  for (const side of [-1, 1]) {
    const name = side < 0 ? "Left" : "Right";
    const rail = add(new THREE.CapsuleGeometry(.17, 1.8, 4, 10), armor, [side * .83, -.45, .15], [Math.PI / 2, 0, 0]);
    rail.name = `${name} induction rail`;
    add(new THREE.BoxGeometry(.1, .12, 2.12), bone, [side * .84, -.25, .12]);
    for (const z of [-.8, .78]) {
      add(new THREE.BoxGeometry(.4, .09, .16), bone, [side * .68, -.58, z], [0, 0, side * .42]);
      const ring = add(new THREE.TorusGeometry(.225, .038, 5, 20), light, [side * .83, -.45, z]);
      ring.name = `${name} induction coil`;
    }
    const exhaust = add(new THREE.CircleGeometry(.125, 16), light, [side * .83, -.45, 1.245]);
    exhaust.name = `Exhaust_aperture_${name.toLowerCase()}`;
    add(new THREE.TorusGeometry(.155, .05, 6, 16), dark, [side * .83, -.45, 1.24]);

    // Narrow longitudinal instruments, not lateral aerodynamic surfaces.
    // Retain the shared ECG projection's capillary_wing / _membrane contract.
    const sensor = new THREE.Group();
    sensor.name = `${name}_capillary_wing_sensor`;
    sensor.position.set(0, .22, .05);
    const x0 = side * .88, x1 = side * 1.34;
    const positions = new Float32Array([
      x0, 0, -1.12, x0, 0, 1.22, x1, 0, -1.12,
      x1, 0, -1.12, x0, 0, 1.22, x1, 0, 1.22,
    ]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
    const membraneMaterial = armor.clone();
    membraneMaterial.side = THREE.DoubleSide;
    const membrane = new THREE.Mesh(geometry, membraneMaterial);
    membrane.name = `${name}_sensor_membrane`;
    sensor.add(membrane);
    for (const x of [x0, x1]) {
      const edge = new THREE.Mesh(new THREE.BoxGeometry(.035, .045, 2.42), bone);
      edge.position.set(x, -.02, .05);
      sensor.add(edge);
    }
    root.add(sensor);
  }
  const crown = add(new THREE.TorusGeometry(1.08, .045, 6, 48, Math.PI * 1.54), bone, [0, .02, -.49], [0, .21, -.84]);
  crown.scale.y = .82;
  const induction = add(new THREE.TorusGeometry(1.025, .018, 5, 48, Math.PI * 1.51), light, [0, .02, -.47], [0, .21, -.84]);
  induction.scale.y = .82;

  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  if (!Number.isFinite(size.length()) || !size.x || !size.y) throw new Error("The spacecraft has no measurable anatomy.");
  root.scale.setScalar(Math.min(3 / size.x, 2.3 / size.y));
  root.updateMatrixWorld(true);
  root.position.sub(new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3()));
  root.updateMatrixWorld(true);
  return { root, propellers: [] };
}
