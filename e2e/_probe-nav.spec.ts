import { expect, test } from "@playwright/test";
import { installTiltSdkFixture } from "./fixtures/tilt-sdk";

test("probe navigation events on the demo game page", async ({ page }) => {
  test.setTimeout(90_000);
  const events: string[] = [];
  page.on("framenavigated", frame => events.push(`navigated:${frame.url()}`));
  page.on("pageerror", error => events.push(`pageerror:${error.message}`));
  await page.goto("./games/phone-breather/");
  await page.evaluate(() => document.querySelector("#sender") === null);
  await page.waitForTimeout(2_000);
  const maker = page.getByRole("dialog", { name: "Who is your maker" });
  if (await maker.isVisible()) {
    await maker.getByLabel("Your maker's name").fill("Yahweh");
    await maker.getByRole("button", { name: "ANSWER" }).click();
  }
  await page.waitForTimeout(8_000);
  console.log("PROBE-EVENTS", JSON.stringify(events));
  console.log("PROBE-DIALOG-OPEN", JSON.stringify({ maker: await maker.isVisible(), url: page.url() }));
});