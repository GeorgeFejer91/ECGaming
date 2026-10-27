import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createPatinaTexture } from "./spacecraft";

type Drifter = { mesh: THREE.Mesh; initial: THREE.Vector3; spin: number; wrapOffset: number };
type Fragment = { mesh: THREE.Mesh; origin: THREE.Vector3; velocity: THREE.Vector3; spin: THREE.Vector3 };

const random = (seed: number) => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

const release = (object: THREE.Object3D) => {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.Points) && !(child instanceof THREE.Line)) return;
    geometries.add(child.geometry);
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) materials.add(material);
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  });
  textures.forEach(texture => texture.dispose());
};

/** The opening is compatible with the shared 1.92-unit scoring aperture. */
export function createSpaceGate(): THREE.Group {
  const group = new THREE.Group();
  group.name = "Induction threshold";
  const shell = new THREE.MeshStandardMaterial({ color: "#9e8670", metalness: .66, roughness: .7 });
  const ink = new THREE.MeshStandardMaterial({ color: "#192c35", metalness: .65, roughness: .58 });
  const light = new THREE.MeshStandardMaterial({ color: "#a4ded4", emissive: "#67cfc5", emissiveIntensity: 1.7, roughness: .4 });
  for (let index = 0; index < 3; index++) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(2.25, .16, 7, 24, Math.PI * .57), shell);
    arc.rotation.z = index * Math.PI * 2 / 3;
    group.add(arc);
    const trace = new THREE.Mesh(new THREE.TorusGeometry(2.24, .025, 5, 24, Math.PI * .53), light);
    trace.position.z = .163;
    trace.rotation.z = arc.rotation.z + .045;
    group.add(trace);
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(.3, .32, .52), ink);
    const angle = arc.rotation.z + .05;
    bracket.position.set(Math.cos(angle) * 2.26, Math.sin(angle) * 2.26, 0);
    bracket.rotation.z = angle;
    group.add(bracket);
  }
  return group;
}

/** Bounded scenery, outer-lane collision bodies, and authentic vascular debris. */
export class SpaceWorld {
  readonly root = new THREE.Group();
  private readonly drifters: Drifter[] = [];
  private readonly collisionBodies: Drifter[] = [];
  private readonly debris = new THREE.Group();
  private readonly fragments: Fragment[] = [];
  private assets: Promise<void>;
  private readonly patina = createPatinaTexture();
  private assetError?: Error;
  private disposed = false;
  private debrisAge = Infinity;
  private readonly sphere = new THREE.Sphere();
  private readonly segment = new THREE.Line3();
  private readonly nearest = new THREE.Vector3();

  constructor(scene: THREE.Scene, private readonly vesselsAssetUrl?: string, private readonly reducedMotion = false) {
    this.root.name = "Systole space";
    this.debris.name = "Vascular debris";
    this.root.add(this.debris);
    scene.add(this.root);
    this.patina.repeat.set(1, 3);
    this.buildNebula();
    this.buildStars();
    this.buildEclipse();
    this.buildDerelicts();
    this.buildAsteroids();
    this.assets = this.beginAssetLoad();
  }

  private beginAssetLoad(): Promise<void> {
    this.assetError = undefined;
    this.root.userData.vascularAssetStatus = this.vesselsAssetUrl ? "loading" : "unavailable";
    return this.vesselsAssetUrl ? this.loadVessels(this.vesselsAssetUrl).catch(error => {
      this.assetError = error instanceof Error ? error : new Error("Vascular anatomy could not be loaded.");
      this.root.userData.vascularAssetStatus = "unavailable";
    }) : Promise.resolve();
  }

  async ready(): Promise<void> {
    if (this.disposed) throw new Error("The vascular anatomy asset is unavailable.");
    // Only a new explicit request retries a completed failure. Concurrent
    // callers share the same promise; no render loop or timer starts a retry.
    if (this.assetError) this.assets = this.beginAssetLoad();
    await this.assets;
    if (this.assetError) throw this.assetError;
    if (this.disposed || !this.fragments.length) throw new Error("The vascular anatomy asset is unavailable.");
  }

