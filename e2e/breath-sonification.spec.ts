import { expect, test } from "@playwright/test";

test("Breath Mirror changes pace and follows normalized physiology", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("./breath-sonification/");
  await expect(
    page.getByRole("heading", { name: /breath.*mirror/i }),
  ).toBeVisible();
  await expect(page.locator("#bpm-value")).toHaveText("12.0");
  await expect(page.locator(".lung-form")).toHaveCount(1);
  await expect(page.locator("#lung-silhouette")).toHaveCount(1);
  await expect(page.locator(".lung, .orbit")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Lock to Polar H10" }),
  ).toBeVisible();
  await expect(page.locator("#sonic-aperture")).toBeVisible();

  await page.getByRole("button", { name: /fast.*30 bpm/i }).click();
  await expect(page.locator("#bpm-value")).toHaveText("30.0");

  await page.getByRole("button", { name: "Start breathing" }).click();
  await expect(page.locator("#audio-status")).toHaveText("Audio running");
  await expect(page.locator("#source-text")).toHaveText("timed cycle");

  await page.locator(".switch").click();
  await expect(page.getByLabel("Manual lab")).toBeChecked();
  await page.locator("#sensor-volume").fill("0.2");
  await page.waitForTimeout(220);
  const contractedOpenness = Number(
    await page.locator("#sonic-aperture").getAttribute("data-openness"),
  );
  const contractedLung = await page
    .locator("#lung-silhouette")
    .getAttribute("d");
  await page.locator("#sensor-volume").fill("0.8");
  await expect(page.locator("#source-text")).toHaveText("manual input");
  await expect
    .poll(() => page.locator("#lung-silhouette").getAttribute("d"))
    .not.toBe(contractedLung);
  await expect(page.locator("#lung-silhouette")).toHaveAttribute(
    "d", /M 147/,
  );
  await expect
    .poll(async () =>
      Number(await page.locator("#sonic-aperture").getAttribute("data-openness")),
    )
    .toBeGreaterThan(contractedOpenness);
  await expect(page.locator("#sonic-aperture-qualities")).toHaveText(
    "broad · resonant · diffuse",
  );

  await page.locator(".switch").click();
  await expect(page.getByLabel("Manual lab")).not.toBeChecked();
  await expect(page.locator("#source-text")).toHaveText("timed cycle", {
    timeout: 2_000,
  });
  expect(pageErrors).toEqual([]);
});
