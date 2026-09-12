import { expect, test, type Page } from "@playwright/test";

async function flightHarness(page: Page) {
  await page.route("**/__flight-test", route => route.fulfill({
    contentType: "text/html",
    body: '<html><body style="margin:0;font-family:sans-serif"><main style="position:relative;width:100vw;height:100vh"><div id="flight" style="width:100%;height:100%"></div></main></body></html>',
  }));
  await page.goto("./__flight-test");
  await page.evaluate(async () => {
    // Test-only scene access; no test controls or simulated clearance in production.
    const { HeartbeatFlightGame } = await import("/src/game/flight-scene.ts");
    const game = new HeartbeatFlightGame(document.getElementById("flight")!);
    await game.setAircraft("cardiac-ventricle");
    game.renderer.setAnimationLoop(null);
    game.setControls({ sequence: 1, beatCounter: 1, altitude: 0, throttle: .5, traffic: .5, beatAgeMs: 0, quality: 1, flags: 7 });
    game.restart();
    (window as any).flight = game;
  });
}

test("Blender aircraft contract, RR contraction and one smoke puff per beat", async ({ page }) => {
  await flightHarness(page);
  const result = await page.evaluate(() => {
    const g = (window as any).flight;
    let beats = 0;
    g.addEventListener("heartbeat", () => beats++);
    const signal = { sessionId: "test-rr", counter: 4, rrMs: 750, ageMs: 10, ready: true };
    g.setHeartbeatSignal(signal);
    g.setHeartbeatSignal({ ...signal, counter: 5 });
    const altitude = g.plane.position.y;
    g.update(.016);
    g.update(.08);
    const contracted = g.aircraftPulseRoot.scale.x < 1;
    const wing = g.pulseParts.find((p: any) => p.object.name.includes("capillary_wing"));
    const flexed = Boolean(wing && Math.abs(wing.object.rotation.z-wing.roll) > .005);
    const lit = g.pulseMaterials.some((m: any) => m.emissiveIntensity > .5);
    const puffs = g.effects.particles.filter((p: any) => p.sprite.visible).length;
    for (let i=0;i<60;i++) { g.setHeartbeatSignal({ ...signal, counter: 5 }); g.update(.016); }
    g.renderer.render(g.scene, g.camera);
    return { aircraft: g.snapshot().aircraftId, propellerAxis: g.propellers[0].userData.ecgamingRotationAxis,
      contracted, flexed, lit, puffs, beats, resting: g.aircraftPulseRoot.scale.x === 1,
      // Height approaches the constant command, rather than receiving a heartbeat kick.
      altitudeDelta: g.plane.position.y-altitude };
  });
  expect(result.aircraft).toBe("cardiac-ventricle");
  expect(result.propellerAxis).toBe("z");
  expect(result).toMatchObject({ contracted: true, flexed: true, lit: true, puffs: 3, beats: 1, resting: true });
  expect(result.altitudeDelta).toBeLessThan(.76);
});

test("keyboard, drag, wider steering and blur release share gentle movement", async ({ page }) => {
  await flightHarness(page);
  await page.keyboard.down("d");
  const start = await page.evaluate(() => {
    const g = (window as any).flight;
    g.update(.05);
    return g.plane.position.x;
  });
  expect(start).toBeGreaterThan(0);
  expect(start).toBeLessThan(.04);
  await page.keyboard.up("d");
  await page.mouse.move(200, 350);
  await page.mouse.down();
  await page.mouse.move(400, 350);
  await page.evaluate(() => {
    const g = (window as any).flight;
    for (let i=0;i<150;i++) g.update(.016);
  });
  await page.mouse.up();
  const travel = await page.evaluate(() => {
    const g = (window as any).flight;
    const x = g.plane.position.x, roll = g.plane.rotation.z, yaw = g.plane.rotation.y;
    window.dispatchEvent(new Event("blur"));
    g.update(.05);
    return { x, roll, yaw, after: g.plane.position.x };
  });
  expect(travel.x).toBeGreaterThan(8);
  expect(travel.roll).toBeGreaterThan(-.25);
  expect(travel.roll).toBeLessThan(-.1);
  expect(travel.yaw).toBeLessThan(0);
  expect(travel.after).toBeCloseTo(travel.x);
});

