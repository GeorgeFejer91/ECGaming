import { expect, test } from "@playwright/test";

test("Breath Mirror changes pace and follows normalized physiology", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("./breath-sonification/");
  await expect(
    page.getByRole("heading", { name: /your breathing.*mirrored in sound/i }),
  ).toBeVisible();
  await expect(page.locator("#bpm-value")).toHaveText("12.0");

  await page.getByRole("button", { name: /fast.*30 bpm/i }).click();
  await expect(page.locator("#bpm-value")).toHaveText("30.0");

  await page.getByRole("button", { name: "Start breathing" }).click();
  await expect(page.locator("#audio-status")).toHaveText("Audio running");
  await expect(page.locator("#source-text")).toHaveText("timed cycle");

  await page.locator(".switch").click();
  await expect(page.getByLabel("Track input")).toBeChecked();
  await page.locator("#sensor-volume").fill("0.8");
  await expect(page.locator("#source-text")).toHaveText("live input");

  await page.locator(".switch").click();
  await expect(page.getByLabel("Track input")).not.toBeChecked();
  await expect(page.locator("#source-text")).toHaveText("timed cycle", {
    timeout: 2_000,
  });
  expect(pageErrors).toEqual([]);
});
