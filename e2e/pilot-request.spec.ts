import { expect, test, type Page } from "@playwright/test";
import { installTiltSdkFixture } from "./fixtures/tilt-sdk";
import { installPilotLobbyFixture } from "./fixtures/pilot-lobby";

async function ground(page: Page, towerName = "Major Tom") {
  await page.goto("./ground-control/");
  await expect(page.getByRole("dialog", { name: "Name this Ground Control" })).toBeVisible();
  await page.getByRole("combobox", { name: "Ground Control callsign" }).fill(towerName);
  await page.getByRole("button", { name: "Transmit callsign" }).click();
  await expect(page.locator("#connect-phone-controller")).toBeVisible();
  const url = await page.evaluate(async () => (await import("/src/phone-tilt/pilot-reception.ts")).getPilotReception().url());
  const stream = `ecg_pilot_${new URL(url).searchParams.get("tower")}`;
  await expect.poll(() => page.evaluate(stream => Object.keys(localStorage).some(key =>
    key.startsWith("pilot-test-") && key.endsWith("-sources") && Boolean(JSON.parse(localStorage.getItem(key)!)[stream])), stream)).toBe(true);
  return url;
}
async function request(phone: Page, url: string, name: string) {
  await phone.goto(url, { waitUntil: "domcontentloaded" });
  await phone.getByRole("textbox", { name: "Pilot name", exact: true }).fill(name);
  await phone.getByRole("button", { name: "Request wheel", exact: true }).click();
}
async function requestCockpit(cockpit: Page, url: string, name: string) {
  await cockpit.goto(url, { waitUntil: "domcontentloaded" });
  await cockpit.getByRole("textbox", { name: "Cockpit name", exact: true }).fill(name);
  await cockpit.getByRole("button", { name: "Request cockpit", exact: true }).click();
}
async function phoneState(page: Page) {
  return page.evaluate(async () => {
    const hub = (await import("/src/flight-session/hub.ts")).getFlightSessionHub();
    return { selected: hub.phoneSelected, ready: hub.phone.ready, name: hub.phone.pilotName, tilt: hub.readTilt() };
  });
}
test.beforeEach(async ({ context }) => {
  await context.addInitScript({ content: `(${installTiltSdkFixture.toString()})(); (${installPilotLobbyFixture.toString()})();` });
  await context.route("**/vendor/vdoninja/1.5.5/vdoninja-sdk.min.js", route => route.fulfill({ contentType: "text/javascript", body: "/* deterministic test transport */" }));
});

test("controller explains when no Ground Control tower is found", async ({ page }) => {
  await page.goto("./controller/");
  await page.getByRole("textbox", { name: "Pilot name", exact: true }).fill("George");
  await page.getByRole("button", { name: "Request wheel", exact: true }).click();
  await expect(page.locator("#pilot-request-status")).toContainText("Still looking for Ground Control", { timeout: 6_000 });
  await expect(page.locator(".pilot-request-debug")).toContainText(/DiscoveryNo tower found on/);
  await expect(page.locator(".pilot-request-debug")).toContainText(/ChannelOpen Ground Control in this same site/);
  await expect(page.locator(".pilot-request-debug")).toContainText(/RequestNot sent/);
});

test("direct URL requests a named pilot; only acceptance enables steering", async ({ page, context }) => {
  await ground(page);
  const phone = await context.newPage();
  await request(phone, new URL("/controller/", page.url()).href, "Amelia");
  const approval = page.getByRole("dialog", { name: "Pilot requests" });
  await expect(approval).toContainText("Amelia wants to take the wheel.");
  await expect(phone.locator(".pilot-request-debug")).toContainText(/TargetAny open Ground Control/);
  await expect(phone.locator(".pilot-request-debug")).toContainText(/DiscoveryGround Control selected/);
  await expect(phone.locator(".pilot-request-debug")).toContainText(/ChannelRequest channel open/);
  await expect(phone.locator(".pilot-request-debug")).toContainText(/Request(Received by Ground Control|Sent; check Ground Control)/);
  expect((await phoneState(page)).selected).toBe(false);
  await expect(phone.locator("#pilot-entry")).toBeVisible();
  await approval.getByRole("button", { name: "Let pilot fly" }).click();
  await expect(phone.locator("#connection-status")).toHaveText("Connected");
  await expect(phone.locator("#pilot-entry")).toBeHidden();
  await expect.poll(async () => (await phoneState(page)).name).toBe("Amelia");
  await phone.evaluate(() => { (window as any).orientationSample = { beta: -24, gamma: -65 }; });
  await expect.poll(async () => (await phoneState(page)).tilt?.x).toBeGreaterThan(.7);
  // Opening the lazy 3D phone widget must retain an externally approved pilot.
  await page.locator("#connect-phone-controller").click();
  await expect.poll(async () => (await phoneState(page)).ready).toBe(true);
  await expect(page.getByRole("dialog", { name: "Phone tilt controller" }).locator("canvas").first()).toBeHidden();
});

