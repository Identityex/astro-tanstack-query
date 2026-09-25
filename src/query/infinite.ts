import {
  InfiniteQueryObserver,
  hashKey,
  type DataTag,
  type DefaultError,
  type InfiniteData,
  type InfiniteQueryObserverOptions,
  type InfiniteQueryObserverResult,
  type InvalidateOptions,
  type QueryFunction,
  type QueryKey,
  type RefetchOptions,
  type Updater,
} from "@tanstack/query-core";
import type { ReadableAtom } from "nanostores";
import { getQueryClient } from "./client";
import { TanstackQueryAstroError } from "./errors";
import { createObserverStore, type ObserverLike } from "./observer-store";
import { isServer } from "./scope-reader";

export interface InfiniteQueryStore<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = InfiniteData<TQueryFnData>,
  TQueryKey extends QueryKey = QueryKey,
  TPageParam = unknown,
> extends ReadableAtom<InfiniteQueryObserverResult<TData, TError>> {
  /** `hashKey(queryKey)` of the current options. */
  readonly key: string;
  /** The current options. `queryKey` is tagged with the cached pages, so `getQueryData` is typed. */
  readonly options: InfiniteQueryObserverOptions<
    TQueryFnData,
    TError,
    TData,
    TQueryKey,
    TPageParam
  > & { queryKey: DataTag<TQueryKey, InfiniteData<TQueryFnData, TPageParam>, TError> };
  /** Server: prefetch into the request client (optionally with a server-only fetcher). Browser: prefetch into the page client. */
  prefetch(serverQueryFn?: QueryFunction<TQueryFnData, TQueryKey, TPageParam>): Promise<void>;
  /** Browser only. Fetches the key of the current options, even when the store is not mounted. */
  refetch(options?: RefetchOptions): Promise<InfiniteQueryObserverResult<TData, TError>>;
  invalidate(options?: InvalidateOptions): Promise<void>;
  /** The cached value of an infinite query is every page it has fetched, not one page. */
  setData(
    updater: Updater<
      InfiniteData<TQueryFnData, TPageParam> | undefined,
      InfiniteData<TQueryFnData, TPageParam> | undefined
    >,
  ): InfiniteData<TQueryFnData, TPageParam> | undefined;
}

export function createInfiniteQuery<
  TQueryFnData,
  TError = DefaultError,
  TData = InfiniteData<TQueryFnData>,
  TQueryKey extends QueryKey = QueryKey,
  TPageParam = unknown,
>(
  input:
    | InfiniteQueryObserverOptions<TQueryFnData, TError, TData, TQueryKey, TPageParam>
    | ReadableAtom<
        InfiniteQueryObserverOptions<TQueryFnData, TError, TData, TQueryKey, TPageParam>
      >,
): InfiniteQueryStore<TQueryFnData, TError, TData, TQueryKey, TPageParam> {
  type Options = InfiniteQueryObserverOptions<TQueryFnData, TError, TData, TQueryKey, TPageParam>;
  type Result = InfiniteQueryObserverResult<TData, TError>;
  type Native = InfiniteQueryObserver<TQueryFnData, TError, TData, TQueryKey, TPageParam>;

  // The observer travels out on the store's own observer object rather than in a closure
  // variable: the server snapshot path calls this factory on every read, so a closure would
  // park that request's QueryClient in a module-lived store past the response (section 8).
  interface InfiniteObserverLike extends ObserverLike<Options, Result> {
    readonly native: Native;
  }

  const parts = createObserverStore<Options, Result>(
    input,
    (client, options): InfiniteObserverLike => {
      const instance = new InfiniteQueryObserver<
        TQueryFnData,
        TError,
        TData,
        TQueryKey,
        TPageParam
      >(client, options);
      return {
        native: instance,
        subscribe: (listener) => instance.subscribe(listener),
        getCurrentResult: () => instance.getCurrentResult(),
        // InfiniteQueryObserver inherits trackResult from QueryObserver, so it is declared to
        // return the narrower QueryObserverResult; at runtime it is a tracked-props proxy of the
        // result handed in. Re-widen rather than skip tracking, or every prop would notify.
        trackResult: (result) => instance.trackResult(result) as Result,
        setOptions: (next) => instance.setOptions(next),
      };
    },
  );
  const store = parts.store as InfiniteQueryStore<
    TQueryFnData,
    TError,
    TData,
    TQueryKey,
    TPageParam
  >;
  Object.defineProperties(store, {
    key: { get: () => hashKey(parts.resolveOptions().queryKey) },
    options: { get: () => parts.resolveOptions() },
  });
  store.prefetch = async (serverQueryFn) => {
    const options = parts.resolveOptions();
    await getQueryClient().prefetchInfiniteQuery({
      ...options,
      ...(serverQueryFn ? { queryFn: serverQueryFn } : {}),
    });
  };
  // Not async, so the server misuse throws where it is called rather than landing as an
  // unhandled rejection — the same shape as createQuery's refetch().
  store.refetch = (options) => {
    if (isServer()) {
      throw new TanstackQueryAstroError(
        "browser-only",
        "refetch() is browser-only; on the server use prefetch().",
      );
    }
    const current = parts.observer() as InfiniteObserverLike;
    // Bring an unmounted observer up to the current options first, as createQuery's refetch does.
    current.setOptions(parts.resolveOptions());
    // refetch() is inherited from QueryObserver too, so it is declared to resolve to the
    // narrower QueryObserverResult; the value is this observer's own result. Re-widen it.
    return current.native.refetch(options) as Promise<Result>;
  };
  store.invalidate = (options) =>
    getQueryClient().invalidateQueries(
      { queryKey: parts.resolveOptions().queryKey, exact: true },
      options,
    );
  store.setData = (updater) =>
    getQueryClient().setQueryData<InfiniteData<TQueryFnData, TPageParam>>(
      parts.resolveOptions().queryKey,
      updater,
    );
  return store;
}
