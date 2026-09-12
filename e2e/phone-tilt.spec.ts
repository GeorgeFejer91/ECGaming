import { expect, test, type Page } from "@playwright/test";
import { installTiltSdkFixture } from "./fixtures/tilt-sdk";

async function sceneHarness(page: Page) {
  await page.route("**/__phone-flight", route => route.fulfill({ contentType: "text/html", body:
    '<html><body style="margin:0;font-family:sans-serif"><main style="position:relative;width:100vw;height:100vh"><div id="flight" style="width:100%;height:100%"></div></main></body></html>' }));
  await page.goto("./__phone-flight");
  await page.evaluate(async () => {
    const { HeartbeatFlightGame } = await import("/src/game/flight-scene.ts");
    const game = new HeartbeatFlightGame(document.getElementById("flight")!);
    game.setControls({ sequence: 1, beatCounter: 1, altitude: 0, throttle: .5, traffic: .5, beatAgeMs: 0, quality: 1, flags: 7 });
    game.restart(); game.openPhoneController();
    (window as any).phoneFlight = game;
  });
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(installTiltSdkFixture);
  await context.route("**/vendor/vdoninja/1.5.5/vdoninja-sdk.min.js", route => route.fulfill({ contentType: "text/javascript", body: "/* deterministic test transport */" }));
});