  private buildNebula() {
    const material = new THREE.ShaderMaterial({
      vertexShader: "varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: `varying vec2 vUv;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
        float brush(vec2 p){return noise(p)*.54+noise(p*2.13)*.27+noise(p*4.31)*.13+noise(p*8.7)*.06;}
        void main(){
          vec2 p=(vUv-.5)*vec2(3.2,2.0);
          float stroke=brush(p*3.3+vec2(brush(p*2.0),brush(p*2.0+8.0)));
          float band=exp(-pow(p.y+p.x*.36+(stroke-.5)*.9,2.0)*5.0);
          float dust=smoothstep(.34,.77,stroke)*band;
          vec3 pigment=mix(vec3(.025,.055,.058),vec3(.12,.105,.071),smoothstep(.53,.72,stroke));
          float edge=smoothstep(0.0,.16,vUv.x)*smoothstep(0.0,.16,1.0-vUv.x)*smoothstep(0.0,.16,vUv.y)*smoothstep(0.0,.16,1.0-vUv.y);
          gl_FragColor=vec4(pigment,dust*.53*edge);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, fog: false,
    });
    const veil = new THREE.Mesh(new THREE.PlaneGeometry(790, 480), material);
    veil.name = "Distant interstellar pigment";
    veil.position.set(0, 12, -390);
    veil.renderOrder = -20;
    this.root.add(veil);
  }

  private buildStars() {
    for (let layer = 0; layer < 2; layer++) {
      const count = layer ? 90 : 540;
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const palette = [new THREE.Color("#bdd7cb"), new THREE.Color("#c79772"), new THREE.Color("#66748e")];
      for (let index = 0; index < count; index++) {
        positions[index * 3] = (random(index + layer * 911) - .5) * 600;
        positions[index * 3 + 1] = (random(index + 92 + layer * 511) - .5) * 370;
        positions[index * 3 + 2] = -100 - random(index + 172) * 270;
        palette[index % palette.length].toArray(colors, index * 3);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const stars = new THREE.Points(geometry, new THREE.PointsMaterial({ vertexColors: true, size: layer ? .65 : .32, sizeAttenuation: true, transparent: true, opacity: layer ? .9 : .62, depthWrite: false, fog: false }));
      stars.name = layer ? "Distant beacons" : "Fixed stars";
      this.root.add(stars);
    }
  }

  private buildEclipse() {
    const eclipse = new THREE.Group();
    eclipse.name = "Distant eclipse";
    eclipse.position.set(-53, 37, -282);
    const surface = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: "varying vec3 vLocal; void main(){ vLocal = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `varying vec3 vLocal;
        float grain(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}
        void main(){
          vec3 p=normalize(vLocal);
          float brush=grain(floor(p*16.0))*.6+grain(floor(p*69.0))*.4;
          float light=pow(max(0.0,dot(p,normalize(vec3(-.8,.45,-.35)))),5.0);
          vec3 ink=mix(vec3(.003,.008,.012),vec3(.015,.032,.034),brush*.34);
          ink+=vec3(.17,.14,.08)*light;
          gl_FragColor=vec4(ink,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      fog: false,
    });
    eclipse.add(new THREE.Mesh(new THREE.SphereGeometry(38, 48, 24), surface));
    const corona = new THREE.Mesh(new THREE.TorusGeometry(38.55, .16, 6, 128), new THREE.MeshBasicMaterial({ color: "#b6a477", fog: false, transparent: true, opacity: .6 }));
    corona.position.z = -1;
    eclipse.add(corona);
    const outer = new THREE.Mesh(new THREE.TorusGeometry(39.25, .09, 5, 128, Math.PI * 1.6), new THREE.MeshBasicMaterial({ color: "#584840", fog: false, transparent: true, opacity: .8 }));
    outer.rotation.z = -.5;
    eclipse.add(outer);
    this.root.add(eclipse);
  }

  private addDrifter(mesh: THREE.Mesh, spin = 0, hazard = false) {
    mesh.geometry.computeBoundingSphere();
    this.root.add(mesh);
    const actor = { mesh, initial: mesh.position.clone(), spin, wrapOffset: 0 };
    this.drifters.push(actor);
    if (hazard) {
      mesh.userData.systoleHazard = true;
      this.collisionBodies.push(actor);
    }
  }

  private buildDerelicts() {
    const slate = new THREE.MeshStandardMaterial({ color: "#c0c1b5", map: this.patina, bumpMap: this.patina, bumpScale: .15, roughness: .89, metalness: .24, flatShading: true });
    const oxide = new THREE.MeshStandardMaterial({ color: "#baa28b", map: this.patina, bumpMap: this.patina, bumpScale: .13, roughness: .88, metalness: .3, flatShading: true });
    // Merge each fractured open frame into one draw call. Its missing corners
    // are deliberate silhouettes; there are no invisible collision walls.
    const pieces = [
      new THREE.BoxGeometry(2.4, 36, 4).translate(-10, 0, 0),
      new THREE.BoxGeometry(2.4, 23, 4).translate(10, -6.5, 0),
      new THREE.BoxGeometry(20, 2.4, 4).translate(0, -17, 0),
      new THREE.BoxGeometry(11, 2.4, 4).translate(-4.5, 17, 0),
      new THREE.BoxGeometry(4.8, 1, 4.5).rotateZ(.35).translate(7, 10, 0),
    ];
    const geometry = mergeGeometries(pieces)!;
    pieces.forEach(piece => piece.dispose());
    const lineGeometry = new THREE.BoxGeometry(.14, 25, .15);
    const inlay = new THREE.MeshStandardMaterial({ color: "#729a8e", emissive: "#4d8178", emissiveIntensity: .7, roughness: .8 });
    for (let index = 0; index < 8; index++) {
      const side = index % 2 ? -1 : 1;
      const frame = new THREE.Mesh(geometry, index % 3 ? slate : oxide);
      frame.name = "Broken orbital reliquary";
      frame.position.set(side * (31 + random(index + 32) * 16), 7 + random(index + 201) * 14, -60 - index * 40);
      frame.rotation.set(random(index + 42) * .5, side * .36, side * (.16 + random(index + 61) * .35));
      const glyph = new THREE.Mesh(lineGeometry, inlay);
      glyph.position.set(-8.72, -1, 2.1);
      frame.add(glyph);
      this.addDrifter(frame);
    }
  }

  private buildAsteroids() {
    const stone = new THREE.MeshStandardMaterial({ color: "#9bada5", map: this.patina, bumpMap: this.patina, bumpScale: .16, roughness: .96, metalness: .12, flatShading: true });
    const oxide = new THREE.MeshStandardMaterial({ color: "#b49b7d", map: this.patina, bumpMap: this.patina, bumpScale: .14, roughness: .91, metalness: .2, flatShading: true });
    const geometries = [0, 1, 2].map(seed => {
      const geometry = new THREE.IcosahedronGeometry(1, 1);
      const positions = geometry.getAttribute("position");
      for (let index = 0; index < positions.count; index++) {
        const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
        const radius = .8 + random(Math.round((x * 37 + y * 73 + z * 137 + seed * 19) * 100)) * .32;
        positions.setXYZ(index, x * radius, y * radius, z * radius);
      }
      geometry.computeVertexNormals();
      return geometry;
    });
    for (let index = 0; index < 18; index++) {
      const mesh = new THREE.Mesh(geometries[index % geometries.length], index % 4 ? stone : oxide);
      mesh.name = `Charcoal asteroid ${index + 1}`;
      const side = index % 2 ? -1 : 1;
      mesh.position.set(side * (8.5 + random(index + 52) * 4), .6 + random(index + 43) * 5.7, -32 - index * 19);
      mesh.scale.set(1.4 + random(index + 13) * .9, 1.2 + random(index + 82) * 1.5, 1.5 + random(index + 93));
      mesh.rotation.set(random(index + 23) * 3, random(index + 25) * 3, random(index + 3));
      this.addDrifter(mesh, (random(index + 62) - .5) * .12, true);
    }
    const slabGeometry = new THREE.BoxGeometry(1.2, 3.6, 1.4);
    const seamGeometry = new THREE.BoxGeometry(.055, 2.6, .025);
    const seamMaterial = new THREE.MeshStandardMaterial({ color: "#b1b395", emissive: "#749b86", emissiveIntensity: .8, roughness: .7 });
    for (let index = 0; index < 4; index++) {
      const slab = new THREE.Mesh(slabGeometry, index % 2 ? stone : oxide);
      slab.name = "Near-field monolith fragment";
      slab.position.set((index % 2 ? -1 : 1) * (9.3 + index * .7), 2.5 + index * .4, -77 - index * 76);
      slab.rotation.set(.12, .18, (index % 2 ? -1 : 1) * .27);
      const seam = new THREE.Mesh(seamGeometry, seamMaterial);
      seam.position.set(-.31, .2, .715);
      slab.add(seam);
      this.addDrifter(slab, 0, true);
    }
  }

  update(dt: number, speed: number): void {
    const travel = Math.max(0, dt) * Math.max(0, speed);
    for (const actor of this.drifters) {
      actor.wrapOffset = 0;
      actor.mesh.position.z += travel;
      if (!this.reducedMotion) actor.mesh.rotation.y += actor.spin * Math.max(0, dt);
      if (actor.mesh.position.z > 36) {
        const beforeWrap = actor.mesh.position.z;
        actor.mesh.position.z = -360 + (actor.mesh.position.z - 36) % 396;
        actor.wrapOffset = beforeWrap - actor.mesh.position.z;
      }
    }
    this.root.updateMatrixWorld(true);
  }

  /** Call after update(); travel is this frame's forward scenery displacement. */
  collides(previous: THREE.Vector3, current: THREE.Vector3, travel: number): boolean {
    if (!this.root.visible) return false;
    this.root.updateMatrixWorld(true);
    this.segment.start.copy(previous);
    this.segment.start.z += Math.max(0, travel);
    this.segment.end.copy(current);
    for (const { mesh, wrapOffset } of this.collisionBodies) {
      if (!mesh.visible) continue;
      this.sphere.copy(mesh.geometry.boundingSphere!).applyMatrix4(mesh.matrixWorld);
      // Test the continuous trajectory before its render-only wrap to the horizon.
      this.sphere.center.z += wrapOffset;
      this.segment.closestPointToPoint(this.sphere.center, true, this.nearest);
      // A compact spherical hull is intentionally more forgiving than its rails.
      if (this.nearest.distanceToSquared(this.sphere.center) <= (this.sphere.radius + .72) ** 2) return true;
    }
    return false;
  }

  reset(): void {
    for (const actor of this.drifters) { actor.mesh.position.copy(actor.initial); actor.wrapOffset = 0; }
    this.clearDebris();
    this.root.updateMatrixWorld(true);
  }

  private async loadVessels(url: string): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url);
    if (this.disposed) { release(gltf.scene); return; }
    gltf.scene.updateMatrixWorld(true);
    const sources: THREE.Mesh[] = [];
    gltf.scene.traverse(object => { if (object instanceof THREE.Mesh) sources.push(object); });
    if (!sources.length || sources.length > 64 || sources.some(source => !source.userData.sourceElement || !source.userData.structureId)) {
      release(gltf.scene);
      throw new Error("The vascular anatomy asset has no verified source segments.");
    }
    const artery = new THREE.MeshStandardMaterial({ color: "#b15c59", roughness: .62, metalness: .12, emissive: "#662832", emissiveIntensity: .35, side: THREE.DoubleSide });
    const vein = new THREE.MeshStandardMaterial({ color: "#477683", roughness: .65, metalness: .1, emissive: "#214452", emissiveIntensity: .35, side: THREE.DoubleSide });
    for (const source of sources) {
      const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
      geometry.computeBoundingBox();
      const center = geometry.boundingBox!.getCenter(new THREE.Vector3());
      geometry.translate(-center.x, -center.y, -center.z);
      const mesh = new THREE.Mesh(geometry, /vena|pulmonary/.test(source.userData.structureId) ? vein : artery);
      mesh.name = source.name;
      mesh.userData = { ...source.userData };
      mesh.visible = false;
      mesh.scale.setScalar(.72);
      this.debris.add(mesh);
      this.fragments.push({ mesh, origin: center.multiplyScalar(.72), velocity: new THREE.Vector3(), spin: new THREE.Vector3() });
    }
    release(gltf.scene);
    this.root.userData.vascularAssetStatus = "ready";
  }

