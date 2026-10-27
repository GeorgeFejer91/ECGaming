import { test, expect, type Page } from "@playwright/test";

async function open(page: Page) {
  await page.goto("./games/systole/");
  const dialog = page.locator(".tower-name-dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator("input").fill("Quiet navigator");
  await dialog.getByRole("button", { name: "Transmit callsign" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#ground-aircraft-preview")).toHaveAttribute("data-aircraft", "systole-quiet");
}

test("standalone spacecraft preserves controls, explicit practice and loss hold", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await open(page);
  await expect(page).toHaveTitle(/Systole/);
  await expect(page.locator("#start-flight-from-ground")).toBeDisabled();
  await expect(page.locator("[data-aircraft-choice]")).toHaveCount(2);
  await expect(page.locator("#raw-ecg-preview")).toBeVisible();
  await page.getByRole("button", { name: "Signal settings", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Signal and navigation settings" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Signal settings", exact: true })).toBeFocused();
  await page.screenshot({ path: info.outputPath("systole-observatory.png"), fullPage: true });
  await page.locator("#practice-heart").click();
  await expect(page.locator("#start-flight-from-ground")).toBeEnabled();
  await page.locator("#start-flight-from-ground").click();
  await expect(page.locator("#cockpit-runway-panel")).toBeHidden();
  await expect(page.locator("#cockpit-pause-panel")).toBeHidden();
  await expect(page.locator("[data-rr-status]")).toContainText("Simulated RR");
  await page.screenshot({ path: info.outputPath("systole-navigation.png") });
  for (const viewport of [{width:844,height:390},{width:390,height:700}]) {
    await page.setViewportSize(viewport);
    const bounds = await page.locator("#cockpit-game-canvas").boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
    for (const direction of ["left","right"]) {
      const steering = page.locator(`#cockpit-steer-${direction}`);
      if (await steering.isVisible()) {
        const box = await steering.boundingBox();
        expect(box!.y+box!.height).toBeLessThanOrEqual(viewport.height+1);
      }
    }
  }
  await page.setViewportSize({width:1280,height:720});
  await page.locator("#ground-view-toggle").click();
  await page.locator("#practice-heart").click();
  await expect(page.locator("#start-flight-from-ground")).toBeDisabled();
  await page.locator("#cockpit-view-toggle").click();
  await expect(page.locator("#cockpit-pause-panel")).toBeVisible();
  expect(errors).toEqual([]);
});

test("impact releases anatomical vessels and restart clears the debris", async ({ page }, info) => {
  await page.route("**/__systole-test", route => route.fulfill({ contentType: "text/html", body: '<html data-game-theme="systole"><body style="margin:0"><main style="position:relative;height:100vh"><div id="game" style="height:100%"></div></main></body></html>' }));
  await page.goto("./__systole-test");
  const result = await page.evaluate(async () => {
    const { HeartbeatFlightGame } = await import("/src/game/flight-scene.ts");
    const g = new HeartbeatFlightGame(document.getElementById("game")!);
    await g.setAircraft("systole-quiet");
    g.renderer.setAnimationLoop(null);
    g.setControls({ sequence: 1, beatCounter: 1, altitude: 0, throttle: .5, traffic: .5, beatAgeMs: 0, quality: 1, flags: 7 });
    g.restart();
    const game = g as any;
    const hazard = game.spaceWorld.collisionBodies[0].mesh;
    hazard.position.copy(g.plane.position);
    game.update(.016);
    game.spaceWorld.updateDebris(.6);
    g.renderer.render(g.scene,g.camera);
    (window as any).spaceTest = g;
    const debris = game.spaceWorld.root.getObjectByName("Vascular debris");
    return { snapshot:g.snapshot(), fragments:debris.children.filter((c:any) => c.visible).length, anatomical:debris.children.every((c:any) => c.userData.sourceElement && c.userData.structureId), propellers:game.propellers.length };
  });
  expect(result.snapshot).toMatchObject({ crashed:true, aircraftId:"systole-quiet", mountainCollisions:true });
  expect(result.fragments).toBe(58); expect(result.anatomical).toBe(true); expect(result.propellers).toBe(0);
  await page.screenshot({ path:info.outputPath("systole-vascular-rupture.png") });
  const restarted = await page.evaluate(() => {
    const g=(window as any).spaceTest; g.restart();
    const result={crashed:g.snapshot().crashed, score:g.snapshot().score, fragments:g.spaceWorld.root.getObjectByName("Vascular debris").children.filter((c:any)=>c.visible).length};
    g.dispose(); return result;
  });
  expect(restarted).toEqual({crashed:false,score:0,fragments:0});
});

test("failed spacecraft asset cannot grant launch clearance and can be retried", async ({ page }) => {
  let blocked=true;
  await page.route("**/assets/systole/anatomy-heart.glb", route => blocked ? route.abort() : route.continue());
  await page.goto("./games/systole/");
  const dialog=page.locator(".tower-name-dialog"); await dialog.locator("input").fill("Asset recovery");
  await dialog.getByRole("button",{name:"Transmit callsign"}).click();
  await expect(page.locator("#ground-aircraft-status")).toContainText("UNAVAILABLE");
  await page.locator("#practice-heart").click();
  await expect(page.locator("#start-flight-from-ground")).toBeDisabled();
  blocked=false;
  await page.locator('[data-aircraft-choice="systole-ember"]').click();
  await expect(page.locator("#ground-aircraft-preview")).toHaveAttribute("data-aircraft","systole-ember");
  await expect(page.locator("#start-flight-from-ground")).toBeEnabled();
});

test("ship and controls reflow at narrow widths without losing features", async ({ page }, info) => {
  await open(page);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    for (const selector of ["#connect-polar", "#practice-heart", "#start-flight-from-ground", ".music-quick-controls"]) {
      await expect(page.locator(selector)).toBeVisible();
    }
    const control = await page.locator("#practice-heart").boundingBox();
    expect(control!.height).toBeGreaterThanOrEqual(44);
    if (width === 320) {
      await page.getByRole("button", { name: "Signal settings", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "Signal and navigation settings" });
      await expect.poll(() => settings.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await page.keyboard.press("Escape");
    }
    if (width === 390) await page.screenshot({ path: info.outputPath("systole-phone.png"), fullPage: true });
  }
  await page.locator('[data-aircraft-choice="systole-ember"]').click();
  await expect(page.locator("#ground-aircraft-preview")).toHaveAttribute("data-aircraft", "systole-ember");
  await page.setViewportSize({width:640,height:450}); // 1280×900 at 200% browser zoom.
  await page.addStyleTag({content:'body.systole p, body.systole button span { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; }'});
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
  await page.goto("./ground-control/");
  await expect(page.locator('[data-aircraft-choice="cardiac-ventricle"]')).toBeAttached();
  await expect(page.locator('[data-aircraft-choice^="systole-"]')).toHaveCount(0);
});