test("dedicated SVG widget opens QR pairing without Polar or flight clearance", async ({ page }) => {
  await page.goto("./ground-control/");
  const widget = page.locator("#connect-phone-controller");
  await expect(widget).toBeVisible();
  await expect(widget).toContainText("Phone steering");
  expect(await widget.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await widget.click();
  const dialog = page.getByRole("dialog", { name: "Phone tilt controller" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("canvas").first()).toBeVisible();
  const url = new URL((await dialog.getByRole("link", { name: "Open controller" }).getAttribute("href"))!);
  expect(url.pathname).toBe("/controller/"); expect(url.search).toBe("");
  expect(new URLSearchParams(url.hash.slice(1)).get("secret")).toHaveLength(32);
  await dialog.getByRole("button", { name: "Stop phone control" }).click();
  await expect(dialog.locator("canvas").first()).toBeHidden();
  await expect(dialog.locator("a").filter({ hasText: "Open controller" })).not.toHaveAttribute("href");
});

test("phone tilt authenticates, steers the target, trims speed, and releases stale sensor input", async ({ page, context }, testInfo) => {
  await sceneHarness(page);
  const dialog = page.getByRole("dialog", { name: "Phone tilt controller" });
  const anchor = dialog.getByRole("link", { name: "Open controller" });
  await expect(anchor).toBeVisible();
  const phone = await context.newPage();
  await phone.setViewportSize({ width: 844, height: 390 });
  await phone.goto((await anchor.getAttribute("href"))!);
  expect(new URL(phone.url()).hash).toBe("");
  await phone.getByRole("button", { name: "Enable tilt & connect" }).click();
  await expect(phone.locator("#connection-status")).toHaveText("Connected");
  await expect(dialog.locator("canvas").first()).toBeHidden();
  await expect(phone.getByRole("button", { name: "Centre", exact: true })).toBeEnabled();
  await phone.getByRole("button", { name: "Centre", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).phoneFlight.phoneController.read()?.active)).toBe(true);
  await phone.evaluate(() => { (window as any).orientationSample = { beta: -24, gamma: -65 }; });
  await expect.poll(() => page.evaluate(() => (window as any).phoneFlight.phoneController.read()?.x)).toBeGreaterThan(.7);
  await expect.poll(() => page.evaluate(() => (window as any).phoneFlight.phoneController.read()?.y)).toBeGreaterThan(.5);
  await expect(phone.locator("#steering-yoke")).toBeVisible();
  await expect(phone.locator(".yoke-top")).toHaveAttribute("data-pretext-fit", "ready");
  await phone.screenshot({ path: testInfo.outputPath("controller-landscape.png") });
  const moved = await page.evaluate(() => {
    const game = (window as any).phoneFlight;
    game.horizontal = 0; game.horizontalVelocity = 0;
    game.updateInput(.1); return game.horizontal;
  });
  expect(moved).toBeGreaterThan(0);
  // A missing sensor stream must not be kept alive by the controller's transport heartbeat.
  await phone.evaluate(() => { (window as any).sendOrientation = false; });
  await expect.poll(() => page.evaluate(() => (window as any).phoneFlight.phoneController.read()?.active)).toBe(false);
  await expect(phone.locator("#input-status")).toContainText("Waiting for motion readings");
  // Recentring after recovery is deliberate, then a lost phone is neutralized at the target.
  await phone.evaluate(() => { (window as any).sendOrientation = true; });
  await expect(phone.getByRole("button", { name: "Centre", exact: true })).toBeEnabled();
  await phone.getByRole("button", { name: "Centre", exact: true }).click();
  await phone.evaluate(() => { (window as any).orientationSample = { beta: 0, gamma: -40 }; });
  await expect.poll(() => page.evaluate(() => (window as any).phoneFlight.phoneController.read()?.x)).toBeLessThan(-.5);
  await phone.close();
  await expect.poll(() => page.evaluate(() => (window as any).phoneFlight.phoneController.read()?.active)).toBe(false);
  await dialog.getByRole("button", { name: "Stop phone control" }).click();
  expect(await page.evaluate(() => (window as any).phoneFlight.phoneController.read())).toBeUndefined();
});

test("touch fallback releases keys and stop revokes the QR invitation", async ({ page, context }) => {
  await sceneHarness(page);
  const dialog = page.getByRole("dialog", { name: "Phone tilt controller" });
  const anchor = dialog.getByRole("link", { name: "Open controller" });
  await expect(anchor).toBeVisible();
  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto((await anchor.getAttribute("href"))!);
  await phone.getByRole("button", { name: "Use touch instead" }).click();
  await expect(phone.locator("#connection-status")).toHaveText("Connected");
  await phone.bringToFront();
  await expect(phone.locator("#confirmed")).toContainText("Centred");
  await phone.locator("#tilt-pad").focus();
  await phone.keyboard.down("ArrowLeft");
  await expect.poll(() => page.evaluate(() => (window as any).phoneFlight.phoneController.read()?.x)).toBe(-1);
  await phone.keyboard.up("ArrowLeft");
  await expect.poll(() => page.evaluate(() => (window as any).phoneFlight.phoneController.read()?.active)).toBe(false);
  await dialog.getByRole("button", { name: "Stop phone control" }).click();
  await expect(phone.locator("#connection-status")).toContainText("connection ended");
  await expect(phone.locator("#input-mode")).toBeDisabled();
});

test("invalid links stay inert and phone layouts fit portrait and landscape", async ({ page }) => {
  await page.goto("./controller/#room=bad&secret=bad");
  await expect(page.getByRole("button", { name: "Enable tilt & connect" })).toBeDisabled();
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 667, height: 375 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("Remote cockpit pairs independently and leaves phone pairing behind its own button", async ({ page }) => {
  await page.goto("./ground-control/");
  await page.getByRole("button", { name: "Remote cockpit", exact: true }).click();
  const cockpit = page.getByRole("dialog", { name: "Remote cockpit", exact: true });
  await expect(cockpit).toBeVisible();
  const link = cockpit.getByRole("link", { name: "Open cockpit", exact: true });
  await expect(link).toBeVisible();
  const url = new URL((await link.getAttribute("href"))!);
  expect(url.pathname).toBe("/session-cockpit/");
  expect(new URLSearchParams(url.hash.slice(1)).get("secret")).toHaveLength(32);
  await expect(cockpit.getByRole("link", { name: "Open controller" })).toBeHidden();
  await expect(cockpit.getByRole("img", { name: "Scan to join the separate cockpit" })).toHaveCount(0);
  await expect(cockpit.locator('canvas[aria-label="Scan to join the separate cockpit"]')).toBeVisible();
  await cockpit.getByRole("button", { name: "Disconnect cockpit", exact: true }).click();
  await expect(link).toBeHidden();
  await cockpit.getByRole("button", { name: "Back to flight" }).click();
  await page.getByRole("button", { name: "Phone steering wheel" }).click();
  const phone = page.getByRole("dialog", { name: "Phone tilt controller" });
  await expect(phone.getByRole("link", { name: "Open controller" })).toBeVisible();
});
