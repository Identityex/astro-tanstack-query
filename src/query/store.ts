import {
  QueryObserver,
  hashKey,
  type DefaultError,
  type QueryFunction,
  type QueryKey,
  type QueryObserverOptions,
  type QueryObserverResult,
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
  readonly options: QueryStoreOptions<TQueryFnData, TError, TData, TQueryKey>;
  /** Server: prefetch into the request client (optionally with a server-only fetcher). Browser: prefetch into the page client. */
  prefetch(serverQueryFn?: QueryFunction<TQueryFnData, TQueryKey>): Promise<void>;
  /** Browser only. */
  refetch(): Promise<QueryObserverResult<TData, TError>>;
  invalidate(): Promise<void>;
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
  store.refetch = () => {
    if (isServer()) {
      throw new TanstackQueryAstroError(
        "browser-only",
        "refetch() is browser-only; on the server use prefetch().",
      );
    }
    return (
      parts.observer() as QueryObserver<TQueryFnData, TError, TData, TQueryFnData, TQueryKey>
    ).refetch();
  };
  store.invalidate = () =>
    getQueryClient().invalidateQueries({ queryKey: parts.resolveOptions().queryKey, exact: true });
  store.setData = (updater) =>
    getQueryClient().setQueryData<TQueryFnData>(parts.resolveOptions().queryKey, updater);

  return store;
}
