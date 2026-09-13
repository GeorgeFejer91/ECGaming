import { expect, test, type Page } from "@playwright/test";
import { installTiltSdkFixture } from "./fixtures/tilt-sdk";
import { installPilotLobbyFixture } from "./fixtures/pilot-lobby";

async function ground(page: Page) {
  await page.goto("./ground-control/");
  await expect(page.locator("#connect-phone-controller")).toBeVisible();
  const url = await page.evaluate(async () => (await import("/src/phone-tilt/pilot-reception.ts")).getPilotReception().url());
  const stream = `ecg_pilot_${new URL(url).searchParams.get("tower")}`;
  await expect.poll(() => page.evaluate(stream => Object.keys(localStorage).some(key =>
    key.startsWith("pilot-test-") && key.endsWith("-sources") && Boolean(JSON.parse(localStorage.getItem(key)!)[stream])), stream)).toBe(true);
  return url;
}
async function request(phone: Page, url: string, name: string) {
  await phone.goto(url);
  await phone.getByRole("textbox", { name: "Pilot name", exact: true }).fill(name);
  await phone.getByRole("button", { name: "Request wheel", exact: true }).click();
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

test("direct URL requests a named pilot; only acceptance enables steering", async ({ page, context }) => {
  await ground(page);
  const phone = await context.newPage();
  await request(phone, new URL("/controller/", page.url()).href, "Amelia");
  const approval = page.getByRole("dialog", { name: "Pilot requests" });
  await expect(approval).toContainText("Amelia wants to take the wheel.");
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
  const firstUrl = await ground(page), other = await context.newPage();
  await ground(other);
  const phone = await context.newPage();
  await request(phone, new URL("/controller/", firstUrl).href, "Pilot");
  await expect(phone.locator(".pilot-tower-choices button")).toHaveCount(2);
  const id = new URL(firstUrl).searchParams.get("tower")!;
  await phone.getByRole("button", { name: `Ground Control ${id}`, exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Pilot requests" })).toBeVisible();
  await expect(other.getByRole("dialog", { name: "Pilot requests" })).toBeHidden();
});