test("both cardiac aircraft keep their red and blue vessels attached while wings flex", async ({ page }) => {
  await flightHarness(page);
  for (const id of ["cardiac-ventricle", "cardiac-aorta"]) {
    const result = await page.evaluate(async id => {
      const g = (window as any).flight;
      await g.setAircraft(id);
      const wings = g.pulseParts.filter((p: any) => p.object.name.includes("capillary_wing"));
      const assemblies = wings.map((p: any) => ({
        membrane: p.object.children.some((c: any) => c.name.endsWith("_membrane")),
        artery: p.object.children.some((c: any) => c.name.endsWith("_arterial_network")),
        vein: p.object.children.some((c: any) => c.name.endsWith("_venous_network")),
      }));
      g.heartbeat();
      g.update(.08);
      g.plane.updateMatrixWorld(true);
      g.renderer.render(g.scene, g.camera);
      return { assemblies, flexed: wings.every((p: any) => Math.abs(p.object.rotation.z-p.roll) > .005),
        colors: g.pulseMaterials.map((m: any) => m.name) };
    }, id);
    expect(result.assemblies).toEqual(Array(2).fill({ membrane: true, artery: true, vein: true }));
    expect(result.flexed).toBe(true);
    expect(result.colors.some((name: string) => name.startsWith("CardiacPulse_Arteries") || name.startsWith("CardiacPulse Arteries"))).toBe(true);
    expect(result.colors.some((name: string) => name.startsWith("CardiacPulse_Veins") || name.startsWith("CardiacPulse Veins"))).toBe(true);
  }
});

test("rapid heartbeats leave compact separated puffs that expire without continuous emission", async ({ page }) => {
  await flightHarness(page);
  const result = await page.evaluate(() => {
    const g = (window as any).flight;
    const fx = g.effects;
    fx.clear();
    const origin = g.plane.position.clone();
    const direction = origin.clone().set(-1, 0, 0);
    fx.heartbeat(origin, direction);
    const first = fx.particles.filter((p: any) => p.sprite.visible);
    for (let i=0;i<35;i++) fx.update(.01, 1.4);
    const beforeNext = fx.particles.filter((p: any) => p.sprite.visible).length;
    fx.heartbeat(origin, direction);
    const second = fx.particles.filter((p: any) => p.sprite.visible && !first.includes(p));
    const separation = Math.min(...second.map((p: any) => p.sprite.position.x))
      - Math.max(...first.map((p: any) => p.sprite.position.x + p.sprite.scale.x));
    // Moving the emitter must not pull previously emitted smoke along with it.
    const leftBehind = first.every((p: any) => p.sprite.parent === g.scene && p.sprite.position.x < origin.x-.6);
    for (let i=0;i<100;i++) fx.update(.01, 1.4);
    const largest = Math.max(...fx.particles.filter((p: any) => p.sprite.visible).map((p: any) => p.sprite.scale.x));
    for (let i=0;i<50;i++) fx.update(.01, 1.4);
    return { beforeNext, second: second.length, separation, leftBehind, largest,
      remaining: fx.particles.filter((p: any) => p.sprite.visible).length };
  });
  expect(result).toMatchObject({ beforeNext: 3, second: 3, leftBehind: true, remaining: 0 });
  expect(result.separation).toBeGreaterThan(.35);
  expect(result.largest).toBeLessThan(.25);
});

test("optional mountain impact ends the flight, freezes on signal loss and restarts cleanly", async ({ page }) => {
  await flightHarness(page);
  const result = await page.evaluate(() => {
    const g = (window as any).flight;
    const mountain = g.worldActors.find((a: any) => a.peaks);
    const peak = mountain.peaks[1];
    // Place a visible peak directly in the flight path to exercise the real update path.
    mountain.object.position.set(-peak.x, -peak.y, -.11);
    g.setMountainCollisions(false);
    g.update(.016);
    const safe = !g.snapshot().crashed;
    g.setMountainCollisions(true);
    g.update(.016);
    const crashed = g.snapshot().crashed;
    g.setPaused(true);
    g.animate(performance.now()+50);
    return { safe, crashed, visible: g.plane.visible, particles: g.effects.particles.filter((p: any) => p.sprite.visible).length, restartDisabled: g.crashRestart.disabled };
  });
  expect(result).toMatchObject({ safe: true, crashed: true, visible: false, particles: 48, restartDisabled: true });
  await expect(page.getByText("Mountain impact", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const g = (window as any).flight;
    g.setPaused(false); g.crashAge = 1.3; g.animate(performance.now()+50);
  });
  await page.getByRole("button", { name: "Fly again" }).click();
  const reset = await page.evaluate(() => {
    const g = (window as any).flight;
    return { ...g.snapshot(), visible: g.plane.visible, x: g.plane.position.x, particles: g.effects.particles.filter((p: any) => p.sprite.visible).length };
  });
  expect(reset).toMatchObject({ crashed: false, score: 0, visible: true, x: 0, particles: 0 });
});

test("cardiac scene preview and mobile options fit", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await flightHarness(page);
  await page.evaluate(() => {
    const g = (window as any).flight;
    g.setSteering(.4);
    for (let i=0;i<55;i++) g.update(.016);
    g.heartbeat();
    for (let i=0;i<8;i++) g.update(.016);
    g.renderer.render(g.scene, g.camera);
  });
  await page.screenshot({ path: ".cache/cardiac-flight/gameplay.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText("Flight options", { exact: true }).click();
  const bounds = await page.locator(".flight-game-options").boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: ".cache/cardiac-flight/mobile.png" });
});
