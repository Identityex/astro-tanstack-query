import { expect, test } from "@playwright/test";

// A value the serializer cannot write used to error the body stream after the 200 and most of the
// page had gone out; Astro's node adapter then wrote "Internal server error" into the page and
// destroyed the socket. The query that holds it is now left out, and only that one.
for (const [name, origin, emit] of [
  ["JSON middleware", "http://127.0.0.1:4331", "middleware"],
  ["devalue component", "http://127.0.0.1:4332", "component"],
] as const) {
  test(`${name} finishes a page whose prefetch holds an unserializable value`, async ({
    request,
  }) => {
    const response = await request.get(`${origin}/unserializable?emit=${emit}`);
    expect(response.status()).toBe(200);
    const html = await response.text();

    expect(html).not.toContain("Internal server error");
    expect(html).toContain("The page finished.");
    expect(html.trimEnd()).toMatch(/<\/html>$/);
    const state = /<script type="application\/json" id="astro-tq"[^>]*>(.*?)<\/script>/s.exec(
      html,
    )?.[1];
    expect(state).toContain("server-prefetched");
    expect(state).not.toContain("ledger");
  });
}
