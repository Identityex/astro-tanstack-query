import {
  QueryObserver,
  hashKey,
  type DataTag,
  type DefaultError,
  type InvalidateOptions,
  type QueryFunction,
  type QueryKey,
  type QueryObserverOptions,
  type QueryObserverResult,
  type RefetchOptions,
  type Updater,
} from "@tanstack/query-core";
import type { ReadableAtom } from "nanostores";
import { getQueryClient } from "./client";
import { TanstackQueryAstroError } from "./errors";
import { createObserverStore } from "./observer-store";
import { isServer } from "./scope-reader";

export type QueryStoreOptions<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
> = QueryObserverOptions<TQueryFnData, TError, TData, TQueryFnData, TQueryKey>;

export interface QueryStore<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
> extends ReadableAtom<QueryObserverResult<TData, TError>> {
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
      new QueryObserver<TQueryFnData, TError, TData, TQueryFnData, TQueryKey>(client, options),
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
    if (isServer()) {
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
