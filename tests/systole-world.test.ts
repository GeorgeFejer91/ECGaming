import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { SpaceWorld, createSpaceGate } from "../src/systole/space-world";
import { loadSpacecraft } from "../src/systole/spacecraft";

const asset = (name: string) => `data:model/gltf-binary;base64,${readFileSync(resolve("public/assets/systole", name)).toString("base64")}`;
const hazards = (world: SpaceWorld) => {
  const meshes: THREE.Mesh[] = [];
  world.root.traverse(object => {
    if (object instanceof THREE.Mesh && object.userData.systoleHazard) meshes.push(object);
  });
  return meshes;
};

describe("Systole space", () => {
  it("keeps the center route clear while visible outer-lane asteroids remain collidable", () => {
    const world = new SpaceWorld(new THREE.Scene());
    const center = new THREE.Vector3(0, 3, 0);
    expect(hazards(world).length).toBeGreaterThan(0);
    for (let frame = 0; frame < 400; frame++) {
      world.update(.1, 30);
      expect(world.collides(center, center, 3)).toBe(false);
    }
    const hazard = hazards(world)[0];
    world.root.updateMatrixWorld(true);
    const target = hazard.localToWorld(hazard.geometry.boundingSphere!.center.clone());
    expect(world.collides(target, target, 0)).toBe(true);
    hazard.visible = false;
    expect(world.collides(target, target, 0)).toBe(false);
    world.dispose();
  });

  it("detects a swept impact even when both frame endpoints miss the asteroid", () => {
    const world = new SpaceWorld(new THREE.Scene());
    const hazard = hazards(world)[0];
    const target = hazard.localToWorld(hazard.geometry.boundingSphere!.center.clone());
    const player = target.clone().add(new THREE.Vector3(0, 0, -12));
    expect(world.collides(player, player, 0)).toBe(false);
    expect(world.collides(player, player, 24)).toBe(true);
    world.dispose();
  });

  it("still reports an impact when a long frame also recycles the obstacle", () => {
    const world = new SpaceWorld(new THREE.Scene());
    const hazard = hazards(world)[0];
    const target = hazard.localToWorld(hazard.geometry.boundingSphere!.center.clone());
    const player = new THREE.Vector3(target.x, target.y, 0);
    world.update(1, 100);
    expect(world.collides(player, player, 100)).toBe(true);
    world.dispose();
  });

  it("resets the moving field without moving the astronomical backdrop", () => {
    const scene = new THREE.Scene();
    const world = new SpaceWorld(scene);
    const initial = hazards(world).map(mesh => mesh.position.clone());
    const eclipse = world.root.getObjectByName("Distant eclipse")!;
    const eclipsePosition = eclipse.position.clone();
    world.update(.1, 30);
    expect(hazards(world)[0].position.z).toBeCloseTo(initial[0].z + 3);
    expect(eclipse.position.equals(eclipsePosition)).toBe(true);
    world.reset();
    expect(hazards(world).every((mesh, index) => mesh.position.equals(initial[index]))).toBe(true);
    world.dispose();
    expect(scene.children.includes(world.root)).toBe(false);
  });

  it("leaves the gate's scoring aperture free of solid geometry", () => {
    const gate = createSpaceGate();
    gate.updateMatrixWorld(true);
    gate.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const positions = object.geometry.getAttribute("position");
      for (let index = 0; index < positions.count; index++) {
        const point = object.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, index));
        expect(Math.hypot(point.x, point.y)).toBeGreaterThan(1.92);
      }
    });
  });

  it("loads real vascular segments for bounded debris and clears them on restart", async () => {
    const world = new SpaceWorld(new THREE.Scene(), asset("anatomy-vessels.glb"));
    await world.ready();
    world.explode(new THREE.Vector3(0, 3, 0));
    const debris = world.root.getObjectByName("Vascular debris")!;
    expect(debris.children.length).toBe(58);
    expect(debris.children.every(child => child.visible && child.userData.sourceElement)).toBe(true);
    const firstPosition = debris.children[0].position.clone();
    world.updateDebris(.1);
    expect(debris.children[0].position.equals(firstPosition)).toBe(false);
    world.clearDebris();
    expect(debris.children.every(child => !child.visible)).toBe(true);
    world.dispose();
  });

  it("rejects missing anatomy instead of substituting invented tissue", async () => {
    const world = new SpaceWorld(new THREE.Scene());
    await expect(world.ready()).rejects.toThrow(/vascular/i);
    world.explode(new THREE.Vector3());
    expect(world.root.getObjectByName("Vascular debris")!.children).toHaveLength(0);
    world.dispose();
  });

  it("retries a failed vascular load on the next explicit request and shares concurrent retries", async () => {
    const nativeFetch = globalThis.fetch;
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Temporary asset outage")).mockImplementation(nativeFetch);
    const world = new SpaceWorld(new THREE.Scene(), asset("anatomy-vessels.glb"));
    try {
      await expect(world.ready()).rejects.toThrow("Temporary asset outage");
      await Promise.all([world.ready(), world.ready()]);
      world.explode(new THREE.Vector3());
      expect(world.root.getObjectByName("Vascular debris")!.children).toHaveLength(58);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      world.dispose();
      fetch.mockRestore();
    }
  });
});

describe("Systole spacecraft", () => {
  it("fits both exposed anatomical chassis and keeps ECG sensor surfaces projectable", async () => {
    for (const id of ["systole-quiet", "systole-ember"]) {
      const visual = await loadSpacecraft(id, asset("anatomy-heart.glb"));
      expect(visual.propellers).toHaveLength(0);
      const size = new THREE.Box3().setFromObject(visual.root).getSize(new THREE.Vector3());
      expect(size.x).toBeLessThanOrEqual(3.00001);
      expect(size.y).toBeLessThanOrEqual(2.30001);
      expect(visual.root.getObjectByName("VentricleCore")).toBeDefined();
      expect(visual.root.getObjectByName("left-ventricle")).toBeDefined();
      const sensors: THREE.Mesh[] = [];
      visual.root.traverse(object => {
        if (object instanceof THREE.Mesh && object.name.endsWith("_membrane") && object.parent?.name.includes("capillary_wing")) sensors.push(object);
      });
      expect(sensors).toHaveLength(2);
      for (const sensor of sensors) {
        expect(sensor.material).toBeInstanceOf(THREE.MeshStandardMaterial);
        const geometry = sensor.geometry;
        geometry.computeBoundingBox();
        const extent = geometry.boundingBox!.getSize(new THREE.Vector3());
        expect(extent.x).toBeGreaterThan(.2);
        expect(extent.z).toBeGreaterThan(.2);
        const normals = geometry.getAttribute("normal");
        expect(Array.from({ length: normals.count }, (_, index) => normals.getY(index)).every(y => y > .9)).toBe(true);
      }
    }
  });
});
