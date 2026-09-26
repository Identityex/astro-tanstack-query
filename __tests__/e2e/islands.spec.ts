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

async function waitForHydration(page: Page): Promise<void> {
  // Astro drops an island's ssr attribute once its framework has taken over the markup. A click
  // that lands before then hits static HTML and is lost.
  await expect(page.locator("astro-island")).not.toHaveCount(0);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
}

// A mismatch never fails an assertion: every framework recovers and only reports it. React's
// production build reports it as a numbered error (418, 419, 422–424) that names neither word, and
// through window.reportError, which Playwright surfaces as a pageerror rather than a console message.
const hydrationReport = /hydrat|mismatch|react\.dev\/errors\/(?:418|419|422|423|424)\b/i;

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

test("every framework hydrates what the server rendered", async ({ page }) => {
  const reports: string[] = [];
  page.on("console", (message) => reports.push(message.text()));
  page.on("pageerror", (error) => reports.push(`${error.name}: ${error.message}`));

  // The islands reading $thing are not prefetched. Hold its response until they have all hydrated:
  // one that hydrates after the data arrives renders it against HTML that says "pending", whatever
  // the bridge does, and this test is about the bridge's server read matching its first browser read.
  let releaseThing = (): void => {};
  const hydrated = new Promise<void>((resolve) => {
    releaseThing = resolve;
  });
  await page.route("**/api/thing", async (route) => {
    await hydrated;
    await route.continue();
  });

  await page.goto("/");
  await waitForHydration(page);
  releaseThing();
  await expectEveryIslandToShow(page, await readValue(page.locator('[data-island="react"]')));
  await expect(page.locator('[data-island="solid-pager"]')).toContainText(
    "page 1: post 1a, post 1b",
  );

  expect(reports.filter((report) => hydrationReport.test(report))).toEqual([]);
});

test("a Solid island that changes keys leaves the previous key's cache entry alone", async ({
  page,
}) => {
  const pager = page.locator('[data-island="solid-pager"]');
  const firstPage = page.locator('[data-island="svelte-first-page"]');

  await page.goto("/");
  await waitForHydration(page);
  await expect(pager).toContainText("page 1: post 1a, post 1b");

  await pager.getByRole("button", { name: "next page" }).click();
  await expect(pager).toContainText("page 2: post 2a, post 2b");

  // Only now does the Svelte island render page 1, so it reads that cache entry after the pager has
  // moved past it: @nanostores/solid's reconcile would have written page 2 into it by then.
  await firstPage.getByRole("button", { name: "show page 1" }).click();
  await expect(firstPage).toContainText("page 1: post 1a, post 1b");

  // Returning is served from the same entry (staleTime: Infinity), with nothing refetched over it.
  await pager.getByRole("button", { name: "previous page" }).click();
  await expect(pager).toContainText("page 1: post 1a, post 1b");
});
