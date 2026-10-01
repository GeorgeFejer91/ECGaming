import { expect, test } from "@playwright/test";
import { installTiltSdkFixture } from "./fixtures/tilt-sdk";

test("Other Side pairs a body signal, advances during stillness, and holds progress when the signal is lost", async ({ page, context }) => {
  const errors: string[] = [];
  context.on("page", device => device.on("pageerror", error => errors.push(error.message)));
  page.on("pageerror", error => errors.push(error.message));
  await context.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    (window as any).testFrameCount = 0;
    window.requestAnimationFrame = callback => request(timestamp => {
      (window as any).testFrameCount++;
      (window as any).testFrameTimestamp = timestamp;
      (window as any).testFrameExecution = performance.now();
      callback(timestamp);
    });
  });
  await context.addInitScript(installTiltSdkFixture);
  await context.route("**/vendor/vdoninja/1.5.5/vdoninja-sdk.min.js", route => route.fulfill({ contentType: "text/javascript", body: "/* deterministic test transport */" }));
  await page.goto("./games/other-side/");
  await expect(page.locator("#tunnel")).toBeVisible();
  await expect(page.locator("#pair-screen")).toBeVisible();
  await expect(page.locator("#hud")).toBeHidden();

  const href = await page.locator("#pair-link").getAttribute("href");
  const invitation = new URLSearchParams(new URL(href!).hash.slice(1));
  const phone = await context.newPage();
  await phone.goto("./");
  await phone.evaluate(async ({ room, secret }) => {
    const modulePath = "/src/phone-breather/link.ts";
    const { BreathLink } = await import(modulePath);
    const link = new BreathLink("controller");
    link.pilotName = "Phone";
    await link.start({ room, secret });
    const timer = setInterval(() => link.send({ volume01: 0.5, phase: 0, flow01: 0, confidence01: 1, timestamp: performance.now() }), 100);
    (window as any).stopBodySignal = () => { clearInterval(timer); void link.stop(); };
  }, { room: invitation.get("room"), secret: invitation.get("secret") });
  // Observe the target as a foreground device so its animation clock can run.
  await page.bringToFront();

  try {
    await expect(page.locator("#pair-screen")).toBeHidden({ timeout: 15_000 });
  } catch (error) {
    console.log("OTHER SIDE PAIRING FAILURE", JSON.stringify({ errors, state: await page.evaluate(() => ({
      sdkStarts: (window as any).testSdkStarts,
      status: document.querySelector("#pair-status")?.textContent,
      visibility: document.visibilityState,
      frames: (window as any).testFrameCount,
      frameTimestamp: (window as any).testFrameTimestamp,
      frameExecution: (window as any).testFrameExecution,
      observedAt: performance.now(),
    })) }));
    throw error;
  }
  await expect(page.locator("#hud")).toBeVisible();
  await expect(page.locator("#state-label")).toHaveText("THE LIGHT HAS NOTICED YOU");
  await expect.poll(() => page.locator("#progress-fill").evaluate(element => parseFloat(element.style.width))).toBeGreaterThan(0);

  await phone.evaluate(() => (window as any).stopBodySignal());
  await expect(page.locator("#state-label")).toHaveText("BODY SIGNAL LOST");
  const held = await page.locator("#progress-fill").getAttribute("style");
  await page.waitForTimeout(1300);
  await expect(page.locator("#progress-fill")).toHaveAttribute("style", held!);
});
