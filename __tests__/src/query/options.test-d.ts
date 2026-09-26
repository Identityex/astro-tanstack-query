import type { InfiniteData } from "@tanstack/query-core";
import { atom, computed } from "nanostores";
import { expectTypeOf, it } from "vitest";
import { getQueryClient } from "../../../src/query/client";
import { family } from "../../../src/query/family";
import { createInfiniteQuery } from "../../../src/query/infinite";
import { createMutation } from "../../../src/query/mutation";
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

declare function fetchTodos(): Promise<Todo[]>;

it("narrows data when initialData is defined", () => {
  const $inline = createQuery({ queryKey: ["todos"], queryFn: fetchTodos, initialData: [] });
  expectTypeOf($inline.get().data).toEqualTypeOf<Todo[]>();
  const $lazy = createQuery({
    queryKey: ["todos"],
    queryFn: fetchTodos,
    initialData: () => [] as Todo[],
  });
  expectTypeOf($lazy.get().data).toEqualTypeOf<Todo[]>();
  const $viaOptions = createQuery(
    queryOptions({ queryKey: ["todos"], queryFn: fetchTodos, initialData: [] }),
  );
  expectTypeOf($viaOptions.get().data).toEqualTypeOf<Todo[]>();
  const $page = atom(1);
  const $reactive = createQuery(
    computed($page, (page) => ({
      queryKey: ["n", page],
      queryFn: async () => page,
      initialData: 0,
    })),
  );
  expectTypeOf($reactive.get().data).toEqualTypeOf<number>();
  const $selected = createQuery({
    queryKey: ["todos"],
    queryFn: fetchTodos,
    initialData: [],
    select: (todos) => todos.length,
  });
  expectTypeOf($selected.get().data).toEqualTypeOf<number>();
});

it("leaves data optional when initialData may be undefined or is absent", () => {
  const $maybe = createQuery({
    queryKey: ["todos"],
    queryFn: fetchTodos,
    initialData: (): Todo[] | undefined => undefined,
  });
  expectTypeOf($maybe.get().data).toEqualTypeOf<Todo[] | undefined>();
  const $explicit = createQuery({
    queryKey: ["todos"],
    queryFn: fetchTodos,
    initialData: undefined,
  });
  expectTypeOf($explicit.get().data).toEqualTypeOf<Todo[] | undefined>();
  const $plain = createQuery({ queryKey: ["todos"], queryFn: fetchTodos });
  expectTypeOf($plain.get().data).toEqualTypeOf<Todo[] | undefined>();
  const result = $plain.get();
  if (result.isSuccess) expectTypeOf(result.data).toEqualTypeOf<Todo[]>();
});

it("narrows family members and infinite queries seeded with initialData", () => {
  const $inline = family((id: number) => ({
    queryKey: ["todo", id],
    queryFn: async () => ({ id }),
    initialData: { id },
  }));
  expectTypeOf($inline(1).get().data).toEqualTypeOf<Todo>();
  const $wrapped = family((id: number) =>
    queryOptions({
      queryKey: ["todo", id],
      queryFn: async (): Promise<Todo> => ({ id }),
      initialData: { id },
    }),
  );
  expectTypeOf($wrapped(1).get().data).toEqualTypeOf<Todo>();
  const $unseeded = family((id: number) => ({
    queryKey: ["todo", id],
    queryFn: async () => ({ id }),
  }));
  expectTypeOf($unseeded(1).get().data).toEqualTypeOf<{ id: number } | undefined>();

  const $pages = createInfiniteQuery({
    queryKey: ["pages"],
    queryFn: async ({ pageParam }): Promise<Todo[]> => [{ id: pageParam }],
    initialPageParam: 0,
    getNextPageParam: (last) => last[0]?.id,
    initialData: { pages: [[{ id: 0 }]], pageParams: [0] },
  });
  expectTypeOf($pages.get().data).toEqualTypeOf<InfiniteData<Todo[]>>();
  expectTypeOf($pages.get().data.pages).toEqualTypeOf<Todo[][]>();
  const $unseededPages = createInfiniteQuery({
    queryKey: ["pages"],
    queryFn: async ({ pageParam }): Promise<Todo[]> => [{ id: pageParam }],
    initialPageParam: 0,
    getNextPageParam: (last) => last[0]?.id,
  });
  expectTypeOf($unseededPages.get().data).toEqualTypeOf<InfiniteData<Todo[]> | undefined>();
});

it("still checks an explicit data type against queryFn and initialData", () => {
  // @ts-expect-error: queryFn must return the declared data type.
  void createQuery<Todo[]>({ queryKey: ["todos"], queryFn: async () => 5, initialData: [] });
  // @ts-expect-error: initialData must be the declared data type.
  void createQuery<Todo[]>({ queryKey: ["todos"], queryFn: fetchTodos, initialData: 5 });
});

// Both need an error boundary or Suspense, which belong to a framework adapter (D2). Here
// `throwOnError` would do nothing and `suspense` would only change when an errored query refetches.
it("rejects throwOnError and suspense", () => {
  // @ts-expect-error: no error boundary exists to throw to.
  void createQuery({ queryKey: ["todos"], queryFn: fetchTodos, throwOnError: true });
  // @ts-expect-error: nothing suspends; the option would only change refetching on a key change.
  void createQuery({ queryKey: ["todos"], queryFn: fetchTodos, suspense: true });
  // @ts-expect-error: queryOptions takes the same options as createQuery.
  void queryOptions({ queryKey: ["todos"], queryFn: fetchTodos, throwOnError: true });
  const pages = {
    queryKey: ["pages"],
    queryFn: fetchTodos,
    initialPageParam: 0,
    getNextPageParam: () => 1,
  };
  // @ts-expect-error: infinite queries do not throw either.
  void createInfiniteQuery({ ...pages, throwOnError: true });
  // @ts-expect-error: infinite queries do not suspend either.
  void createInfiniteQuery({ ...pages, suspense: true });
  // @ts-expect-error: a mutation's error is its result's `error`, not a throw.
  void createMutation({ mutationFn: async (text: string) => text, throwOnError: true });
});
