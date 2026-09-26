import { QueryClient } from "@tanstack/query-core";
import type { APIContext } from "astro";
import type { ActionClient } from "astro:actions";
import { afterEach, expect, it } from "vitest";
import { actionQuery, actionQueryOptions } from "../../../src/actions/index";
import { TanstackQueryAstroError } from "../../../src/query/errors";
import { SCOPE_KEY, type RequestScope } from "../../../src/query/scope-reader";

const holder = globalThis as Record<string, unknown>;
const publish = (scope: RequestScope | undefined) => {
  holder[SCOPE_KEY] = { getStore: () => scope };
};
afterEach(() => {
  delete holder[SCOPE_KEY];
});

function fakeAction(name: string): ActionClient<unknown[], undefined, undefined> {
  const call = async () => ({ data: [name], error: undefined });
  Object.defineProperty(call, "name", { value: name, writable: false, configurable: true });
  return Object.assign(call, { orThrow: async (input: unknown) => [name, input] });
}

it("prefetches through the request's callAction, handing it the Action's own orThrow", async () => {
  const list = fakeAction("list");
  const calls: unknown[][] = [];
  // Astro binds the request context to what it receives, so that has to be `orThrow` itself.
  const callAction: APIContext["callAction"] = (action, input) => {
    calls.push([action, input]);
    return action(input);
  };
  const queryClient = new QueryClient();
  publish({ queryClient, url: new URL("http://x/"), callAction });

  const $list = actionQuery(list, { page: 1 });
  await $list.prefetch();
  expect(calls).toEqual([[list.orThrow, { page: 1 }]]);
  expect(queryClient.getQueryData($list.options.queryKey)).toEqual(["list", { page: 1 }]);
});

it("rejects on the server when the request has no callAction", async () => {
  const queryClient = new QueryClient();
  publish({ queryClient, url: new URL("http://x/") });
  await expect(queryClient.fetchQuery(actionQueryOptions(fakeAction("list")))).rejects.toThrow(
    TanstackQueryAstroError,
  );
});
