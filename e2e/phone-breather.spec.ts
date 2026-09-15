import { expect, test, type Page } from "@playwright/test";
import { installTiltSdkFixture } from "./fixtures/tilt-sdk";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(installTiltSdkFixture, { deviceMotion: true });
  await context.route("**/vendor/vdoninja/1.5.5/vdoninja-sdk.min.js", route => route.fulfill({ contentType: "text/javascript", body: "/* deterministic test transport */" }));
});

async function nameHost(page: Page, name = "Yahweh") {
  const dialog = page.getByRole("dialog", { name: "Who is your maker" });
  await dialog.getByLabel("Your maker's name").fill(name);
  await dialog.getByRole("button", { name: "ANSWER" }).click();
  await expect(dialog.getByText("It's Yahweh or No Way!")).toBeVisible({ timeout: 15_000 });
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(page.locator("#status-text")).toContainText("broadcasting");
}

async function openPairLink(page: Page) {
  await page.getByRole("button", { name: "Pair phone" }).click();
  const dialog = page.getByRole("dialog", { name: "Phone pairing" });
  await expect(dialog).toBeVisible();
  const link = dialog.getByRole("link", { name: "Open on Phone" });
  await expect(link).toBeVisible();
  const href = new URL((await link.getAttribute("href"))!);
  expect(href.pathname.endsWith("/phone-breather-controller/")).toBe(true);
  const params = new URLSearchParams(href.hash.slice(1));
  expect(params.get("maker")).toBe("Yahweh");
  expect(params.get("room")).toMatch(/^ecgbreath_[A-Za-z0-9_]{24}$/);
  expect(params.get("secret")).toHaveLength(32);
  return href.href;
}

async function openController(context: any, href: string) {
  const phone = await context.newPage();
  await phone.setViewportSize({ width: 844, height: 390 });
  await phone.goto(href);
  return phone;
}

async function connectPhone(phone: Page, name = "Tilda") {
  await expect(phone.locator("#entry-section")).toBeVisible();
  await phone.getByLabel("Name of the person").fill(name);
  await phone.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(phone.locator("#controls-section")).toBeVisible({ timeout: 30_000 });
  await expect(phone.locator("#status-text")).toHaveText("Connected to host", { timeout: 30_000 });
}

async function driveHolds(phone: Page) {
  await phone.evaluate(() => {
    const base = 9.8;
    (window as any).accelSample = { x: 0.1, y: base, z: base };
    (window as any).sendAccel = true;
    let step = 0;
    (window as any).accelTimer = setInterval(() => {
      step += 1;
      const t = step * 120;
      const cycle = t % 1200;
      (window as any).accelSample = { x: 0.1, y: base, z: cycle < 150 ? base + 1.2 : base };
    }, 120);
  });
}

function tunnelProgress(page: Page) {
  return page.locator("#tunnel-canvas").getAttribute("data-progress").then(value => Number(value ?? 0));
}

test("host names their maker and gets the Yahweh verdict before broadcasting", async ({ page }) => {
  await page.goto("./phone-breather-host/");
  await nameHost(page);
  await expect(page.locator("#tunnel-canvas")).toBeHidden();
});

test("phone pairs by QR, streams belly motion, and the tunnel light advances on breath holds", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  await page.goto("./phone-breather-host/");
  await nameHost(page);

  const href = await openPairLink(page);
  const phone = await openController(context, href);
  await connectPhone(phone);
  await driveHolds(phone);

  await expect(page.locator("#connection-badge")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#status-text")).toContainText("Tilda", { timeout: 30_000 });
  await expect(page.locator("#tunnel-canvas")).toBeVisible();
  await expect(page.locator("#phase-label")).toHaveText(/Inhale|Exhale|Hold/);

  const first = await tunnelProgress(page);
  await expect.poll(() => tunnelProgress(page), { timeout: 20_000 }).toBeGreaterThan(first + 0.002);
  await page.screenshot({ path: testInfo.outputPath("phone-breather-host-tunnel.png") });
});

test("phone finds the breath screen by name, is accepted, and streams", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  await page.goto("./phone-breather-host/");
  await nameHost(page);
  await expect(page.locator("#status-hint")).toContainText("Waiting for a phone to connect", { timeout: 15_000 });

  const phone = await openController(context, "./phone-breather-controller/");
  await expect(phone.locator("#entry-section")).toBeVisible();
  await phone.getByLabel("Name of the person").fill("Tilda");
  await phone.getByLabel("Maker's breath screen").fill("Yahweh");
  await phone.getByRole("button", { name: "Connect", exact: true }).click();

  const requests = page.getByRole("dialog", { name: "Breath requests" });
  await expect(requests.getByText("Tilda asks to draw close to Yahweh.")).toBeVisible({ timeout: 30_000 });
  await requests.getByRole("button", { name: "Let them connect" }).click();

  await expect(phone.locator("#controls-section")).toBeVisible({ timeout: 30_000 });
  await expect(phone.locator("#status-text")).toHaveText("Connected to host", { timeout: 30_000 });
  await expect(page.locator("#connection-badge")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#status-text")).toContainText("Tilda", { timeout: 30_000 });
  await expect(page.locator("#tunnel-canvas")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("phone-breather-host-named-pair.png") });
});