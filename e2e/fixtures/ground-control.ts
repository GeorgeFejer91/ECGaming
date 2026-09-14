import { expect, type Page } from "@playwright/test";

export async function nameGroundControl(page: Page, name = "Major Tom") {
  const dialog = page.getByRole("dialog", { name: "Name this Ground Control" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Ground Control callsign" }).fill(name);
  await dialog.getByRole("button", { name: "Transmit callsign" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("body")).not.toHaveClass(/ground-control-identity-pending/);
}

export async function openGroundControl(page: Page, name = "Major Tom") {
  await page.goto("./ground-control/");
  await nameGroundControl(page, name);
}
