import { enterPilot } from "./fixtures/pilot-entry";
import { test, expect, type Page } from "@playwright/test";
import { installTiltSdkFixture } from "./fixtures/tilt-sdk";

/** Synthetic hardware boundary; no physical Bluetooth qualification is claimed by this test. */
async function installSyntheticPolar(page: Page, heartRate = 120) {
  await page.evaluate(async hr => {
    Object.defineProperty(navigator, "bluetooth", { configurable: true, value: { requestDevice: async () => {} } });
    const { getPolarBrowserHub } = await import("/src/polar/browser-hub.ts");
    const hub = getPolarBrowserHub();
    let loop: ReturnType<typeof setInterval>;
    let callback: (event: any) => void;
    (window as any).syntheticEcgRunning = true;
    hub.connect = async listener => {
      (window as any).emitTestPolar = listener;
      callback = listener; callback({ kind: "connection", connected: true });
      loop = setInterval(() => {
        if (!(window as any).syntheticEcgRunning) return;
        callback({ kind: "heart-rate", rrIntervalsMs: [60000 / hr] });
        callback({ kind: "metrics", snapshot: { values: { excitement_score: .85, heart_rate: hr, rr_interval: 60000 / hr } } });
        callback({ kind: "ecg", microvolts: [0, 2, 3, 7, 15, 30, 10, 0], sensorTimestampNs: BigInt(Math.round(performance.now())) * 1_000_000n,
          streamHealth: { observedSampleRateHz: 130 } });
      }, 40);
    };
    hub.disconnect = async () => { clearInterval(loop); callback?.({ kind: "connection", connected: false }); };
  }, heartRate);
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(installTiltSdkFixture);
  await context.route("**/vendor/vdoninja/1.5.5/vdoninja-sdk.min.js", route => route.fulfill({ contentType: "text/javascript", body: "/* test transport */" }));
});

