import * as THREE from "three";

interface Particle {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  growth: number;
  opacity: number;
}

/** Fixed particle pool: one clustered smoke puff per received heartbeat. */
export class FlightEffects {
  private readonly texture: THREE.CanvasTexture;
  private readonly particles: Particle[] = [];
  private next = 0;

  constructor(private readonly scene: THREE.Scene) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    gradient.addColorStop(0, "rgba(255,255,255,.95)");
    gradient.addColorStop(.42, "rgba(255,255,255,.75)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    this.texture = new THREE.CanvasTexture(canvas);
    for (let i = 0; i < 96; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.texture, transparent: true, depthWrite: false,
      }));
      sprite.visible = false;
      scene.add(sprite);
      this.particles.push({ sprite, velocity: new THREE.Vector3(), age: 0, life: 0, size: 1, growth: 1, opacity: 1 });
    }
  }

  private emit(position: THREE.Vector3, explosion: boolean, index: number) {
    const p = this.particles[this.next++ % this.particles.length];
    p.age = 0;
    p.life = explosion ? 1.1 + Math.random() * 1.5 : 2.5;
    p.size = explosion ? .35 + Math.random() * .65 : .30 + Math.random() * .15;
    p.growth = explosion ? 2.8 : .75;
    p.opacity = explosion ? .95 : .66;
    p.sprite.visible = true;
    p.sprite.position.copy(position).add(new THREE.Vector3(
      (Math.random()-.5)*.4, (Math.random()-.5)*.2, (Math.random()-.5)*.2,
    ));
    p.sprite.scale.setScalar(p.size);
    p.sprite.material.opacity = p.opacity;
    p.sprite.material.color.set(explosion
      ? ["#ffe6a4", "#f77c40", "#bc4639", "#584b50"][index % 4]
      : index % 3 ? "#fff4e6" : "#e6b4b1");
    p.velocity.set(explosion ? (Math.random()-.5)*9 : (Math.random()-.5)*.45,
      explosion ? (Math.random()-.25)*8 : .35 + Math.random()*.3,
      explosion ? (Math.random()-.5)*7 : 0);
  }

  heartbeat(position: THREE.Vector3) {
    for (let i = 0; i < 6; i++) this.emit(position, false, i);
  }
  explode(position: THREE.Vector3) {
    for (let i = 0; i < 48; i++) this.emit(position, true, i);
  }
  update(dt: number, worldSpeed: number) {
    for (const p of this.particles) {
      if (!p.sprite.visible) continue;
      p.age += dt;
      if (p.age >= p.life) { p.sprite.visible = false; continue; }
      p.sprite.position.addScaledVector(p.velocity, dt);
      p.sprite.position.z += worldSpeed * dt;
      p.sprite.scale.setScalar(p.size + p.age * p.growth);
      p.sprite.material.opacity = p.opacity * (1-p.age/p.life)**1.5;
    }
  }
  clear() { for (const p of this.particles) p.sprite.visible = false; }
  dispose() {
    for (const p of this.particles) {
      this.scene.remove(p.sprite);
      p.sprite.material.dispose();
    }
    this.texture.dispose();
  }
}