  explode(position: THREE.Vector3): void {
    this.debrisAge = 0;
    this.fragments.forEach((fragment, index) => {
      fragment.mesh.position.copy(position).add(fragment.origin);
      fragment.mesh.rotation.set(0, 0, 0);
      fragment.mesh.visible = true;
      const motion = this.reducedMotion ? .25 : 1;
      fragment.velocity.set((random(index + 71) - .5) * 6, (random(index + 102) - .4) * 4.2, (random(index + 41) - .35) * 5).multiplyScalar(motion);
      fragment.spin.set(random(index + 112) - .5, random(index + 113) - .5, random(index + 114) - .5).multiplyScalar(motion * 2);
    });
  }

  updateDebris(dt: number): void {
    if (!Number.isFinite(this.debrisAge)) return;
    this.debrisAge += Math.max(0, dt);
    if (this.debrisAge > 7) { this.clearDebris(); return; }
    for (const fragment of this.fragments) {
      fragment.mesh.position.addScaledVector(fragment.velocity, dt);
      fragment.mesh.rotation.x += fragment.spin.x * dt;
      fragment.mesh.rotation.y += fragment.spin.y * dt;
      fragment.mesh.rotation.z += fragment.spin.z * dt;
    }
  }

  clearDebris(): void {
    this.debrisAge = Infinity;
    for (const fragment of this.fragments) fragment.mesh.visible = false;
  }

  dispose(): void {
    this.disposed = true;
    this.root.removeFromParent();
    release(this.root);
    this.fragments.length = this.drifters.length = this.collisionBodies.length = 0;
  }
}
