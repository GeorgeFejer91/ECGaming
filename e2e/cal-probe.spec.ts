import { installTiltSdkFixture } from "./fixtures/tilt-sdk";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(installTiltSdkFixture, { deviceMotion: true });
  await context.route("**/vendor/vdoninja/1.5.5/vdoninja-sdk.min.js", route => route.fulfill({ contentType: "text/javascript", body: "/* deterministic test transport */" }));
});

const drive = `
  const base = 9.8;
  window.accelSample = { x: 0.1, y: base, z: base };
  window.sendAccel = true;
  let step = 0;
  window.accelTimer = setInterval(() => {
    step += 1;
    const t = step * 120;
    const cycle = t % 1200;
    window.accelSample = { x: 0.1, y: base, z: cycle < 150 ? base + 1.2 : base };
  }, 120);
`;

async function sample(page: { evaluate: (f: any) => Promise<any> }, label: string, ms: number) {
  await new Promise(r => setTimeout(r, ms));
  const s = await page.evaluate(() => ({
    status: document.getElementById("status-text")?.textContent,
    phase: document.getElementById("phase-label")?.textContent,
    r: document.querySelector("#breath-circle")?.getAttribute("r"),
    conf: document.getElementById("metric-confidence")?.textContent,
    vol: document.getElementById("metric-volume")?.textContent,
    deriv: document.getElementById("metric-derivative")?.textContent,
  }));
  console.log(`${label} ${ms}ms`, JSON.stringify(s));
}

test("plain demo game calibrates?", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto("./games/phone-breather/");
  await page.evaluate(drive);
  for (const ms of [6000, 18000, 38000]) await sample(page, "DEMO" , ms);
  console.log("DEMO-ERRORS", JSON.stringify(errors));
  await expect(page.locator("#status-text")).toContainText("Breathing detected", { timeout: 30_000 });
});

test("plain controller calibrates?", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto("./phone-breather-controller/");
  await page.evaluate(drive);
  for (const ms of [6000, 18000, 38000]) await sample(page, "CTRL", ms);
  console.log("CTRL-ERRORS", JSON.stringify(errors));
  await expect(page.locator("#status-text")).toContainText("Breathing detected", { timeout: 30_000 });
});