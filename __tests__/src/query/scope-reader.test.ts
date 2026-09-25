import { QueryClient } from "@tanstack/query-core";
import { afterEach, expect, it } from "vitest";
import {
  isServer,
  requestScope,
  SCOPE_KEY,
  type RequestScope,
} from "../../../src/query/scope-reader";

const holder = globalThis as Record<string, unknown>;
afterEach(() => {
  delete holder[SCOPE_KEY];
});

it("reports the server when window is undefined", () => {
  expect(isServer()).toBe(true);
});

it("returns undefined when nothing published a scope", () => {
  expect(requestScope()).toBeUndefined();
});

it("reads the scope published on globalThis", () => {
  const scope: RequestScope = { queryClient: new QueryClient(), url: new URL("http://x/") };
  holder[SCOPE_KEY] = { getStore: () => scope };
  expect(requestScope()).toBe(scope);
});
