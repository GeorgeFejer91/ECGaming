import { enterPilot } from "./fixtures/pilot-entry";
import { test, expect, type Page } from "@playwright/test";
import { openGroundControl } from "./fixtures/ground-control";
import { installTiltSdkFixture } from "./fixtures/tilt-sdk";

const ink = (page: Page, id: string) => page.locator(id).evaluate((canvas: HTMLCanvasElement) => {
  const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
  let count = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 20) count++;
  return count;
});

test("raw ECG stays below the selected metric, with independent live and paused traces", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/src/polar/browser-hub.ts*", route => route.fulfill({ contentType: "text/javascript", body: `
    export function polarWebBluetoothSupport(){return {supported:true,reason:''};}
    const hub = {async connect(callback){window.emitEcg=callback;callback({kind:'connection',connected:true});},
      async disconnect(){window.emitEcg({kind:'connection',connected:false});},diagnosticSnapshot(){return{};},subscribeStatus(){return()=>{};}};
    export function getPolarBrowserHub(){return hub;}` }));
  await openGroundControl(page); await page.locator("#connect-polar").click();
  await page.evaluate(() => {
    let n = 0; const start = performance.now();
    (window as any).ecgTimer = setInterval(() => {
      const emit = (window as any).emitEcg;
      const end = Math.floor((performance.now() - start) * 130 / 1000);
      const samples = Array.from({ length: Math.max(0, end - n) }, () => { const phase = n++ % 104; return phase === 0 ? 1000 : phase === 4 ? -200 : 20 * Math.sin(phase / 8); });
      emit({ kind: "ecg", microvolts: samples, sensorTimestampNs: BigInt(Math.round(n / 130 * 1e9)), streamHealth: { observedSampleRateHz: 130 } });
      emit({ kind: "metrics", snapshot: { values: { heart_rate: 75, excitement_score: .5 } } });
    }, 100);
  });
  await expect(page.locator("#raw-ecg-state")).toHaveText("Live");
  await expect.poll(() => ink(page, "#raw-ecg-preview")).toBeGreaterThan(100);
  for (const metric of ["Heart rate", "Excite-O-Meter"]) {
    await page.getByRole("button", { name: metric, exact: true }).click();
    await expect(page.locator("#scope-metric-label")).toHaveText(metric.toUpperCase());
    await expect(page.locator("#scope-metric-unit")).not.toHaveText("RAW ECG");
    await expect.poll(() => ink(page, "#ecg-preview")).toBeGreaterThan(100);
    await expect(page.locator("#raw-ecg-state")).toHaveText("Live");
  }
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 390, height: 667 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => {
      const selected = await page.locator(".signal-displays > section").first().boundingBox();
      const raw = await page.locator(".raw-ecg-instrument").boundingBox();
      return !!selected && !!raw && Math.abs(selected.height - raw.height) < 1 && raw.y >= selected.y + selected.height && raw.y + raw.height <= viewport.height;
    }).toBe(true);
    const canvas = await page.locator("#raw-ecg-preview").boundingBox();
    expect(canvas!.height).toBeGreaterThan(20);
    await page.screenshot({ path: testInfo.outputPath(`raw-ecg-${viewport.width}-${viewport.height}.png`) });
  }
  await page.evaluate(() => clearInterval((window as any).ecgTimer));
  await expect(page.locator("#raw-ecg-state")).toHaveText("Signal paused");
  await page.locator("#disconnect-polar").click();
  await expect(page.locator("#raw-ecg-state")).toHaveText("Waiting for Polar");
  await expect.poll(() => ink(page, "#raw-ecg-preview")).toBe(0);
  expect(errors).toEqual([]);
});

test("practice ECG pulses the paired steering wheel without Bluetooth and stops when switched off", async ({ page, context }, testInfo) => {
  test.setTimeout(60_000);
  await context.addInitScript(installTiltSdkFixture);
  await context.addInitScript(() => {
    (window as any).vibrationCalls = [];
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: (duration: number) => { (window as any).vibrationCalls.push(duration); return true; } });
    Object.defineProperty(navigator, "bluetooth", { configurable: true, value: undefined });
  });
  await context.route("**/vendor/vdoninja/1.5.5/vdoninja-sdk.min.js", route => route.fulfill({ contentType: "text/javascript", body: "/* fixture */" }));
  await openGroundControl(page);
  await page.locator("#practice-heart").click();
  await expect(page.locator("#raw-ecg-state")).toHaveText("Practice");
  await expect.poll(() => ink(page, "#raw-ecg-preview")).toBeGreaterThan(100);
  await page.locator("#connect-phone-controller").click();
  const invitation = page.getByRole("link", { name: "Open controller" }); await expect(invitation).toBeVisible();
  const phone = await context.newPage(); await phone.setViewportSize({ width: 844, height: 390 });
  await phone.goto((await invitation.getAttribute("href"))!);
  await enterPilot(phone);
  await expect(phone.locator("#connection-status")).toHaveText("Connected");
  await expect(phone.locator(".polar-source-button")).toHaveAttribute("data-heartbeat", "practice");
  await expect.poll(() => phone.evaluate(() => (window as any).vibrationCalls.filter((ms: number) => ms === 100).length)).toBeGreaterThan(1);
  await expect(phone.locator(".polar-source-button")).toHaveAttribute("data-connected", "false");
  await phone.screenshot({ path: testInfo.outputPath("phone-practice-heart.png") });
  await phone.evaluate(() => { (window as any).testPageVisible = false; document.dispatchEvent(new Event("visibilitychange")); });
  expect(await phone.evaluate(() => (window as any).vibrationCalls.at(-1))).toBe(0);
  const paused = await phone.evaluate(() => (window as any).vibrationCalls.length);
  await phone.waitForTimeout(1100);
  expect(await phone.evaluate(() => (window as any).vibrationCalls.length)).toBe(paused);
  await phone.evaluate(() => { (window as any).testPageVisible = true; document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(() => phone.evaluate(() => (window as any).vibrationCalls.length)).toBeGreaterThan(paused);
  await page.getByRole("button", { name: "Back to flight" }).click();
  await page.locator("#practice-heart").click();
  await expect(phone.locator(".polar-source-button")).toHaveAttribute("data-heartbeat", "local");
  await expect.poll(() => phone.evaluate(() => (window as any).vibrationCalls.at(-1))).toBe(0);
  const stopped = await phone.evaluate(() => (window as any).vibrationCalls.length);
  await phone.waitForTimeout(1100);
  expect(await phone.evaluate(() => (window as any).vibrationCalls.length)).toBe(stopped);
  await expect(page.locator("#raw-ecg-state")).toHaveText("Waiting for Polar");
});
