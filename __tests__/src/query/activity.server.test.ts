import { QueryClient } from "@tanstack/query-core";
import { afterEach, expect, it, vi } from "vitest";
import { createIsFetching, createIsMutating } from "../../../src/query/activity";
import { SCOPE_KEY, type RequestScope } from "../../../src/query/scope-reader";

const holder = globalThis as Record<string, unknown>;
const publish = (scope: RequestScope | undefined) => {
  holder[SCOPE_KEY] = { getStore: () => scope };
};
afterEach(() => {
  delete holder[SCOPE_KEY];
  vi.restoreAllMocks();
});

it("reads 0 inside a request without subscribing to the request client", async () => {
  const queryClient = new QueryClient();
  publish({ queryClient, url: new URL("http://x/") });
  // A fetch in flight on the request client must still read 0: the atom never looks at it (D4).
  void queryClient.prefetchQuery({ queryKey: ["slow"], queryFn: () => new Promise(() => {}) });
  expect(queryClient.isFetching()).toBe(1);

  const $fetching = createIsFetching();
  const $mutating = createIsMutating();
  const fetching: number[] = [];
  const stop = $fetching.subscribe((count) => fetching.push(count));

  expect($fetching.get()).toBe(0);
  expect($mutating.get()).toBe(0);
  expect(fetching).toEqual([0]);
  expect(queryClient.getQueryCache().hasListeners()).toBe(false);
  expect(queryClient.getMutationCache().hasListeners()).toBe(false);
  stop();
});

it("reads 0 outside a request without throwing or warning", () => {
  publish(undefined);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(createIsFetching({ queryKey: ["a"] }).get()).toBe(0);
  expect(createIsMutating({ mutationKey: ["a"] }).get()).toBe(0);
  // No scope lookup at all, so not even the pending-placeholder warning the query stores give.
  expect(warn).not.toHaveBeenCalled();
});
