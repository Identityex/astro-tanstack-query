import { QueryClient } from "@tanstack/query-core";
import { afterEach, expect, it } from "vitest";
import { SCOPE_KEY } from "../../../src/query/scope-reader";
import { absoluteUrl } from "../../../src/query/url";

const holder = globalThis as Record<string, unknown>;
afterEach(() => delete holder[SCOPE_KEY]);

it("resolves against the request URL on the server", () => {
  holder[SCOPE_KEY] = {
    getStore: () => ({
      queryClient: new QueryClient(),
      url: new URL("https://example.com/docs/intro"),
    }),
  };
  expect(absoluteUrl("/api/thing")).toBe("https://example.com/api/thing");
});

it("throws outside a request on the server", () => {
  expect(() => absoluteUrl("/api/thing")).toThrowError(/needs a request/);
});
