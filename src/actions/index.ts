import type { DataTag, DefaultError } from "@tanstack/query-core";
import { ActionError, getActionPath, type ActionClient } from "astro:actions";
// Server checks here are written inline, `(!browserBuild && isServer())`, so a client build folds
// them to false and drops the branches behind them. Keep them inline; a helper function defeats
// the fold: neither esbuild nor Rolldown inlines it.
import { browserBuild } from "virtual:astro-tanstack-query/config";
import { TanstackQueryAstroError } from "../query/errors";
import { createMutation, type MutationStore, type MutationStoreOptions } from "../query/mutation";
import { queryOptions } from "../query/options";
import { isServer, requestScope } from "../query/scope-reader";
import { createQuery, type QueryStore, type QueryStoreOptions } from "../query/store";

// `any` is how Astro itself bounds an Action (`getActionPath` and `callAction` take
// `ActionClient<any, any, any>`): each Action's types come from its own handler and schema. The
// aliases below recover those precise types from `A`, and nothing outside this file sees `any`.
// oxlint-disable-next-line typescript/no-explicit-any
type AnyAction = ActionClient<any, any, any>;

export type ActionInput<A extends AnyAction> = Parameters<A["orThrow"]>[0];
export type ActionOutput<A extends AnyAction> = Awaited<ReturnType<A["orThrow"]>>;
/** The error of the Action's own result, `ActionError<TInput>`: `isInputError()` types its `fields`. */
export type ActionErrorOf<A extends AnyAction> = NonNullable<Awaited<ReturnType<A>>["error"]>;

// On a generic `A`, `action.orThrow` resolves through that `any` bound. Seen through this type,
// the same Action returns its own output, and `orThrow` is still called on and passed as itself.
interface TypedAction<A extends AnyAction> {
  orThrow: (input: ActionInput<A>) => Promise<ActionOutput<A>>;
}

type ActionQueryKey<A extends AnyAction> = readonly ["action", string, ActionInput<A>];
// The Action's own error, or whatever else the call rejects with: offline, a dropped connection.
// `orThrow` fetches, and a fetch that fails never becomes an ActionError.
type ActionCallError<A extends AnyAction> = ActionErrorOf<A> | DefaultError;
type ActionQueryStoreOptions<A extends AnyAction, TData> = Omit<
  QueryStoreOptions<ActionOutput<A>, ActionCallError<A>, TData, ActionQueryKey<A>>,
  "queryKey" | "queryFn"
>;
// The input may be left out exactly when the Action accepts `undefined`, as an Action that takes
// no input does.
type ActionQueryArgs<A extends AnyAction, TData> =
  undefined extends ActionInput<A>
    ? [input?: ActionInput<A>, options?: ActionQueryStoreOptions<A, TData>]
    : [input: ActionInput<A>, options?: ActionQueryStoreOptions<A, TData>];

/**
 * An Astro Action's query options, keyed `["action", path, input]`. Compose them with `family`, an
 * options store or the client's `fetchQuery` and `getQueryData`; `actionQuery` is `createQuery`
 * over them.
 */
export function actionQueryOptions<A extends AnyAction, TData = ActionOutput<A>>(
  action: A,
  ...args: ActionQueryArgs<A, TData>
): QueryStoreOptions<ActionOutput<A>, ActionCallError<A>, TData, ActionQueryKey<A>> & {
  queryKey: DataTag<ActionQueryKey<A>, ActionOutput<A>, ActionCallError<A>>;
};
// An omitted input is `undefined`, which the overload only allows when the Action accepts it.
export function actionQueryOptions<A extends AnyAction, TData = ActionOutput<A>>(
  action: A,
  input: ActionInput<A>,
  options: ActionQueryStoreOptions<A, TData> = {},
) {
  const typed: TypedAction<A> = action;
  return queryOptions<ActionOutput<A>, ActionCallError<A>, TData, ActionQueryKey<A>>({
    ...options,
    queryKey: ["action", getActionPath(action), input],
    queryFn: async (): Promise<ActionOutput<A>> => {
      if (!(!browserBuild && isServer())) return typed.orThrow(input);
      const scope = requestScope();
      if (!scope?.callAction) {
        throw new TanstackQueryAstroError(
          "server-client-outside-request",
          "actionQuery() on the server needs a request with callAction.",
        );
      }
      return scope.callAction(typed.orThrow, input);
    },
  });
}

/** An Astro Action as a query: called through `.orThrow()` in the browser and through the request's `callAction` during SSR prefetch. */
export function actionQuery<A extends AnyAction, TData = ActionOutput<A>>(
  action: A,
  ...args: ActionQueryArgs<A, TData>
): QueryStore<ActionOutput<A>, ActionCallError<A>, TData, ActionQueryKey<A>> {
  return createQuery(actionQueryOptions(action, ...args));
}

/**
 * An Astro Action as a typed mutation. `error` is the Action's `ActionError<TInput>` or a transport
 * error; `isActionError(error) && isInputError(error)` narrows to the typed `fields`.
 */
export function actionMutation<A extends AnyAction, TContext = unknown>(
  action: A,
  options: Omit<
    MutationStoreOptions<ActionOutput<A>, ActionCallError<A>, ActionInput<A>, TContext>,
    "mutationFn"
  > = {},
): MutationStore<ActionOutput<A>, ActionCallError<A>, ActionInput<A>, TContext> {
  return createMutation<ActionOutput<A>, ActionCallError<A>, ActionInput<A>, TContext>({
    mutationKey: ["action", getActionPath(action)],
    ...options,
    mutationFn: (input) => action.orThrow(input),
  });
}

// ActionError's own bound on its input parameter, read from the class rather than restated.
type ActionErrorInput = ActionError extends ActionError<infer T> ? T : never;

/**
 * Narrows a mutation's or query's `error` to the Action's own `ActionError`, keeping its input type,
 * so `isInputError(error)` then types `fields` by the Action's schema. The call can also reject
 * with a plain `Error` when the request itself fails (offline, a dropped connection); `instanceof`
 * alone cannot keep the type, because the class's own parameter defaults to `any`.
 */
export function isActionError<T extends ActionErrorInput>(
  error: ActionError<T> | Error | null | undefined,
): error is ActionError<T> {
  return error instanceof ActionError;
}
