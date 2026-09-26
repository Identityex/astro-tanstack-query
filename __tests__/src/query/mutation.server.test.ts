import { QueryClient } from "@tanstack/query-core";
import { afterEach, expect, it, vi } from "vitest";
import { createMutation, type MutationStore } from "../../../src/query/mutation";
import { SCOPE_KEY, type RequestScope } from "../../../src/query/scope-reader";

const holder = globalThis as Record<string, unknown>;
const publish = (scope: RequestScope | undefined) => {
  holder[SCOPE_KEY] = { getStore: () => scope };
};
afterEach(() => {
  delete holder[SCOPE_KEY];
});

// mutateAsync throws synchronously too, like createQuery's refetch(): the misuse is reported at
// the frontmatter line that made it, not as an unhandled rejection.
const calls: [string, (store: MutationStore<number, Error, number>) => unknown][] = [
  ["mutate", (store) => store.mutate(1)],
  ["mutateAsync", (store) => store.mutateAsync(1)],
  ["reset", (store) => store.reset()],
];

it.each(calls)("%s() on the server throws a browser-only error naming it", (method, call) => {
  publish({ queryClient: new QueryClient(), url: new URL("http://x/") });
  const mutationFn = vi.fn(async (n: number) => n);
  const $save = createMutation<number, Error, number>({ mutationFn });

  expect(() => call($save)).toThrowError(
    `[astro-tanstack-query] ${method}() is browser-only; mutations never run during SSR.`,
  );
  expect(mutationFn).not.toHaveBeenCalled();
});
