import { expect, test } from "@playwright/test";

test("an Astro Action mutates, invalidates and surfaces its ActionError code", async ({ page }) => {
  await page.goto("/actions");

  await page.getByRole("button", { name: "add milk" }).click();
  await expect(page.locator("[data-todos]")).toContainText("milk");

  await page.getByRole("button", { name: "add boom" }).click();
  await expect(page.locator("[data-error]")).toHaveText("BAD_REQUEST");
});
