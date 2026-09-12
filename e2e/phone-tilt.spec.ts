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

test("dedicated SVG widget opens a yoke-shaped QR popup without Polar or flight clearance", async ({ page }, testInfo) => {
  test.setTimeout(60_000); // Three viewport renders and screenshots, including software-rendered CI.
  // Three WebGL-backed viewport captures need extra time on the CI runner.
  test.setTimeout(60_000);
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
  expect(await dialog.evaluate(el => getComputedStyle(el, "::before").backgroundImage)).not.toBe("none");
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const bounds = await dialog.boundingBox(); const qr = await dialog.locator("canvas").first().boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    expect(Math.abs(qr!.x + qr!.width / 2 - bounds!.x - bounds!.width / 2)).toBeLessThan(2);
    expect(qr!.y).toBeGreaterThanOrEqual(bounds!.y);
    expect(qr!.y + qr!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height - 8);
    await page.screenshot({ path: testInfo.outputPath(`yoke-pairing-${viewport.width}.png`), mask: [dialog.locator("canvas")], maskColor: "#ffffff" });
  }
  await dialog.locator("summary").click();
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
  await expect(phone.locator("#connection-status")).toHaveText("Connected");
  expect(await phone.evaluate(() => (window as any).motionPermissionRequests)).toBe(0);
  await phone.getByRole("button", { name: "Enable tilt" }).click();
  expect(await phone.evaluate(() => (window as any).motionPermissionRequests)).toBe(1);
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
  await dialog.locator("summary").click();
  await dialog.getByRole("button", { name: "Stop phone control" }).click();
  expect(await page.evaluate(() => (window as any).phoneFlight.phoneController.read())).toBeUndefined();
});

test("opening the QR link connects without a tap, releases keys and revokes on stop", async ({ page, context }) => {
  await sceneHarness(page);
  const dialog = page.getByRole("dialog", { name: "Phone tilt controller" });
  const anchor = dialog.getByRole("link", { name: "Open controller" });
  await expect(anchor).toBeVisible();
  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto((await anchor.getAttribute("href"))!);
  await expect(phone.locator("#connection-status")).toHaveText("Connected");
  await expect(phone.locator("#steering-yoke")).toBeVisible();
  expect(await phone.evaluate(() => (window as any).motionPermissionRequests)).toBe(0);
  await phone.bringToFront();
  await expect(phone.locator("#confirmed")).toContainText("Centred");
  await phone.locator("#tilt-pad").focus();
  await phone.keyboard.down("ArrowLeft");
  await expect.poll(() => page.evaluate(() => (window as any).phoneFlight.phoneController.read()?.x)).toBe(-1);
  await phone.keyboard.up("ArrowLeft");
  await expect.poll(() => page.evaluate(() => (window as any).phoneFlight.phoneController.read()?.active)).toBe(false);
  await dialog.locator("summary").click();
  await dialog.getByRole("button", { name: "Stop phone control" }).click();
  await expect(phone.locator("#connection-status")).toContainText("connection ended");
  await expect(phone.locator("#input-mode")).toBeDisabled();
});

test("invalid links stay inert and phone layouts fit portrait and landscape", async ({ page }) => {
  await page.goto("./controller/#room=bad&secret=bad");
  await expect(page.locator("#controls")).toBeHidden();
  expect(await page.evaluate(() => (window as any).testSdkStarts)).toBe(0);
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 667, height: 375 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.goto("./session-cockpit/#room=bad&secret=bad");
  await expect(page.locator("#session-entry")).toBeVisible();
  expect(await page.evaluate(() => (window as any).testSdkStarts)).toBe(0);
});

test("denied motion access keeps the automatic connection and touch steering", async ({ page, context }) => {
  await sceneHarness(page);
  const anchor = page.getByRole("link", { name: "Open controller" }); await expect(anchor).toBeVisible();
  const phone = await context.newPage(); await phone.goto((await anchor.getAttribute("href"))!);
  await expect(phone.locator("#connection-status")).toHaveText("Connected");
  await phone.evaluate(() => { (window as any).motionPermissionResult = "denied"; });
  await phone.getByRole("button", { name: "Enable tilt" }).click();
  await expect(phone.locator("#input-status")).toContainText("Motion permission was not granted");
  await expect(phone.locator("#connection-status")).toHaveText("Connected");
  await phone.locator("#tilt-pad").focus(); await phone.keyboard.down("ArrowRight");
  await expect.poll(() => page.evaluate(() => (window as any).phoneFlight.phoneController.read()?.x)).toBe(1);
  await phone.keyboard.up("ArrowRight");
  await expect.poll(() => page.evaluate(() => (window as any).phoneFlight.phoneController.read()?.active)).toBe(false);
  await expect(phone.locator("#input-status")).toContainText("Motion permission was not granted");
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