test("three browsers route only source-computed controls and switch source without mixing input", async ({ page, context }, testInfo) => {
  // Three rendered browsers and source handoffs exceed two minutes on software-rendered CI.
  test.setTimeout(180_000);
  const errors: string[] = []; context.on("page", p => p.on("pageerror", error => errors.push(error.message)));
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("./ground-control/");
  await page.locator("#connect-phone-controller").click();
  const dialog = page.getByRole("dialog", { name: "Phone tilt controller" });
  const phoneLink = dialog.getByRole("link", { name: "Open controller" }); await expect(phoneLink).toBeVisible();
  const phone = await context.newPage(); await phone.setViewportSize({ width: 844, height: 390 });
  await phone.goto((await phoneLink.getAttribute("href"))!);
  await enterPilot(phone);
  await expect(phone.locator("#connection-status")).toHaveText("Connected");
  await dialog.locator("summary").click();
  await dialog.locator("#flight-session-source").selectOption("phone");
  await installSyntheticPolar(phone);
  await phone.getByRole("button", { name: "Connect Polar H10" }).click();
  await expect(phone.locator(".polar-source-status")).toContainText("H10 ready");
  await expect.poll(() => page.locator("#command-altitude").textContent()).toMatch(/^\+0\.[67]/);
  await dialog.getByRole("button", { name: "Pair separate cockpit" }).click();
  const cockpitLink = dialog.getByRole("link", { name: "Open cockpit" }); await expect(cockpitLink).toBeVisible();
  const cockpit = await context.newPage(); await cockpit.goto((await cockpitLink.getAttribute("href"))!);
  await expect(cockpit.locator("#session-link")).toHaveText("Connected");
  await expect(cockpit.locator("#session-signal")).toHaveAttribute("data-ready", "true");
  await cockpit.getByRole("button", { name: "Start flight", exact: true }).click();
  await phone.bringToFront();
  await phone.evaluate(() => {
    (window as any).inputEvents = [];
    for (const type of ["blur", "focus", "keydown", "keyup", "visibilitychange"]) window.addEventListener(type, event => {
      const list = (window as any).inputEvents;
      list.push({ type, at: performance.now(), target: (event.target as HTMLElement)?.id, key: (event as KeyboardEvent).key });
      if (list.length > 80) list.shift();
    }, true);
    new MutationObserver(() => {
      const list = (window as any).inputEvents;
      list.push({ type: "status", text: document.querySelector("#input-status")?.textContent, at: performance.now() });
      if (list.length > 80) list.shift();
    }).observe(document.querySelector("#input-status")!, { childList: true });
  });
  await expect(phone.locator("#confirmed")).toContainText("Centred");
  await phone.locator("#tilt-pad").focus(); await phone.keyboard.down("ArrowRight");
  try {
    await expect.poll(() => cockpit.evaluate(async () => (await import("/src/flight-session/hub.ts")).getFlightSessionHub().readTilt()?.x), { timeout: 15_000 }).toBe(1);
  } catch (error) {
    console.log("STEERING", JSON.stringify({
      phone: await phone.evaluate(() => ({ events: (window as any).inputEvents, intent: (window as any).lastTestIntent?.tilt, confirmed: document.querySelector("#confirmed")?.textContent, status: document.querySelector("#input-status")?.textContent, focused: document.activeElement?.id, hidden: document.hidden })),
      tower: await page.evaluate(async () => { const h = (await import("/src/flight-session/hub.ts")).getFlightSessionHub(); return { tilt: h.phone.snapshot(), selected: h.phoneSelected, ready: h.phone.ready }; }),
      cockpit: await cockpit.evaluate(async () => { const h = (await import("/src/flight-session/hub.ts")).getFlightSessionHub(); return { tilt: h.client?.relay?.steering, fresh: h.client?.fresh, ready: h.client?.ready, selected: h.client?.relay?.phoneSelected }; }),
    }));
    throw error;
  }
  await phone.keyboard.up("ArrowRight");
  const packet = await phone.evaluate(() => (window as any).lastTestIntent);
  expect(Object.keys(packet).sort()).toEqual(["pilotName", "signal", "tilt"]);
  expect(JSON.stringify(packet)).not.toMatch(/microvolts|heart_rate|excitement_score|rr_interval/);
  await phone.screenshot({ path: testInfo.outputPath("phone-h10-yoke.png") });
  await cockpit.screenshot({ path: testInfo.outputPath("session-cockpit.png") });
  // Changing the tower's mapping changes calculations at the phone.
  await dialog.getByRole("button", { name: "Back to flight" }).click();
  await page.getByRole("button", { name: "Heart rate", exact: true }).click();
  await expect(phone.locator(".polar-source-status")).toContainText("H10 ready");
  await expect.poll(() => page.locator("#command-altitude").textContent()).toMatch(/^\+0\.[234]/);
  await page.locator("#adaptive-normalization").evaluate((input: HTMLInputElement) => { input.checked = true; input.dispatchEvent(new Event("change")); });
  await expect(page.locator("#adaptive-range-state")).toContainText("PHONE");
  const revision = await phone.evaluate(() => (window as any).lastTestIntent.signal.configRevision);
  await page.locator("#reset-adaptive-range").evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(() => phone.evaluate(() => (window as any).lastTestIntent.signal.configRevision)).toBeGreaterThan(revision);
  await expect(cockpit.locator("#session-signal")).toHaveAttribute("data-ready", "false");
  await page.locator("#adaptive-normalization").evaluate((input: HTMLInputElement) => { input.checked = false; input.dispatchEvent(new Event("change")); });
  await expect(cockpit.locator("#session-signal")).toHaveAttribute("data-ready", "true");
  // A live network carrying repeated packets cannot hide loss of ECG samples at the source.
  await phone.evaluate(() => { (window as any).syntheticEcgRunning = false; });
  await expect(cockpit.locator("#session-signal")).toHaveAttribute("data-ready", "false");
  await phone.evaluate(() => { (window as any).syntheticEcgRunning = true; });
  await expect(cockpit.locator("#session-signal")).toHaveAttribute("data-ready", "true");
  await phone.evaluate(() => { (window as any).testPageVisible = false; document.dispatchEvent(new Event("visibilitychange")); });
  await expect(cockpit.locator("#session-signal")).toHaveAttribute("data-ready", "false");
  await phone.evaluate(() => { (window as any).testPageVisible = true; document.dispatchEvent(new Event("visibilitychange")); });
  await expect(cockpit.locator("#session-signal")).toHaveAttribute("data-ready", "true");
  // Source selection invalidates the previous source even while that H10 remains connected.
  await page.locator("#connect-phone-controller").click();
  await dialog.locator("#flight-session-source").selectOption("cockpit");
  await expect(cockpit.locator("#session-signal")).toHaveAttribute("data-ready", "false");
  await expect(phone.locator(".polar-source-status")).toContainText("Select this device");
  await cockpit.bringToFront();
  await installSyntheticPolar(cockpit, 50);
  await cockpit.locator("#session-sensor summary").click();
  await cockpit.getByRole("button", { name: "Connect Polar H10" }).click();
  await expect(cockpit.locator("#session-signal")).toHaveAttribute("data-source", "cockpit");
  await expect(cockpit.locator("#session-signal")).toHaveAttribute("data-ready", "true");
  // Qualify the source change by a strong opposite-direction command. Full smoothing
  // convergence depends on how many fresh frames a busy renderer can produce.
  await expect.poll(() => cockpit.evaluate(() => (window as any).lastTestIntent.signal.frame?.altitude), { timeout: 15_000 }).toBeLessThan(-.5);
  await expect.poll(() => page.evaluate(async () =>
    (await import("/src/flight-session/hub.ts")).getFlightSessionHub().signal.read(performance.now())?.altitude)).toBeLessThan(-.5);
  // These pages represent separate visible devices. The tower's DOM preview uses RAF,
  // so foreground it before checking painted text after interacting with the cockpit.
  await page.bringToFront();
  await expect.poll(() => page.locator("#command-altitude").textContent(), { timeout: 15_000 }).toMatch(/^-0\.[5-9]/);
  await dialog.locator("#flight-session-source").selectOption("ground");
  await expect(cockpit.locator("#session-signal")).toHaveAttribute("data-ready", "false");
  await expect(cockpit.locator("#session-signal")).toHaveAttribute("data-source", "ground");
  expect(errors).toEqual([]);
});

