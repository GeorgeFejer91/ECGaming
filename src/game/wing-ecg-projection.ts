import * as THREE from "three";
import { WingEcgSignal, type WingEcgFrame } from "../signals/wing-ecg-signal";

type Binding = {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
};

/** One shared, bounded live texture projected along the loft of both wings. */
export class WingEcgProjection {
  readonly signal = new WingEcgSignal();
  private readonly canvas = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly bindings: Binding[] = [];
  private readonly visible = { value: 0 };
  private enabled = true;
  private lastDrawAt = -Infinity;

  constructor() {
    this.canvas.width = 512;
    this.canvas.height = 128;
    this.context = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.flipY = false;
  }

  bind(root: THREE.Object3D) {
    this.unbind();
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh) || !object.name.endsWith("_membrane") ||
          !object.parent?.name.includes("capillary_wing") ||
          !(object.material instanceof THREE.MeshStandardMaterial)) return;
      const mesh = object as Binding["mesh"];
      this.bindings.push({ mesh, geometry: mesh.geometry, material: mesh.material });
      mesh.geometry = mesh.geometry.clone();
      mesh.material = mesh.material.clone();
      mesh.material.name = "Wing ECG projection";
      const positions = mesh.geometry.getAttribute("position");
      // Each loft section has a constant span coordinate. Measuring the actual
      // section makes the trace conform to both swept designs without a decal
      // plane, extra draw calls, or a texture that slides when the wing flexes.
      const sections = new Map<number, { front: number; back: number }>();
      let minSpan = Infinity, maxSpan = -Infinity;
      for (let i=0; i<positions.count; i++) {
        const span = Math.abs(positions.getX(i));
        minSpan = Math.min(minSpan, span); maxSpan = Math.max(maxSpan, span);
        const key = Math.round(span*10000), depth = positions.getZ(i);
        const section = sections.get(key) ?? { front: Infinity, back: -Infinity };
        section.front = Math.min(section.front, depth);
        section.back = Math.max(section.back, depth);
        sections.set(key, section);
      }
      const uv = new Float32Array(positions.count*2);
      for (let i=0; i<positions.count; i++) {
        const span = Math.abs(positions.getX(i));
        const section = sections.get(Math.round(span*10000))!;
        uv[i*2] = (span-minSpan)/(maxSpan-minSpan);
        uv[i*2+1] = section.back-section.front > .0001
          ? (positions.getZ(i)-section.front)/(section.back-section.front) : .5;
      }
      mesh.geometry.setAttribute("wingEcgUv", new THREE.BufferAttribute(uv, 2));
      mesh.material.onBeforeCompile = shader => {
        shader.uniforms.wingEcgMap = { value: this.texture };
        shader.uniforms.wingEcgVisible = this.visible;
        shader.vertexShader = "attribute vec2 wingEcgUv; varying vec2 vWingEcgUv; varying float vWingTop;\n" + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>",
          "#include <begin_vertex>\nvWingEcgUv = wingEcgUv; vWingTop = normal.y;");
        shader.fragmentShader = "uniform sampler2D wingEcgMap; uniform float wingEcgVisible; varying vec2 vWingEcgUv; varying float vWingTop;\n" + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
          #include <map_fragment>
          vec4 wingTrace = texture2D(wingEcgMap, vWingEcgUv);
          float wingInk = wingTrace.a * wingEcgVisible * smoothstep(0.0, 0.35, vWingTop);
          diffuseColor.rgb = mix(diffuseColor.rgb, wingTrace.rgb, wingInk);
        `);
        shader.fragmentShader = shader.fragmentShader.replace("#include <emissivemap_fragment>",
          "#include <emissivemap_fragment>\ntotalEmissiveRadiance += wingTrace.rgb * wingInk * 0.8;");
      };
      mesh.material.customProgramCacheKey = () => "cardiac-wing-ecg-v1";
    });
    this.lastDrawAt = -Infinity;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.accept(null);
  }

  accept(frame: WingEcgFrame | null, now = performance.now()) {
    if (!frame) { this.signal.clear(); this.visible.value = 0; return; }
    if (this.enabled) this.signal.accept(frame, now);
  }

  update(now = performance.now()) {
    const snapshot = this.signal.snapshot(now);
    const state = !this.enabled ? "off" : !this.bindings.length ? "unsupported" : snapshot.state;
    this.visible.value = state === "live" || state === "simulated" ? 1 : 0;
    if (!this.visible.value || now-this.lastDrawAt < 1000/30) return state;
    this.lastDrawAt = now;
    const ctx = this.context, width = this.canvas.width, height = this.canvas.height;
    ctx.clearRect(0, 0, width, height);
    // Leave the leading/trailing vessels and rounded tips readable.
    ctx.save(); ctx.beginPath(); ctx.rect(24, 10, width-48, height-20); ctx.clip();
    // A dark projected strip separates the trace from the ivory tissue and
    // the red/blue vessel network, including at small phone/gameplay sizes.
    ctx.fillStyle = "rgba(4,17,30,0.92)";
    ctx.fillRect(24,10,width-48,height-20);
    ctx.strokeStyle = "rgba(100,205,225,0.18)"; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x=32; x<width-32; x+=28) { ctx.moveTo(x,17); ctx.lineTo(x,height-17); }
    for (let y=24; y<height-17; y+=20) { ctx.moveTo(32,y); ctx.lineTo(width-32,y); }
    ctx.stroke(); ctx.beginPath();
    const values = snapshot.values;
    values.forEach((value, index) => {
      const time = snapshot.rightEdge01-(values.length-1-index)*snapshot.sampleStep01;
      const x = 32+time*(width-64);
      const normalized = Math.max(-1, Math.min(1, (value-snapshot.center)/snapshot.halfRange));
      const y = height*.5-normalized*height*.36;
      if (!index) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(35,215,255,0.35)"; ctx.lineWidth = 13; ctx.stroke();
    ctx.strokeStyle = "#52ddff"; ctx.lineWidth = 8; ctx.stroke();
    ctx.strokeStyle = "#efffff"; ctx.lineWidth = 4.5; ctx.stroke();
    ctx.restore();
    this.texture.needsUpdate = true;
    return state;
  }

  unbind() {
    for (const { mesh, geometry, material } of this.bindings) {
      mesh.geometry.dispose(); mesh.material.dispose();
      mesh.geometry = geometry; mesh.material = material;
    }
    this.bindings.length = 0;
  }

  dispose() { this.unbind(); this.signal.clear(); this.texture.dispose(); }
}
