import { expect, test, type Locator, type Page } from "@playwright/test";

const islands = ["react", "svelte", "vue", "solid", "vanilla"] as const;

// Every island renders "<Framework>: hello #N", where N comes from a module-scope counter in
// example/src/pages/api/thing.ts — one counter for the whole run. Playwright runs spec files in
// parallel, so a spec that loads the same island (e.g. transitions.spec.ts) bumps that counter
// between this spec's assertions. The absolute number was never this test's claim; agreement
// across the five consumers is, so every assertion below is relative to whatever value the React
// island settles on.
const anyValue = /hello #\d+/;

// The trailing guard is load-bearing: a bare "hello #1" is a substring of "hello #10", which would
// let a stale island pass for a fresh one — and would let the post-invalidate wait below finish
// before the value actually changed. No character in "hello #N" is regex-special.
const showing = (value: string) => new RegExp(`${value}(?!\\d)`);

async function readValue(react: Locator): Promise<string> {
  // Waiting for a real value first is what stops "wait until it changes" from passing vacuously
  // against an island that never rendered at all.
  await expect(react).toContainText(anyValue);
  const text = (await react.textContent()) ?? "";
  const value = text.match(anyValue)?.[0];
  if (!value) throw new Error(`the React island stopped showing a value: "${text}"`);
  return value;
}

async function expectEveryIslandToShow(page: Page, value: string): Promise<void> {
  for (const island of islands) {
    await expect(page.locator(`[data-island="${island}"]`)).toContainText(showing(value));
  }
}

test("five consumers across four frameworks share one cache", async ({ page }) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/thing")) apiRequests.push(request.url());
  });
  const react = page.locator('[data-island="react"]');

  await page.goto("/");
  const loaded = await readValue(react);
  await expectEveryIslandToShow(page, loaded);
  expect(apiRequests).toHaveLength(1);

  await page.getByRole("button", { name: "invalidate" }).click();
  await expect(react).not.toContainText(showing(loaded));
  const refetched = await readValue(react);
  expect(refetched).not.toBe(loaded);
  await expectEveryIslandToShow(page, refetched);
  expect(apiRequests).toHaveLength(2);
});
