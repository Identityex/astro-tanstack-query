import type { DataTag, DefaultError } from "@tanstack/query-core";
import { getActionPath, type ActionClient } from "astro:actions";
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
type ActionQueryError<A extends AnyAction> = ActionErrorOf<A> | DefaultError;
type ActionQueryStoreOptions<A extends AnyAction, TData> = Omit<
  QueryStoreOptions<ActionOutput<A>, ActionQueryError<A>, TData, ActionQueryKey<A>>,
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
): QueryStoreOptions<ActionOutput<A>, ActionQueryError<A>, TData, ActionQueryKey<A>> & {
  queryKey: DataTag<ActionQueryKey<A>, ActionOutput<A>, ActionQueryError<A>>;
};
// An omitted input is `undefined`, which the overload only allows when the Action accepts it.
export function actionQueryOptions<A extends AnyAction, TData = ActionOutput<A>>(
  action: A,
  input: ActionInput<A>,
  options: ActionQueryStoreOptions<A, TData> = {},
) {
  const typed: TypedAction<A> = action;
  return queryOptions<ActionOutput<A>, ActionQueryError<A>, TData, ActionQueryKey<A>>({
    ...options,
    queryKey: ["action", getActionPath(action), input],
    queryFn: async (): Promise<ActionOutput<A>> => {
      if (!isServer()) return typed.orThrow(input);
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
): QueryStore<ActionOutput<A>, ActionQueryError<A>, TData, ActionQueryKey<A>> {
  return createQuery(actionQueryOptions(action, ...args));
}

/** An Astro Action as a typed mutation: `error` is the Action's `ActionError<TInput>`. */
export function actionMutation<A extends AnyAction, TContext = unknown>(
  action: A,
  options: Omit<
    MutationStoreOptions<ActionOutput<A>, ActionErrorOf<A>, ActionInput<A>, TContext>,
    "mutationFn"
  > = {},
): MutationStore<ActionOutput<A>, ActionErrorOf<A>, ActionInput<A>, TContext> {
  return createMutation<ActionOutput<A>, ActionErrorOf<A>, ActionInput<A>, TContext>({
    mutationKey: ["action", getActionPath(action)],
    ...options,
    mutationFn: (input) => action.orThrow(input),
  });
}
