// @vitest-environment happy-dom
import type { ActionClient, ActionErrorCode, SafeResult } from "astro:actions";
import { afterEach, expect, it, vi } from "vitest";
import { getQueryClient, resetPageClientForTests } from "../../../src/query/client";
import { family } from "../../../src/query/family";
import { ActionError } from "astro:actions";
import {
  actionMutation,
  actionQuery,
  actionQueryOptions,
  isActionError,
} from "../../../src/actions/index";

afterEach(() => resetPageClientForTests());

// Structurally an `ActionError`: the `astro:actions` stub these tests run against has no classes.
class FakeActionError extends Error {
  type = "AstroActionError";
  code: ActionErrorCode = "BAD_REQUEST";
  status = 400;
}

// Typed as the ActionClient Astro gives an Action without an input schema, so every call below is
// checked against Astro's real types rather than a look-alike.
function fakeAction<I, O>(
  name: string,
  handler: (input: I) => Promise<O>,
): ActionClient<O, undefined, undefined> {
  const call = async (input: I): Promise<SafeResult<never, Awaited<O>>> => {
    try {
      return { data: await handler(input), error: undefined };
    } catch (error) {
      if (error instanceof FakeActionError) return { data: undefined, error };
      throw error;
    }
  };
  // A function's own `name` is non-writable, so Object.assign() throws on it; getActionPath()
  // reads `name` to build the action path, so it has to be set the only way that works.
  Object.defineProperty(call, "name", { value: name, writable: false, configurable: true });
  const orThrow = async (input: I): Promise<Awaited<O>> => await handler(input);
  return Object.assign(call, { orThrow });
}

it("actionMutation resolves data and types errors", async () => {
  const add = fakeAction("add", async (n: number) => {
    if (n < 0) throw new FakeActionError("negative");
    return n + 1;
  });
  const $add = actionMutation(add);
  $add.subscribe(() => {});
  await expect($add.mutateAsync(1)).resolves.toBe(2);
  await expect($add.mutateAsync(-1)).rejects.toBeInstanceOf(FakeActionError);
  await vi.waitFor(() => expect($add.get().error).toBeInstanceOf(FakeActionError));
});

it("actionMutation fires per-call callbacks without a subscriber", async () => {
  const add = fakeAction("add", async (n: number) => n + 1);
  const $add = actionMutation(add);
  const onSuccess = vi.fn();
  await $add.mutateAsync(1, { onSuccess });
  expect(onSuccess).toHaveBeenCalledTimes(1);
  expect(onSuccess.mock.calls[0]?.[0]).toBe(2);
});

it("actionQuery keys by action path and input and fetches through orThrow", async () => {
  const list = fakeAction("list", async (input: { page: number }) => [`item-${input.page}`]);
  const $list = actionQuery(list, { page: 2 });
  expect($list.key).toBe('["action","/_actions/list",{"page":2}]');
  $list.subscribe(() => {});
  await vi.waitFor(() => expect($list.get().data).toEqual(["item-2"]));
});

it("actionQuery calls an Action that takes no input without one", async () => {
  const orThrow = vi.fn(async () => ["milk"]);
  const $todos = actionQuery(fakeAction("todos", orThrow));
  expect($todos.key).toBe('["action","/_actions/todos",null]');
  $todos.subscribe(() => {});
  await vi.waitFor(() => expect($todos.get().data).toEqual(["milk"]));
  expect(orThrow).toHaveBeenCalledWith(undefined);
});

it("actionQueryOptions feeds the query client and family with the same key as actionQuery", async () => {
  const list = fakeAction("list", async (input: { page: number }) => [`item-${input.page}`]);
  const options = actionQueryOptions(list, { page: 3 });
  expect(options.queryKey).toEqual(["action", "/_actions/list", { page: 3 }]);
  await expect(getQueryClient().fetchQuery(options)).resolves.toEqual(["item-3"]);
  expect(getQueryClient().getQueryData(actionQuery(list, { page: 3 }).options.queryKey)).toEqual([
    "item-3",
  ]);

  const $page = family((page: number) => actionQueryOptions(list, { page }, { staleTime: 1000 }));
  expect($page(3)).toBe($page(3));
  expect($page(3).get().data).toEqual(["item-3"]);
});

it("isActionError tells the Action's own error from a failed request", () => {
  expect(isActionError(new ActionError({ code: "BAD_REQUEST" }))).toBe(true);
  // What orThrow() rejects with when the fetch itself fails, offline or on a dropped connection.
  expect(isActionError(new TypeError("Failed to fetch"))).toBe(false);
  expect(isActionError(null)).toBe(false);
});
