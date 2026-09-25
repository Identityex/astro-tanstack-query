// @vitest-environment happy-dom
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
