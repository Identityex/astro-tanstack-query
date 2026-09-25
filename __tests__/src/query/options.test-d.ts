import type { InfiniteData } from "@tanstack/query-core";
import { expectTypeOf, it } from "vitest";
import { getQueryClient } from "../../../src/query/client";
import { family } from "../../../src/query/family";
import { createInfiniteQuery } from "../../../src/query/infinite";
import { createQuery } from "../../../src/query/store";
import { queryOptions } from "../../../src/query/options";

interface Todo {
  id: number;
}

it("infers the data type through queryOptions", () => {
  const options = queryOptions({ queryKey: ["n"], queryFn: async () => 42 });
  const $n = createQuery(options);
  expectTypeOf($n.get().data).toEqualTypeOf<number | undefined>();
});

// Only the types are under test: these bodies are never called, so no query client is needed.
it("tags a store's queryKey so the query client infers the cached data", () => {
  const $todos = createQuery({ queryKey: ["todos"], queryFn: async (): Promise<Todo[]> => [] });
  const $todo = family((id: number) =>
    queryOptions({ queryKey: ["todo", id], queryFn: async (): Promise<Todo> => ({ id }) }),
  );
  const $pages = createInfiniteQuery({
    queryKey: ["pages"],
    queryFn: async ({ pageParam }): Promise<Todo[]> => [{ id: pageParam }],
    initialPageParam: 0,
    getNextPageParam: (last) => last[0]?.id,
  });
  const read = () => ({
    todos: getQueryClient().getQueryData($todos.options.queryKey),
    todo: getQueryClient().getQueryData($todo(1).options.queryKey),
    pages: getQueryClient().getQueryData($pages.options.queryKey),
  });
  expectTypeOf<ReturnType<typeof read>>().toEqualTypeOf<{
    todos: Todo[] | undefined;
    todo: Todo | undefined;
    pages: InfiniteData<Todo[], number> | undefined;
  }>();
});

it("accepts refetch, invalidate and server prefetch arguments", () => {
  const $todos = createQuery({ queryKey: ["todos"], queryFn: async (): Promise<Todo[]> => [] });
  const $pages = createInfiniteQuery({
    queryKey: ["pages"],
    queryFn: async ({ pageParam }): Promise<Todo[]> => [{ id: pageParam }],
    initialPageParam: 0,
    getNextPageParam: (last) => last[0]?.id,
  });
  const use = async () => {
    await $todos.refetch({ throwOnError: true });
    await $todos.invalidate({ cancelRefetch: false });
    await $pages.refetch({ throwOnError: true });
    await $pages.invalidate({ cancelRefetch: false });
    await $pages.prefetch(async ({ pageParam }) => [{ id: pageParam }]);
  };
  expectTypeOf(use).returns.resolves.toBeVoid();
  // @ts-expect-error: a server-only fetcher must return the query's page type.
  void (() => $pages.prefetch(async () => "not a page"));
});
