import { expect, type Page } from "@playwright/test";

export async function enterPilot(phone: Page, name = "Test Pilot") {
  await phone.getByRole("textbox", { name: "Pilot name", exact: true }).fill(name);
  await phone.getByRole("button", { name: "Take control", exact: true }).click();
  await expect(phone.locator("#pilot-entry")).toBeHidden();
  await expect(phone.locator("#controls")).toBeVisible();
}
