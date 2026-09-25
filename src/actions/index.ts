import type { DefaultError, MutationObserverOptions } from "@tanstack/query-core";
import { getActionPath } from "astro:actions";
import type { ActionError } from "astro:actions";
import { TanstackQueryAstroError } from "../query/errors";
import { createMutation, type MutationStore } from "../query/mutation";
import { isServer, requestScope } from "../query/scope-reader";
import { createQuery, type QueryStore, type QueryStoreOptions } from "../query/store";

// `any` is deliberate and load-bearing here: an Astro Action's input type is whatever its own Zod
// schema infers, so this structural shape has to accept every action. ActionInput/ActionOutput
// below recover the precise types from it, and nothing outside this file sees `any`.
/* oxlint-disable typescript/no-explicit-any */
type ActionLike = ((input: any) => Promise<unknown>) & {
  orThrow: (input: any) => Promise<unknown>;
};
/* oxlint-enable typescript/no-explicit-any */

export type ActionInput<A extends ActionLike> = Parameters<A["orThrow"]>[0];
export type ActionOutput<A extends ActionLike> = Awaited<ReturnType<A["orThrow"]>>;

/** An Astro Action as a typed mutation: `error` is the `ActionError` the action threw. */
export function actionMutation<A extends ActionLike, TContext = unknown>(
  action: A,
  options: Omit<
    MutationObserverOptions<ActionOutput<A>, ActionError, ActionInput<A>, TContext>,
    "mutationFn"
  > = {},
): MutationStore<ActionOutput<A>, ActionError, ActionInput<A>, TContext> {
  return createMutation<ActionOutput<A>, ActionError, ActionInput<A>, TContext>({
    mutationKey: ["action", getActionPath(action)],
    ...options,
    mutationFn: (input) => action.orThrow(input) as Promise<ActionOutput<A>>,
  });
}

/** An Astro Action as a query: called through `.orThrow()` in the browser and through the request's `callAction` during SSR prefetch. */
export function actionQuery<A extends ActionLike>(
  action: A,
  input: ActionInput<A>,
  options: Omit<
    QueryStoreOptions<ActionOutput<A>, ActionError | DefaultError, ActionOutput<A>>,
    "queryKey" | "queryFn"
  > = {},
): QueryStore<ActionOutput<A>, ActionError | DefaultError> {
  const path = getActionPath(action);
  return createQuery<ActionOutput<A>, ActionError | DefaultError>({
    ...options,
    queryKey: ["action", path, input],
    queryFn: async (): Promise<ActionOutput<A>> => {
      if (isServer()) {
        const scope = requestScope();
        if (!scope?.callAction) {
          throw new TanstackQueryAstroError(
            "server-client-outside-request",
            "actionQuery() on the server needs a request with callAction.",
          );
        }
        return (await scope.callAction(action.orThrow as never, input as never)) as ActionOutput<A>;
      }
      return (await action.orThrow(input)) as ActionOutput<A>;
    },
  });
}
