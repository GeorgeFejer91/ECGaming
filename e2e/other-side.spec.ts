import { expect, test } from "@playwright/test";

test("Other Side starts a crossing and the light advances in showcase mode", async ({
  page,
}) => {
  await page.goto("./games/other-side/");
  await expect(page.locator("#tunnel")).toBeVisible();
  await expect(page.locator("#start-screen")).toBeVisible();

  await page.getByRole("radio", { name: "Auto-play showcase" }).check();
  await page.getByRole("button", { name: "BEGIN THE CROSSING" }).click();

  await expect(page.locator("#start-screen")).toBeHidden();
  await expect(page.locator("#hud")).toBeVisible();
  await expect(page.locator("#state-label")).toHaveText("HOLDING YOUR BREATH");

  await expect(page.locator("#hold-timer")).not.toHaveText("00:00 held");
  const width = await page
    .locator("#progress-fill")
    .evaluate((element) => Number(element.style.width.replace("%", "")));
  expect(width).toBeGreaterThan(0);
});