test("the phone vibrates for local Polar RR notifications and stops on hide or disconnect", async ({ page, context }) => {
  await page.goto("./ground-control/"); await page.locator("#connect-phone-controller").click();
  const link = page.getByRole("link", { name: "Open controller" }); await expect(link).toBeVisible();
  const phone = await context.newPage(); await phone.goto((await link.getAttribute("href"))!);
  await enterPilot(phone);
  await expect(phone.locator("#connection-status")).toHaveText("Connected");
  await installSyntheticPolar(phone);
  await phone.evaluate(() => {
    (window as any).syntheticEcgRunning = false;
    (window as any).vibrationCalls = [];
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: (duration: number) => {
      (window as any).vibrationCalls.push(duration); return true;
    } });
  });
  await phone.getByRole("button", { name: "Connect Polar H10" }).click();
  await phone.evaluate(() => (window as any).emitTestPolar({ kind: "heart-rate", rrIntervalsMs: [800, 810] }));
  expect(await phone.evaluate(() => (window as any).vibrationCalls.filter((ms: number) => ms > 0))).toEqual([100]);
  await phone.evaluate(() => {
    (window as any).testPageVisible = false; document.dispatchEvent(new Event("visibilitychange"));
    (window as any).emitTestPolar({ kind: "heart-rate", rrIntervalsMs: [810] });
  });
  expect(await phone.evaluate(() => (window as any).vibrationCalls.at(-1))).toBe(0);
  await phone.evaluate(() => {
    (window as any).testPageVisible = true; document.dispatchEvent(new Event("visibilitychange"));
  });
  await phone.getByRole("button", { name: "Disconnect H10" }).click();
  await phone.evaluate(() => (window as any).emitTestPolar({ kind: "heart-rate", rrIntervalsMs: [810] }));
  expect(await phone.evaluate(() => (window as any).vibrationCalls.filter((ms: number) => ms > 0))).toEqual([100]);
  expect(await phone.evaluate(() => (window as any).vibrationCalls.at(-1))).toBe(0);
});

test("unsupported H10 browser retains the paired touch controller", async ({ page, context }) => {
  await page.goto("./ground-control/"); await page.locator("#connect-phone-controller").click();
  const link = page.getByRole("link", { name: "Open controller" }); await expect(link).toBeVisible();
  const phone = await context.newPage(); await phone.goto((await link.getAttribute("href"))!);
  await enterPilot(phone);
  await phone.setViewportSize({ width: 667, height: 280 });
  await expect(phone.locator("#connection-status")).toHaveText("Connected");
  await phone.evaluate(() => Object.defineProperty(navigator, "bluetooth", { configurable: true, value: undefined }));
  await phone.getByRole("button", { name: "Connect Polar H10" }).click();
  await expect(phone.locator(".polar-source-status")).toContainText("H10 is unavailable in this browser");
  expect(await phone.locator(".yoke-hub").evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true);
  await phone.locator("#tilt-pad").focus(); await phone.keyboard.down("ArrowLeft");
  await expect(phone.locator("#confirmed")).toContainText("Left 100%"); await phone.keyboard.up("ArrowLeft");
});


test("the local Polar button restores an existing sensor after remote tower selection", async ({ page }) => {
  await page.goto("./ground-control/");
  await page.setViewportSize({ width: 390, height: 844 });
  await installSyntheticPolar(page);
  await page.getByRole("button", { name: "Connect Polar H10", exact: true }).click();
  await expect(page.getByRole("button", { name: "Polar connected", exact: true })).toBeDisabled();
  const sourceBox = await page.locator("#polar-source-controls").boundingBox();
  const disconnectBox = await page.locator("#disconnect-polar").boundingBox();
  expect(disconnectBox!.y + disconnectBox!.height).toBeLessThanOrEqual(sourceBox!.y + sourceBox!.height);
  await page.getByRole("button", { name: "Remote tower", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Use local Polar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Polar connected", exact: true })).toBeDisabled();
  await expect(page.locator("#signal-source-polar")).toBeChecked();
  await expect(page.locator("#start-flight-from-ground")).toBeEnabled();
});
