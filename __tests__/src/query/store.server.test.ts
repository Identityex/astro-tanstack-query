import { QueryClient } from "@tanstack/query-core";
import { afterEach, expect, it, vi } from "vitest";
import { createInfiniteQuery } from "../../../src/query/infinite";
import { SCOPE_KEY, type RequestScope } from "../../../src/query/scope-reader";
import { createQuery } from "../../../src/query/store";

const holder = globalThis as Record<string, unknown>;
const publish = (scope: RequestScope | undefined) => {
  holder[SCOPE_KEY] = { getStore: () => scope };
};
afterEach(() => {
  delete holder[SCOPE_KEY];
  vi.restoreAllMocks();
});

it("reads a snapshot from the request client without fetching", async () => {
  const queryFn = vi.fn(async () => "fetched");
  const queryClient = new QueryClient();
  await queryClient.prefetchQuery({ queryKey: ["thing"], queryFn: async () => "prefetched" });
  publish({ queryClient, url: new URL("http://x/") });

  const $thing = createQuery({ queryKey: ["thing"], queryFn });
  expect($thing.get().data).toBe("prefetched");
  expect($thing.get().status).toBe("success");
  expect(queryFn).not.toHaveBeenCalled();
});

it("calls subscribe once with the snapshot and never again", async () => {
  const queryClient = new QueryClient();
  publish({ queryClient, url: new URL("http://x/") });
  const $thing = createQuery({ queryKey: ["thing"], queryFn: async () => "x" });
  const listener = vi.fn();
  const stop = $thing.subscribe(listener);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener.mock.calls[0]?.[0]).toMatchObject({ status: "pending" });
  stop();
  expect($thing.listen(() => {})).toBeTypeOf("function");
});

it("returns a pending placeholder and warns once when no scope exists", () => {
  publish(undefined);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const $a = createQuery({ queryKey: ["a"], queryFn: async () => 1 });
  const $b = createQuery({ queryKey: ["b"], queryFn: async () => 2 });
  expect($a.get().isPending).toBe(true);
  expect($b.get().isPending).toBe(true);
  expect(warn).toHaveBeenCalledTimes(1);
});

it("prefetch() uses the request client and an optional server-only fetcher", async () => {
  const queryClient = new QueryClient();
  publish({ queryClient, url: new URL("http://x/") });
  const clientFn = vi.fn(async () => "client");
  const $thing = createQuery({ queryKey: ["thing"], queryFn: clientFn });
  await $thing.prefetch(async () => "server");
  expect(queryClient.getQueryData(["thing"])).toBe("server");
  expect(clientFn).not.toHaveBeenCalled();
});

it("infinite prefetch() uses the request client and an optional server-only fetcher", async () => {
  const queryClient = new QueryClient();
  publish({ queryClient, url: new URL("http://x/") });
  const clientFn = vi.fn(async () => ["client"]);
  const $feed = createInfiniteQuery({
    queryKey: ["feed"],
    queryFn: clientFn,
    initialPageParam: 0,
    getNextPageParam: () => undefined,
  });
  await $feed.prefetch(async ({ pageParam }) => [`server-${pageParam}`]);
  expect(queryClient.getQueryData(["feed"])).toEqual({
    pages: [["server-0"]],
    pageParams: [0],
  });
  expect(clientFn).not.toHaveBeenCalled();
});

it("refetch() is browser-only", () => {
  publish({ queryClient: new QueryClient(), url: new URL("http://x/") });
  const $thing = createQuery({ queryKey: ["thing"], queryFn: async () => "x" });
  expect(() => $thing.refetch()).toThrowError(/browser-only/);
});
