import type { DataTag, DefaultError, QueryKey } from "@tanstack/query-core";
import type { DefinedInitialDataQueryStoreOptions, QueryStoreOptions } from "./store";

/** Identity at runtime; tags `queryKey` with the data type and keeps a defined `initialData` defined. */
export function queryOptions<
  TQueryFnData,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  options: DefinedInitialDataQueryStoreOptions<TQueryFnData, TError, TData, TQueryKey>,
): DefinedInitialDataQueryStoreOptions<TQueryFnData, TError, TData, TQueryKey> & {
  queryKey: DataTag<TQueryKey, TQueryFnData, TError>;
};
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
};
// The overloads carry every type; the tag exists only in the type system, as in TanStack's own.
export function queryOptions(options: unknown): unknown {
  return options;
}
