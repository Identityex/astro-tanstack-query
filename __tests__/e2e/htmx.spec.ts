import { expect, test } from "@playwright/test";

test("a fresh fragment is served from the cache instead of re-requested", async ({ page }) => {
  let fragmentRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/fragment")) fragmentRequests += 1;
  });
  await page.goto("/htmx");

  await page.locator("#load").click();
  await expect(page.locator("#frag")).toContainText("fragment hit #1");

  await page.locator("#load").click();
  await expect(page.locator("#frag")).toContainText("fragment hit #1");

  await page.locator("#load").click();
  await expect(page.locator("#frag")).toContainText("fragment hit #1");

  expect(fragmentRequests).toBe(1);
});
