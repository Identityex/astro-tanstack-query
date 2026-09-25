import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

for (const [name, origin, emit] of [
  ["JSON middleware", "http://127.0.0.1:4331", "middleware"],
  ["devalue component", "http://127.0.0.1:4332", "component"],
] as const) {
  test(`${name} preserves prefetched content while the state element is still streaming`, async ({
    page,
    request,
  }) => {
    const id = randomUUID();
    const releaseUrl = `${origin}/api/stream-gate/${id}`;
    const apiRequests: string[] = [];
    const pendingScripts = new Set<string>();
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/thing") apiRequests.push(request.url());
      if (request.resourceType() === "script") pendingScripts.add(request.url());
    });
    page.on("requestfinished", (request) => pendingScripts.delete(request.url()));
    page.on("requestfailed", (request) => pendingScripts.delete(request.url()));

    await page.addInitScript(() => {
      let sawPrefetched = false;
      new MutationObserver(() => {
        const content = document.querySelector('[data-island="svelte"]');
        if (!content) return;
        if (content.textContent?.includes("server-prefetched")) {
          sawPrefetched = true;
        } else if (sawPrefetched) {
          document.documentElement.setAttribute("data-stream-content-replaced", "true");
        }
      }).observe(document, { childList: true, subtree: true, characterData: true });
    });

    try {
      await page.goto(`${origin}/streamed?id=${id}&emit=${emit}`, { waitUntil: "commit" });
      const island = page.locator("astro-island");
      await expect(island).toContainText("server-prefetched");

      // Let the actual island and renderer downloads finish while the HTML parser stays blocked.
      await page.waitForFunction(() => {
        const island = document.querySelector("astro-island");
        return ["component-url", "renderer-url"].every((attribute) => {
          const url = island?.getAttribute(attribute);
          return url && performance.getEntriesByName(new URL(url, location.href).href).length > 0;
        });
      });
      await expect.poll(() => pendingScripts.size).toBe(0);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );
      await expect.poll(() => pendingScripts.size).toBe(0);

      expect(await page.evaluate(() => document.readyState)).toBe("loading");
      await expect(page.locator("#astro-tq")).toHaveCount(0);
      await expect(island).toHaveAttribute("ssr", "");
      await expect(island).toContainText("server-prefetched");
      expect(apiRequests).toEqual([]);

      expect((await request.post(releaseUrl, { headers: { Origin: origin } })).status()).toBe(204);
      await page.waitForLoadState("domcontentloaded");
      await expect(page.locator("[data-stream-tail]")).toBeVisible();
      await expect(island).not.toHaveAttribute("ssr");
      await expect(island).toContainText("server-prefetched");
      await expect(page.locator("#astro-tq")).toHaveCount(1);
      await expect(page.locator("html")).not.toHaveAttribute("data-stream-content-replaced");
      expect(apiRequests).toEqual([]);
    } finally {
      // A failed assertion must not leave the fixture's streamed response open.
      await request.post(releaseUrl, { headers: { Origin: origin } });
    }
  });
}
