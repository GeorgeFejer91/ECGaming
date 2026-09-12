import { expect, test } from "@playwright/test";

test("hangar keeps a full-width preview when shared styles load last", async ({ page }) => {
  await page.goto("./ground-control/");
  await expect(page.locator("[data-aircraft-choice]").first()).toBeEnabled();
  // Production CSS bundling can put shared responsive rules after compact styles.
  await page.addStyleTag({ url: "/src/styles.css" });
  for (const viewport of [{ width: 1900, height: 913 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const frame = await page.locator(".aircraft-preview-frame").boundingBox();
    const preview = await page.locator(".aircraft-preview").boundingBox();
    expect(Math.abs(preview!.x + preview!.width / 2 - frame!.x - frame!.width / 2)).toBeLessThan(1);
    expect(preview!.width).toBeGreaterThanOrEqual(frame!.width - 3);
    await expect(page.locator(".aircraft-nameplate")).toBeHidden();
    await expect(page.locator(".aircraft-showcase-header")).toBeHidden();
    expect(await page.locator(".aircraft-hangar-surround").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  }
});
