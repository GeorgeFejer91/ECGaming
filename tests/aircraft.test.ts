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
} from "../src/game/aircraft";

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
});
