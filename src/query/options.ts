import type { DataTag, DefaultError, QueryKey } from "@tanstack/query-core";
import type { QueryStoreOptions } from "./store";

/** Identity at runtime; tags `queryKey` with the data type so `getQueryData` and `setData` infer it. */
export function queryOptions<
  TQueryFnData,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  options: QueryStoreOptions<TQueryFnData, TError, TData, TQueryKey>,
): QueryStoreOptions<TQueryFnData, TError, TData, TQueryKey> & {
  queryKey: DataTag<TQueryKey, TQueryFnData, TError>;
} {
  return options as QueryStoreOptions<TQueryFnData, TError, TData, TQueryKey> & {
    queryKey: DataTag<TQueryKey, TQueryFnData, TError>;
  };
}
