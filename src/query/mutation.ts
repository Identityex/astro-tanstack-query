import {
  MutationObserver,
  type DefaultError,
  type MutateOptions,
  type MutationObserverOptions,
  type MutationObserverResult,
  type OmitKeyof,
} from "@tanstack/query-core";
import type { ReadableAtom } from "nanostores";
import { TanstackQueryAstroError } from "./errors";
import { createObserverStore, type ObserverLike } from "./observer-store";
import { isServer } from "./scope-reader";

/**
 * `MutationObserver`'s options without `throwOnError`: query-core never reads it, and the throw it
 * asks for needs an error boundary, which only a framework adapter has (D2). The error is the
 * result's `error`, and `mutateAsync` rejects with it.
 */
export type MutationStoreOptions<
  TData = unknown,
  TError = DefaultError,
  TVariables = void,
  TContext = unknown,
> = OmitKeyof<MutationObserverOptions<TData, TError, TVariables, TContext>, "throwOnError">;

export interface MutationStore<
  TData = unknown,
  TError = DefaultError,
  TVariables = void,
  TContext = unknown,
> extends ReadableAtom<MutationObserverResult<TData, TError, TVariables, TContext>> {
  mutate(variables: TVariables, options?: MutateOptions<TData, TError, TVariables, TContext>): void;
  mutateAsync(
    variables: TVariables,
    options?: MutateOptions<TData, TError, TVariables, TContext>,
  ): Promise<TData>;
  reset(): void;
}

export function createMutation<
  TData = unknown,
  TError = DefaultError,
  TVariables = void,
  TContext = unknown,
>(
  options: MutationStoreOptions<TData, TError, TVariables, TContext>,
): MutationStore<TData, TError, TVariables, TContext> {
  type Options = MutationStoreOptions<TData, TError, TVariables, TContext>;
  type Result = MutationObserverResult<TData, TError, TVariables, TContext>;

  type Native = MutationObserver<TData, TError, TVariables, TContext>;
  // The observer travels out on the store's own observer object rather than in a closure
  // variable: the server snapshot path calls this factory on every read, so a closure would
  // park that request's QueryClient in a module-lived store past the response (section 8).
  interface MutationObserverLike extends ObserverLike<Options, Result> {
    readonly native: Native;
  }

  const parts = createObserverStore<Options, Result>(
    options,
    (client, opts): MutationObserverLike => {
      const instance = new MutationObserver<TData, TError, TVariables, TContext>(client, opts);
      return {
        native: instance,
        subscribe: (listener) => instance.subscribe(listener),
        getCurrentResult: () => instance.getCurrentResult(),
        trackResult: (result) => result, // MutationObserver has no tracked props
        setOptions: (next) => instance.setOptions(next),
      };
    },
  );

  const browserOnly = (name: string) =>
    new TanstackQueryAstroError(
      "browser-only",
      `${name}() is browser-only; mutations never run during SSR.`,
    );
  const observer = (): Native => {
    if (isServer()) throw browserOnly("mutate");
    return (parts.observer() as MutationObserverLike).native;
  };

  const store = parts.store as MutationStore<TData, TError, TVariables, TContext>;
  const run: MutationStore<TData, TError, TVariables, TContext>["mutateAsync"] = (
    variables,
    mutateOptions,
  ) => {
    const native = observer();
    // MutationObserver fires per-call callbacks only while it has listeners — React Query's
    // "component still mounted" check. A store used only for its methods (a <script>, an htmx
    // handler, an island that renders a button) has none, so hold one for the call. A store has
    // no component lifetime, so this also fires them after the calling island unmounted.
    const release = store.listen(() => {});
    return native.mutate(variables, mutateOptions).finally(release);
  };
  store.mutate = (variables, mutateOptions) => {
    run(variables, mutateOptions).catch(() => undefined);
  };
  store.mutateAsync = run;
  store.reset = () => observer().reset();
  return store;
}
