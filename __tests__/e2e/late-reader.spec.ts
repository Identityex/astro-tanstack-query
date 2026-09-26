import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// Astro renders the components after an async sibling concurrently, so <QueryState /> can run
// before a later component reads a store. It used to clear the request client as it rendered, and
// that later read then SSR'd "pending" beside state that said "success". Middleware emission is
// the control: it never cleared before the body had streamed.
for (const [name, origin, emit] of [
  ["JSON middleware", "http://127.0.0.1:4331", "middleware"],
  ["devalue component", "http://127.0.0.1:4332", "component"],
] as const) {
  test(`${name} keeps prefetched data for a store read that renders after the state element`, async ({
    page,
    request,
  }) => {
    const id = randomUUID();
    const releaseUrl = `${origin}/api/stream-gate/${id}`;
    const release = async () =>
      (await request.post(releaseUrl, { headers: { Origin: origin } })).status();

    try {
      await page.goto(`${origin}/streamed?id=${id}&emit=${emit}`, { waitUntil: "commit" });
      // The gate exists once <StreamTail> has rendered, a moment after the response has started.
      await expect.poll(release).toBe(204);
      await page.waitForLoadState("domcontentloaded");

      await expect(page.locator("[data-late-thing]")).toHaveText("Late reader: server-prefetched");
      await expect(page.locator("#astro-tq")).toHaveCount(1);
    } finally {
      // A failed assertion must not leave the fixture's streamed response open.
      await release();
    }
  });
}
