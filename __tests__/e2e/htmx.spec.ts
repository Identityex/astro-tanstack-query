import { expect, test } from "@playwright/test";

test("a fresh fragment is served from the cache instead of re-requested", async ({ page }) => {
  let fragmentRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/fragment")) fragmentRequests += 1;
  });
  await page.goto("/htmx");
  // Clicking before the extension is registered sends a plain htmx request the cache never sees.
  await expect(page.locator("body[data-tq-htmx-ready]")).toHaveCount(1);

  const load = page.locator("#load");
  const fragment = page.locator("#frag");
  await load.click();
  await expect(fragment).toContainText(/fragment hit #\d+/);
  // The hit counter lives in the server process, so only its sameness across clicks is asserted.
  const first = await fragment.textContent();

  await load.click();
  await expect(fragment).toHaveText(first ?? "");
  await load.click();
  await expect(fragment).toHaveText(first ?? "");

  expect(fragmentRequests).toBe(1);
});
