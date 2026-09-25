import { expect, test } from "@playwright/test";

test("the cache survives a client-side navigation", async ({ page }) => {
  let apiRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/thing")) apiRequests += 1;
  });
  await page.goto("/transitions/a");
  await expect(page.locator('[data-island="react"]')).toContainText("hello #");
  expect(apiRequests).toBe(1);
  await page.locator("#to-b").click();
  await expect(page.getByRole("heading", { name: "Page B" })).toBeVisible();
  await expect(page.locator('[data-island="react"]')).toContainText("hello #");
  expect(apiRequests).toBe(1);
});