test("request channel closure retries before reporting failure", async ({ page, context }) => {
  const url = await ground(page);
  await page.evaluate(() => { (window as any).pilotDropNextRequestBeforeDelivery = true; });
  const phone = await context.newPage();
  await request(phone, url, "Retry");
  await expect.poll(() => page.evaluate(() => (window as any).pilotDroppedRequestCount ?? 0)).toBe(1);
  const approval = page.getByRole("dialog", { name: "Pilot requests" });
  await expect(approval).toContainText("Retry wants to take the wheel.");
  await expect(phone.locator(".pilot-request-debug")).toContainText(/DiscoveryMajor Tom found|DiscoveryGround Control selected/);
  await expect(phone.locator(".pilot-request-debug")).toContainText(/ChannelRequest channel open/);
  await expect(phone.locator(".pilot-request-debug")).toContainText(/Request(Received by Ground Control|Sent; check Ground Control)/);
});

test("missing request receipt resends before reporting failure", async ({ page, context }) => {
  const url = await ground(page);
  await page.evaluate(() => { (window as any).pilotLoseNextRequestBeforeDelivery = true; });
  const phone = await context.newPage();
  await request(phone, url, "Resend");
  await expect.poll(() => page.evaluate(() => (window as any).pilotLostRequestCount ?? 0)).toBe(1);
  const approval = page.getByRole("dialog", { name: "Pilot requests" });
  await expect(approval).toContainText("Resend wants to take the wheel.", { timeout: 6_000 });
  await expect(phone.locator(".pilot-request-debug")).toContainText(/RequestReceived by Ground Control/);
});

test("declining a second pilot preserves the current pilot; cancelling clears requests", async ({ page, context }) => {
  const url = await ground(page), first = await context.newPage(), second = await context.newPage();
  await request(first, url, "First");
  const approval = page.getByRole("dialog", { name: "Pilot requests" });
  await approval.getByRole("button", { name: "Let pilot fly" }).click();
  await expect(first.locator("#connection-status")).toHaveText("Connected");
  await request(second, url, "Second");
  await expect(approval).toContainText("This hands over from First.");
  await approval.getByRole("button", { name: "Decline" }).click();
  await expect(second.locator("#pilot-request-status")).toContainText("declined");
  expect((await phoneState(page)).name).toBe("First");
  expect((await phoneState(page)).ready).toBe(true);
  await second.getByRole("button", { name: "Request wheel", exact: true }).click();
  await expect(approval).toContainText("Second wants to take the wheel.");
  await second.getByRole("button", { name: "Cancel request" }).click();
  await expect(approval).toBeHidden();
  expect((await phoneState(page)).name).toBe("First");
  await second.getByRole("button", { name: "Request wheel", exact: true }).click();
  await approval.getByRole("button", { name: "Let pilot fly" }).click();
  await expect(second.locator("#connection-status")).toHaveText("Connected");
  await expect.poll(async () => (await phoneState(page)).name).toBe("Second");
  await expect(first.locator("#connection-status")).not.toHaveText("Connected");
});

test("multiple towers require a choice and route the request only to that tower", async ({ page, context }) => {
  const firstUrl = await ground(page, "Major Tom"), other = await context.newPage();
  await ground(other, "Starman");
  const phone = await context.newPage();
  await request(phone, new URL("/controller/", firstUrl).href, "Pilot");
  await expect(phone.locator(".pilot-tower-choices button")).toHaveCount(2);
  await expect(phone.locator(".pilot-request-debug")).toContainText(/Discovery2 Ground Control windows found/);
  await expect(phone.locator(".pilot-request-debug")).toContainText(/ChannelChoose a tower/);
  await phone.getByRole("button", { name: "Major Tom", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Pilot requests" })).toBeVisible();
  await expect(other.getByRole("dialog", { name: "Pilot requests" })).toBeHidden();
});

test("direct cockpit requests add view-only sessions without replacing the phone pilot", async ({ page, context }) => {
  test.setTimeout(60_000);
  const url = await ground(page);
  const phone = await context.newPage();
  await request(phone, url, "Pilot");
  const approval = page.getByRole("dialog", { name: "Pilot requests" });
  await approval.getByRole("button", { name: "Let pilot fly" }).click();
  await expect(phone.locator("#connection-status")).toHaveText("Connected");
  await expect.poll(async () => (await phoneState(page)).name).toBe("Pilot");

  const firstView = await context.newPage(), secondView = await context.newPage();
  const cockpitUrl = new URL("/session-cockpit/", url).href;
  await requestCockpit(firstView, cockpitUrl, "Observer One");
  await expect(approval).toContainText("Observer One wants to join the cockpit view.");
  await approval.getByRole("button", { name: "Open cockpit view" }).click();
  await expect(firstView.locator("#session-link")).toHaveText("Connected");

  await requestCockpit(secondView, cockpitUrl, "Observer Two");
  await expect(approval).toContainText("Observer Two wants to join the cockpit view.");
  await approval.getByRole("button", { name: "Open cockpit view" }).click();
  await expect(secondView.locator("#session-link")).toHaveText("Connected");
  await expect(phone.locator("#connection-status")).toHaveText("Connected");
  await expect.poll(async () => (await phoneState(page)).name).toBe("Pilot");
});
