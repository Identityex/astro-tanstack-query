import {
  QueryObserver,
  hashKey,
  type DataTag,
  type DefaultError,
  type DefinedQueryObserverResult,
  type InvalidateOptions,
  type NonUndefinedGuard,
  type OmitKeyof,
  type QueryFunction,
  type QueryKey,
  type QueryObserverOptions,
  type QueryObserverResult,
  type RefetchOptions,
  type Updater,
} from "@tanstack/query-core";
import type { ReadableAtom } from "nanostores";
// Server checks here are written inline, `(!browserBuild && isServer())`, so a client build folds
// them to false and drops the branches behind them. Keep them inline; a helper function defeats
// the fold: neither esbuild nor Rolldown inlines it.
import { browserBuild } from "virtual:astro-tanstack-query/config";
import { getQueryClient } from "./client";
import { TanstackQueryAstroError } from "./errors";
import { createObserverStore } from "./observer-store";
import { isServer } from "./scope-reader";

/**
 * `QueryObserver`'s options without `throwOnError` and `suspense`, which need an error boundary or
 * Suspense that only a framework adapter has (D2). query-core reads `throwOnError` only to track
 * `error` and leaves the throw to the adapter, and `suspense` silently stops a store refetching an
 * errored query when its key changes. Read the result's `error` or `status` instead.
 */
export type QueryStoreOptions<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
> = OmitKeyof<
  QueryObserverOptions<TQueryFnData, TError, TData, TQueryFnData, TQueryKey>,
  "throwOnError" | "suspense"
>;

/** Options whose `initialData` is always defined, so the store's `data` is never `undefined`. */
export type DefinedInitialDataQueryStoreOptions<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
> = QueryStoreOptions<TQueryFnData, TError, TData, TQueryKey> & {
  initialData: NonUndefinedGuard<TQueryFnData> | (() => NonUndefinedGuard<TQueryFnData>);
};

export interface QueryStore<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
  TResult = QueryObserverResult<TData, TError>,
> extends ReadableAtom<TResult> {
  /** `hashKey(queryKey)` of the current options. */
  readonly key: string;
  /** The current options. `queryKey` is tagged, so `getQueryClient().getQueryData(options.queryKey)` is typed. */
  readonly options: QueryStoreOptions<TQueryFnData, TError, TData, TQueryKey> & {
    queryKey: DataTag<TQueryKey, TQueryFnData, TError>;
  };
  /** Server: prefetch into the request client (optionally with a server-only fetcher). Browser: prefetch into the page client. */
  prefetch(serverQueryFn?: QueryFunction<TQueryFnData, TQueryKey>): Promise<void>;
  /** Browser only. Fetches the key of the current options, even when the store is not mounted. */
  refetch(options?: RefetchOptions): Promise<QueryObserverResult<TData, TError>>;
  invalidate(options?: InvalidateOptions): Promise<void>;
  setData(
    updater: Updater<TQueryFnData | undefined, TQueryFnData | undefined>,
  ): TQueryFnData | undefined;
}

/** A store seeded with `initialData`, whose `data` is therefore never `undefined`. */
export type DefinedQueryStore<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
> = QueryStore<TQueryFnData, TError, TData, TQueryKey, DefinedQueryObserverResult<TData, TError>>;

// The defined overload states what already holds at runtime: whichever client a read uses (the
// page's, the request's or the detached placeholder), the Query is created from `initialData`, so
// it starts as success with data, and setData() cannot clear it because query-core ignores an
// undefined update. As in the official adapters, a Query another caller created first without
// `initialData` is the exception.
/** With `initialData`, `data` is never `undefined`. */
export function createQuery<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  input:
    | DefinedInitialDataQueryStoreOptions<TQueryFnData, TError, TData, TQueryKey>
    | ReadableAtom<DefinedInitialDataQueryStoreOptions<TQueryFnData, TError, TData, TQueryKey>>,
): DefinedQueryStore<TQueryFnData, TError, TData, TQueryKey>;
export function createQuery<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  input:
    | QueryStoreOptions<TQueryFnData, TError, TData, TQueryKey>
    | ReadableAtom<QueryStoreOptions<TQueryFnData, TError, TData, TQueryKey>>,
): QueryStore<TQueryFnData, TError, TData, TQueryKey>;
export function createQuery<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  input:
    | QueryStoreOptions<TQueryFnData, TError, TData, TQueryKey>
    | ReadableAtom<QueryStoreOptions<TQueryFnData, TError, TData, TQueryKey>>,
): QueryStore<TQueryFnData, TError, TData, TQueryKey> {
  type Options = QueryStoreOptions<TQueryFnData, TError, TData, TQueryKey>;
  type Result = QueryObserverResult<TData, TError>;

  const parts = createObserverStore<Options, Result>(
    input,
    (client, options) =>
      new QueryObserver<TQueryFnData, TError, TData, TQueryFnData, TQueryKey>(
        client,
        // The browser's first read mounts the store, and mounting starts any fetch-on-mount, so
        // hydration already sees isLoading/isFetching. Optimistic results make the server
        // snapshot report that same state, as the official React, Vue, Svelte and Solid adapters
        // do. It changes only what is reported: this observer is never subscribed, so it still
        // never fetches (D5).
        !browserBuild && isServer() ? { ...options, _optimisticResults: "optimistic" } : options,
      ),
  );

  const store = parts.store as QueryStore<TQueryFnData, TError, TData, TQueryKey>;
  Object.defineProperties(store, {
    key: { get: () => hashKey(parts.resolveOptions().queryKey) },
    options: { get: () => parts.resolveOptions() },
  });

  store.prefetch = async (serverQueryFn) => {
    const options = parts.resolveOptions();
    await getQueryClient().prefetchQuery({
      ...options,
      ...(serverQueryFn ? { queryFn: serverQueryFn } : {}),
    });
  };
  store.refetch = (options) => {
    if (!browserBuild && isServer()) {
      throw new TanstackQueryAstroError(
        "browser-only",
        "refetch() is browser-only; on the server use prefetch().",
      );
    }
    const current = parts.observer();
    // The observer follows an options store only while mounted (D10), so an unmounted store's
    // observer still holds the key it last saw. Unchanged options are shallow-equal to what it
    // has, so a mounted observer is neither notified nor made to fetch twice.
    current.setOptions(parts.resolveOptions());
    return (current as QueryObserver<TQueryFnData, TError, TData, TQueryFnData, TQueryKey>).refetch(
      options,
    );
  };
  store.invalidate = (options) =>
    getQueryClient().invalidateQueries(
      { queryKey: parts.resolveOptions().queryKey, exact: true },
      options,
    );
  store.setData = (updater) =>
    getQueryClient().setQueryData<TQueryFnData>(parts.resolveOptions().queryKey, updater);

  return store;
}
