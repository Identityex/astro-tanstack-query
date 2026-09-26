import { expect, test } from "@playwright/test";

// A server:defer component renders in a request of its own, as a fragment Astro inserts into the
// page once it arrives. Its prefetch used to be dropped with every other fragment's, so an island
// inside it hydrated against an empty cache: React client-rendered it "pending" over server HTML
// that showed data, then fetched the data again. On 4332 (emit: "component") the state comes from
// a <QueryState /> inside the deferred component; on 4331 the middleware writes it.
for (const [name, origin, emit] of [
  ["JSON middleware", "http://127.0.0.1:4331", "middleware"],
  ["devalue component", "http://127.0.0.1:4332", "component"],
] as const) {
  for (const [where, search] of [
    // The page client exists before the island arrives: its observer hydrates the island's state.
    ["beside a page island", ""],
    // The island's own store read creates the page client, which hydrates what is already there.
    ["as the page's only island", "&alone"],
  ] as const) {
    test(`${name} carries a server island's prefetch to an island inside it, ${where}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        // A missing favicon is not this test's concern.
        if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
          errors.push(message.text());
        }
      });
      const browserFetches: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("/api/deferred-thing")) browserFetches.push(request.url());
      });

      await page.goto(`${origin}/server-island?emit=${emit}${search}`);

      const island = page.locator('[data-island="deferred"]');
      // Set once hydration has committed, from what the island's first browser render showed.
      await expect(island).toHaveAttribute("data-hydrated-with", "prefetched-in-the-island");
      await expect(island).toHaveText("Deferred: prefetched-in-the-island");
      expect(browserFetches).toEqual([]);
      // A hydration mismatch reaches the page as React's (minified) recoverable error.
      expect(errors).toEqual([]);
      // The island's element has no id, so the page's own state is still the one #astro-tq, and
      // the page client has drained it.
      await expect(page.locator("#astro-tq")).toHaveCount(1);
      await expect(page.locator("script[data-serializer]:not([id])")).toHaveCount(1);
      await expect(page.locator("script.astro-tq")).toHaveCount(0);
    });
  }
}
