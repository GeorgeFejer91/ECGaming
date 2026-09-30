import { installTiltSdkFixture } from "./fixtures/tilt-sdk";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(installTiltSdkFixture, { deviceMotion: true });
  await context.route("**/vendor/vdoninja/1.5.5/vdoninja-sdk.min.js", route => route.fulfill({ contentType: "text/javascript", body: "/* deterministic test transport */" }));
});

test("demo game motion probe", async ({ page }) => {
  test.setTimeout(90_000);
  const log: string[] = [];
  page.on("pageerror", e => log.push(`[pageerror] ${e}`));
  page.on("console", m => log.push(`[${m.type()}] ${m.text()}`));

  await page.goto("./games/phone-breather/");
  const maker = page.getByRole("dialog", { name: "Who is your maker" });
  await maker.getByLabel("Your maker's name").fill("Yahweh");
  await maker.getByRole("button", { name: "ANSWER" }).click();
  await expect(maker).toBeHidden({ timeout: 15_000 });
  const pair = page.getByRole("dialog", { name: "Phone pairing" });
  await expect(pair).toBeVisible();
  await pair.getByRole("button", { name: "Close", exact: true }).click();

  await page.evaluate(() => {
    const base = 9.8;
    (window as any).accelSample = { x: 0.1, y: base, z: base };
    (window as any).sendAccel = true;
    (window as any).__motionCount = 0;
    window.addEventListener("devicemotion", () => ((window as any).__motionCount = ((window as any).__motionCount! as number) + 1), { passive: true });
    let step = 0;
    (window as any).accelTimer = setInterval(() => {
      step += 1;
      const t = step * 120;
      const cycle = t % 1200;
      (window as any).accelSample = { x: 0.1, y: base, z: cycle < 150 ? base + 1.2 : base };
    }, 120);
  });

  for (const delay of [5000, 15000, 30000]) {
    await page.waitForTimeout(delay === 5000 ? delay : delay - (delay === 15000 ? 5000 : 15000));
    console.log(`PROBE ${delay}ms`, JSON.stringify(await page.evaluate(() => ({
      count: (window as any).__motionCount,
      status: document.getElementById("status-text")?.textContent,
      dot: document.getElementById("status-dot")?.dataset.state,
      phase: document.getElementById("phase-label")?.textContent,
    }))));
  }
  console.log("PAGE ERRORS\n" + log.join("\n"));
  await expect(page.locator("#status-text")).toContainText("Breathing detected", { timeout: 45_000 });
});