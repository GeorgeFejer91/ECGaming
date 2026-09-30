import { expect, test } from "@playwright/test";
import { installTiltSdkFixture } from "./fixtures/tilt-sdk";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(installTiltSdkFixture, { deviceMotion: true });
  await context.route("**/vendor/vdoninja/1.5.5/vdoninja-sdk.min.js", route =>
    route.fulfill({
      contentType: "text/javascript",
      body: "/* deterministic test transport */",
    }),
  );
});

test("Other Side pairs one phone sensor and advances only from derived breath stillness", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await page.goto("./games/other-side/");

  await expect(page.locator("#start-screen")).toBeVisible();
  await expect(page.locator("#pair-qr")).toBeVisible();
  await expect(page.locator('input[name="mode"]')).toHaveCount(0);
  await expect(page.locator("#hold-btn")).toHaveCount(0);

  const pairHref = await page.locator("#pair-link").getAttribute("href");
  expect(pairHref).toBeTruthy();
  const pairUrl = new URL(pairHref!);
  expect(pairUrl.pathname.endsWith("/phone-breather-controller/")).toBe(true);
  expect(pairUrl.searchParams.get("experience")).toBe("other-side");

  const phone = await context.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(pairHref!);
  await expect(phone.getByRole("button", { name: "ALLOW MOTION & CONNECT" })).toBeVisible();
  await expect(phone.getByLabel("Name of the person")).toBeHidden();
  await phone.getByRole("button", { name: "ALLOW MOTION & CONNECT" }).click();

  await phone.evaluate(() => {
    const base = 9.8;
    (window as any).sendAccel = true;
    (window as any).accelSample = { x: 0.1, y: base, z: base };
    let step = 0;
    (window as any).accelTimer = setInterval(() => {
      step += 1;
      const t = step * 120;
      const cycle = t % 1200;
      (window as any).accelSample = {
        x: 0.1,
        y: base,
        z: cycle < 150 ? base + 1.2 : base,
      };
    }, 120);
  });

  await expect(phone.locator("#controls-section")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#pair-status")).toContainText("BODY SIGNAL ACQUIRED", {
    timeout: 30_000,
  });
  await expect(page.locator("#start-screen")).toBeHidden({ timeout: 30_000 });
  await expect(page.locator("#hud")).toBeVisible();

  const first = Number((await page.locator("#progress-fill").getAttribute("style"))?.match(/[\d.]+/)?.[0] ?? 0);
  await expect
    .poll(
      async () =>
        Number(
          (await page.locator("#progress-fill").getAttribute("style"))?.match(/[\d.]+/)?.[0] ?? 0,
        ),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(first);
});
