import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  AIRCRAFT_CATALOG,
  AIRCRAFT_MAX_HEIGHT,
  AIRCRAFT_MAX_WIDTH,
  AIRCRAFT_PERSONAS,
  DEFAULT_AIRCRAFT_ID,
  disposeAircraftVisual,
  loadAircraftVisual,
  normalizeAircraftVisual,
  prepareSourcePropeller,
  spinAircraftPropeller,
} from "../src/game/aircraft";
import {
  AIRCRAFT_PREVIEW_RADIUS,
  fitAircraftPreviewModel,
} from "../src/game/aircraft-preview";

describe("aircraft catalog", () => {
  it("offers the project plane and every licensed source-pack aircraft", () => {
    expect(AIRCRAFT_CATALOG.map(({ id }) => id)).toEqual([
      "ecgaming-classic",
      "og-cartoon-plane",
      "og-biplane",
      "styloo-plancestylized",
      "styloo-plancestylized-001",
      "styloo-planeanimal",
      "styloo-planeanimal-001",
      "styloo-planeazer",
      "styloo-planeazer-001",
      "styloo-planeazer-002",
      "styloo-planehelice",
      "styloo-planehelice-001",
      "styloo-planehuge",
      "styloo-planesty",
      "styloo-planesty-001",
      "styloo-planesty-002",
      "styloo-planesty-003",
      "styloo-planestylized-001",
      "poly-cute-airplane",
      "poly-small-airplane",
      "magic-low-poly-airplane",
    ]);
  });

  it("ships a GLB for every downloaded catalog entry", () => {
    for (const aircraft of AIRCRAFT_CATALOG) {
      if (!aircraft.assetPath) continue;
      const file = resolve("public", aircraft.assetPath.replace(/^\//, ""));
      expect(existsSync(file), aircraft.id).toBe(true);
    }
  });

  it("gives every aircraft a unique cardiac hangar name and tagline", () => {
    const personas = AIRCRAFT_CATALOG.map(({ id }) => AIRCRAFT_PERSONAS[id]);
    expect(personas).toHaveLength(AIRCRAFT_CATALOG.length);
    expect(new Set(personas.map(({ name }) => name)).size).toBe(
      AIRCRAFT_CATALOG.length,
    );
    for (const persona of personas) {
      expect(persona.name.length).toBeGreaterThan(5);
      expect(persona.tagline.length).toBeGreaterThan(12);
    }
  });

  it("centers and uniformly fits visuals inside the safe ring opening", () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 20));
    mesh.position.set(9, -4, 13);
    root.add(mesh);
    const size = normalizeAircraftVisual(root);
    const center = new THREE.Box3()
      .setFromObject(root)
      .getCenter(new THREE.Vector3());
    expect(size.x).toBeLessThanOrEqual(AIRCRAFT_MAX_WIDTH);
    expect(size.y).toBeLessThanOrEqual(AIRCRAFT_MAX_HEIGHT);
    expect(center.length()).toBeLessThan(0.00001);
  });

  it("centers differently proportioned previews in one rotation-safe sphere", () => {
    for (const dimensions of [
      [18, 1, 2],
      [2, 9, 3],
      [3, 2, 24],
    ] as const) {
      const mount = new THREE.Group();
      const root = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dimensions));
      mesh.position.set(7, -4, 11);
      root.add(mesh);
      const fitted = fitAircraftPreviewModel(mount, root);
      expect(fitted.center.length()).toBeLessThan(0.00001);
      expect(fitted.radius).toBeCloseTo(AIRCRAFT_PREVIEW_RADIUS, 5);
      mesh.geometry.dispose();
    }
  });

  it("standardizes the airframe without letting an attached propeller move its axis", () => {
    const mount = new THREE.Group();
    const root = new THREE.Group();
    const airframe = new THREE.Mesh(new THREE.BoxGeometry(8, 2, 12));
    airframe.position.set(5, -2, 9);
    const propeller = new THREE.Group();
    propeller.position.set(5, -2, -3.2);
    propeller.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 3, 0.1)));
    root.add(airframe, propeller);

    const fitted = fitAircraftPreviewModel(
      mount,
      root,
      AIRCRAFT_PREVIEW_RADIUS,
      [propeller],
    );
    expect(fitted.center.length()).toBeLessThan(0.00001);
    expect(fitted.radius).toBeCloseTo(AIRCRAFT_PREVIEW_RADIUS, 5);
    airframe.geometry.dispose();
    (propeller.children[0] as THREE.Mesh).geometry.dispose();
  });

  it("gives the procedural fallback a visible animated propeller", async () => {
    const visual = await loadAircraftVisual(DEFAULT_AIRCRAFT_ID);
    const size = new THREE.Box3()
      .setFromObject(visual.root)
      .getSize(new THREE.Vector3());
    expect(size.x).toBeLessThanOrEqual(AIRCRAFT_MAX_WIDTH);
    expect(size.y).toBeLessThanOrEqual(AIRCRAFT_MAX_HEIGHT);
    expect(visual.propellers).toHaveLength(1);
    expect(visual.propellers[0].name).toBe("propeller");
    expect(visual.propellers[0].userData.ecgamingAnimatedPropeller).toBe(true);
    disposeAircraftVisual(visual.root);
  });

  it("removes the SA Node duplicate and animates its source propeller on X", () => {
    const scene = new THREE.Group();
    const airframe = new THREE.Group();
    const source = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 3));
    const duplicate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 3));
    airframe.name = "Cube.014";
    source.name = "Cube015";
    duplicate.name = "Cube009";
    source.position.set(-2, 0.25, 0);
    airframe.add(source);
    scene.add(airframe, duplicate);

    const pivot = prepareSourcePropeller(scene, "Cube015", ["Cube009"]);
    expect(scene.getObjectByName("Cube009")).toBeUndefined();
    expect(pivot.children).toEqual([source]);
    expect(pivot.position.toArray()).toEqual([-2, 0.25, 0]);
    spinAircraftPropeller(pivot, 0.5);
    expect(pivot.rotation.x).toBeCloseTo(0.5);
    expect(pivot.rotation.z).toBeCloseTo(0);
    source.geometry.dispose();
    duplicate.geometry.dispose();
  });
});
