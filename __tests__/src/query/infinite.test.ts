// @vitest-environment happy-dom
import type { InfiniteData, InfiniteQueryObserverOptions } from "@tanstack/query-core";
import { atom } from "nanostores";
import { afterEach, expect, it, vi } from "vitest";
import { resetPageClientForTests } from "../../../src/query/client";
import { createInfiniteQuery } from "../../../src/query/infinite";

afterEach(() => resetPageClientForTests());

it("pages through an infinite query", async () => {
  const $pages = createInfiniteQuery({
    queryKey: ["pages"],
    queryFn: async ({ pageParam }) => ({ items: [pageParam], next: pageParam + 1 }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.next < 3 ? last.next : undefined),
  });
  $pages.subscribe(() => {});
  await vi.waitFor(() => expect($pages.get().data?.pages).toHaveLength(1));
  await $pages.get().fetchNextPage();
  await vi.waitFor(() => expect($pages.get().data?.pages).toHaveLength(2));
  expect($pages.get().hasNextPage).toBe(true);
  expect($pages.key).toBe('["pages"]');
});

it("refetch() on a never-mounted store fetches the options store's current key", async () => {
  type Options = InfiniteQueryObserverOptions<
    string,
    Error,
    InfiniteData<string, number>,
    unknown[],
    number
  >;
  const page = (id: number): Options => ({
    queryKey: ["feed", id],
    queryFn: async () => `feed-${id}`,
    initialPageParam: 0,
    getNextPageParam: () => undefined,
  });
  const $options = atom<Options>(page(1));
  const $feed = createInfiniteQuery($options);
  // The first refetch is what creates the observer, with key 1.
  expect((await $feed.refetch()).data?.pages).toEqual(["feed-1"]);
  $options.set(page(2));
  expect($feed.key).toBe('["feed",2]');
  expect((await $feed.refetch()).data?.pages).toEqual(["feed-2"]);
});

it("forwards refetch() and invalidate() options", async () => {
  let fail = false;
  const $feed = createInfiniteQuery({
    queryKey: ["broken-feed"],
    queryFn: async () => {
      if (fail) throw new Error("down");
      return "page";
    },
    initialPageParam: 0,
    getNextPageParam: () => undefined,
    retry: false,
    staleTime: 60_000,
  });
  const stop = $feed.subscribe(() => {});
  try {
    await vi.waitFor(() => expect($feed.get().data?.pages).toEqual(["page"]));
    fail = true;
    await expect($feed.invalidate({ throwOnError: true })).rejects.toThrow("down");
    await expect($feed.refetch({ throwOnError: true })).rejects.toThrow("down");
  } finally {
    stop();
  }
});
