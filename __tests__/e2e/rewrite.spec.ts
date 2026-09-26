import { expect, test } from "@playwright/test";

// Astro.rewrite() runs the middleware again from inside the page that called it. Each pass used
// to make its own request client: under middleware emission both wrapped the response, so the
// page carried two #astro-tq elements and the browser read only the first, which lacked the
// calling page's prefetches; under component emission <QueryState /> never saw them at all.
for (const [name, origin, emit] of [
  ["JSON middleware", "http://127.0.0.1:4331", "middleware"],
  ["devalue component", "http://127.0.0.1:4332", "component"],
] as const) {
  test(`${name} writes one state element holding both pages' prefetches across a rewrite`, async ({
    request,
  }) => {
    const response = await request.get(`${origin}/rewrite/from?emit=${emit}`);
    expect(response.status()).toBe(200);
    const html = await response.text();

    const states = [
      ...html.matchAll(/<script type="application\/json" id="astro-tq"[^>]*>(.*?)<\/script>/gs),
    ].map(([, state]) => state);
    expect(states).toHaveLength(1);
    expect(states[0]).toContain("prefetched before the rewrite");
    expect(states[0]).toContain("prefetched after the rewrite");
    // The rewritten pass still gets a scope of its own, so absoluteUrl() follows the rewrite.
    expect(html).toMatch(/<p data-scope-path[^>]*>\/rewrite\/target<\/p>/);
  });
}
