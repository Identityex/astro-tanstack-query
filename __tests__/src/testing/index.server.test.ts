import { QueryClient } from "@tanstack/query-core";
import { expect, it, vi } from "vitest";
import { absoluteUrl, createQuery, getQueryClient } from "../../../src/query/index";
import { runInTestRequest } from "../../../src/testing/index";

/**
 * The server-shaped half of the same claim, in the default node environment: no DOM, so every
 * store takes the request path and needs the scope the middleware would have established.
 */

it("gives frontmatter-shaped code the request scope the middleware would have", async () => {
  const queryFn = vi.fn(async () => "still loading");

  await runInTestRequest(async ({ queryClient }) => {
    expect(getQueryClient()).toBe(queryClient);
    expect(absoluteUrl("/api/status")).toBe("http://localhost:4321/api/status");

    const $status = createQuery({ queryKey: ["status"], queryFn });
    await $status.prefetch();

    // A server store is a snapshot of the request client, so the prefetched value reads straight
    // back — and reading it does not fetch a second time.
    expect($status.get().data).toBe("still loading");
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});

it("takes the page's url and a client of the caller's own", () => {
  const queryClient = new QueryClient();
  const seen = runInTestRequest((scope) => scope, {
    url: "https://example.com/posts/hello-world",
    queryClient,
  });
  expect(seen.url.href).toBe("https://example.com/posts/hello-world");
  expect(seen.queryClient).toBe(queryClient);
});

it("leaves no scope behind for the next test", () => {
  runInTestRequest(() => {});
  expect(() => getQueryClient()).toThrow(/outside a request/);
});

it("refuses a DOM-shaped test, where the scope would be silently ignored", () => {
  vi.stubGlobal("window", {});
  expect(() => runInTestRequest(() => {})).toThrow(/window/);
  vi.unstubAllGlobals();
});
