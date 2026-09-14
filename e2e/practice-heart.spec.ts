import { test, expect } from "@playwright/test";
import { nameGroundControl, openGroundControl } from "./fixtures/ground-control";

test("the mechanical heart starts a local practice flight and stops its clearance when switched off", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    (window as any).bluetoothRequests = 0;
    Object.defineProperty(navigator, "bluetooth", { configurable: true, value: { requestDevice: () => { (window as any).bluetoothRequests++; throw new Error("No sensor expected"); } } });
  });
  await openGroundControl(page);
  const heart = page.getByRole("button", { name: "Practice heartbeat", exact: true });
  await expect(heart).toBeVisible(); await expect(heart).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#start-flight-from-ground")).toBeDisabled();
  await heart.click();
  await expect(heart).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#start-flight-from-ground")).toBeEnabled();
  await expect(page.locator("#ground-aircraft-preview")).toHaveAttribute("data-heartbeat-mode", "practice");
  await expect.poll(() => page.locator("#ground-aircraft-preview").getAttribute("data-heartbeat-pulse")).not.toBe("0.0000");
  const flags = await page.evaluate(async () => (await import("/src/flight-session/hub.ts")).getFlightSessionHub().signal.read(performance.now())!.flags);
  const { FlightFlags } = await import("../src/protocol/flight-frame");
  expect(flags & FlightFlags.simulation).toBeTruthy(); expect(flags & FlightFlags.physicalPolar).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("clockwork-heart-ground.png") });
  await page.locator("#start-flight-from-ground").click();
  await expect(page.locator("#cockpit-runway-panel")).toBeHidden();
  await expect(page.locator("#cockpit-pause-panel")).toBeHidden();
  await expect(page.locator("[data-rr-status]")).toHaveAttribute("data-rr-status", "receiving");
  await expect(page.locator("[data-rr-status]")).toContainText("Simulated RR");
  await page.locator("#ground-view-toggle").click(); await heart.click();
  await expect(heart).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#start-flight-from-ground")).toBeDisabled();
  await page.locator("#cockpit-view-toggle").click();
  await expect(page.locator("#cockpit-pause-panel")).toBeVisible();
  expect(await page.evaluate(() => (window as any).bluetoothRequests)).toBe(0);
  expect(errors).toEqual([]);
});

test("the practice heart fits beside Polar and remains off after a reload", async ({ page }, testInfo) => {
  await openGroundControl(page);
  const heart = page.locator("#practice-heart");
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const h = await heart.boundingBox(); const p = await page.locator("#connect-polar").boundingBox();
    expect(h!.width).toBeGreaterThanOrEqual(44); expect(h!.height).toBeGreaterThanOrEqual(44);
    expect(h!.x + h!.width).toBeLessThanOrEqual(viewport.width); expect(h!.y + h!.height).toBeLessThanOrEqual(viewport.height);
    expect(p!.x + p!.width).toBeLessThanOrEqual(h!.x);
    const source = await page.locator("#polar-source-controls").boundingBox();
    expect(h!.y + h!.height).toBeLessThanOrEqual(source!.y + source!.height);
    expect(await page.locator("#connect-polar").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await heart.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    if (viewport.width === 390) await page.screenshot({ path: testInfo.outputPath("clockwork-heart-phone.png") });
  }
  await heart.click(); await expect(heart).toHaveAttribute("aria-pressed", "true");
  await page.reload(); await nameGroundControl(page); await expect(heart).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#start-flight-from-ground")).toBeDisabled();
});
