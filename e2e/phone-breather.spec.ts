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
  const dialog = page.getByRole("dialog", { name: "Phone pairing" });
  await expect(dialog).toBeVisible({ timeout: 10_000 }).catch(async () => {
    await page.getByRole("button", { name: "Pair phone" }).click();
    await expect(dialog).toBeVisible({ timeout: 10_000 });
  });
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

test("belly-breath circle expands and contracts with derived breath volume on the demo game", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("./games/phone-breather/");
  const circle = page.locator("#breath-circle");
  await expect(page.locator("main").locator("section", { has: page.locator("#breath-pair-host") })).toBeVisible();

  const maker = page.getByRole("dialog", { name: "Who is your maker" });
  await maker.getByLabel("Your maker's name").fill("Yahweh");
  await maker.getByRole("button", { name: "ANSWER" }).click();
  await expect(maker).toBeHidden({ timeout: 15_000 });

  const pair = page.getByRole("dialog", { name: "Phone pairing" });
  await expect(pair).toBeVisible();
  await pair.getByRole("button", { name: "Close", exact: true }).click();
  await expect(pair).toBeHidden();

  await page.evaluate(() => {
    const base = 9.8, amplitude = 0.8, periodMs = 5_000, start = performance.now();
    (window as any).sendAccel = true;
    (window as any).accelSample = { x: 0, y: 9.8, z: base };
    (window as any).__motionCount = 0;
    window.addEventListener("devicemotion", () => ((window as any).__motionCount = ((window as any).__motionCount! as number) + 1), { passive: true });
    setInterval(() => {
      const t = performance.now() - start;
      (window as any).accelSample = {
        x: 0,
        y: 9.8,
        z: base + amplitude * Math.sin((2 * Math.PI * t) / periodMs),
      };
    }, 16);
  });
  await page.waitForTimeout(8000);
  const s1 = await page.evaluate(() => ({
    count: (window as any).__motionCount,
    perms: (window as any).deviceMotionPermissionRequests,
    sendAccel: (window as any).sendAccel,
  }));
  console.log("MOTION 8s", JSON.stringify(s1));
  await expect(page.locator("#status-text")).toContainText("Breathing detected", { timeout: 45_000 });

  const samples: Array<{ phase: string; r: number }> = await page.evaluate(
    () =>
      new Promise(resolve => {
        const out: Array<{ phase: string; r: number }> = [];
        const collect = () => {
          out.push({
            phase: document.querySelector("#phase-label")!.textContent!.trim(),
            r: Number(document.querySelector("#breath-circle")!.getAttribute("r")),
          });
          if (out.length >= 44) resolve(out);
          else setTimeout(collect, 400);
        };
        collect();
      }),
  );
  const inhale = samples.filter(s => s.phase === "Inhale").map(s => s.r);
  const exhale = samples.filter(s => s.phase === "Exhale").map(s => s.r);
  expect(inhale.length).toBeGreaterThan(0);
  expect(exhale.length).toBeGreaterThan(0);
  expect(Math.max(...inhale)).toBeGreaterThan(130);
  expect(Math.min(...exhale)).toBeLessThan(80);
});

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