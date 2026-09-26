import { QueryClient } from "@tanstack/query-core";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  // The browser will fetch this on mount, so the placeholder already says it is loading.
  expect($a.get().isLoading).toBe(true);
  expect(warn).toHaveBeenCalledTimes(1);
});

describe("the snapshot matches the first browser read", () => {
  // The browser's first read mounts the store, which subscribes the observer and starts any
  // fetch-on-mount synchronously. The server must report that same state without starting it.
  const loading = { isPending: true, isLoading: true, isFetching: true, fetchStatus: "fetching" };
  const idle = { isLoading: false, isFetching: false, fetchStatus: "idle" };

  // The middleware's request client carries ssr.staleTime, so a prefetch is fresh by default.
  const requestClient = () =>
    new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } });

  // D5: the snapshot may report a fetch, but it must never start one.
  async function expectNoFetch(
    queryClient: QueryClient,
    queryKey: readonly unknown[],
    queryFn: () => unknown,
  ) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queryFn).not.toHaveBeenCalled();
    expect(queryClient.getQueryCache().find({ queryKey })?.state.fetchStatus).toBe("idle");
  }

  it("reports loading for a query that was not prefetched", async () => {
    const queryClient = requestClient();
    publish({ queryClient, url: new URL("http://x/") });
    const queryFn = vi.fn(async () => "x");
    const $thing = createQuery({ queryKey: ["thing"], queryFn });
    expect($thing.get()).toMatchObject(loading);
    await expectNoFetch(queryClient, ["thing"], queryFn);
  });

  it("reports a background fetch for a stale prefetch", async () => {
    const queryClient = requestClient();
    await queryClient.prefetchQuery({ queryKey: ["thing"], queryFn: async () => "x" });
    publish({ queryClient, url: new URL("http://x/") });
    const queryFn = vi.fn(async () => "x");
    const $thing = createQuery({ queryKey: ["thing"], queryFn, staleTime: 0 });
    expect($thing.get()).toMatchObject({
      status: "success",
      isPending: false,
      isLoading: false,
      isFetching: true,
      fetchStatus: "fetching",
    });
    await expectNoFetch(queryClient, ["thing"], queryFn);
  });

  it("reports idle for a fresh prefetch", async () => {
    const queryClient = requestClient();
    await queryClient.prefetchQuery({ queryKey: ["thing"], queryFn: async () => "x" });
    publish({ queryClient, url: new URL("http://x/") });
    const queryFn = vi.fn(async () => "x");
    const $thing = createQuery({ queryKey: ["thing"], queryFn });
    expect($thing.get()).toMatchObject({ status: "success", isPending: false, ...idle });
    await expectNoFetch(queryClient, ["thing"], queryFn);
  });

  it("reports idle for a disabled query", async () => {
    const queryClient = requestClient();
    publish({ queryClient, url: new URL("http://x/") });
    const queryFn = vi.fn(async () => "x");
    const $thing = createQuery({ queryKey: ["thing"], queryFn, enabled: false });
    expect($thing.get()).toMatchObject({ status: "pending", isPending: true, ...idle });
    await expectNoFetch(queryClient, ["thing"], queryFn);
  });

  it("reports loading, not the error, for a prefetch that failed", async () => {
    // Errored queries are not dehydrated, so the browser starts from nothing and fetches.
    const queryClient = requestClient();
    await queryClient.prefetchQuery({
      queryKey: ["thing"],
      queryFn: async () => {
        throw new Error("down");
      },
      retry: false,
    });
    publish({ queryClient, url: new URL("http://x/") });
    const queryFn = vi.fn(async () => "x");
    const $thing = createQuery({ queryKey: ["thing"], queryFn });
    expect($thing.get()).toMatchObject({ status: "pending", error: null, ...loading });
    await expectNoFetch(queryClient, ["thing"], queryFn);
  });

  it("reports loading for an infinite query that was not prefetched", async () => {
    const queryClient = requestClient();
    publish({ queryClient, url: new URL("http://x/") });
    const queryFn = vi.fn(async () => ["x"]);
    const $feed = createInfiniteQuery({
      queryKey: ["feed"],
      queryFn,
      initialPageParam: 0,
      getNextPageParam: () => undefined,
    });
    expect($feed.get()).toMatchObject({ ...loading, isFetchingNextPage: false });
    await expectNoFetch(queryClient, ["feed"], queryFn);
  });
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
