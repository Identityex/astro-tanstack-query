import { hashKey, type DefaultError, type QueryKey } from "@tanstack/query-core";
import { atom, onMount, type WritableAtom } from "nanostores";
import { isServer } from "./scope-reader";
import { createQuery, type QueryStore, type QueryStoreOptions } from "./store";

/**
 * Memoises stores by `hashKey(queryKey)` so a component can call `$user(id)` on every render.
 * A member leaves the map when it unmounts (after nanostores' delay), so the map tracks live use.
 * On the server stores are transient snapshots, so nothing is memoised (no cross-request growth).
 */
export function family<
  TParams,
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  define: (params: TParams) => QueryStoreOptions<TQueryFnData, TError, TData, TQueryKey>,
): (params: TParams) => QueryStore<TQueryFnData, TError, TData, TQueryKey> {
  type Options = QueryStoreOptions<TQueryFnData, TError, TData, TQueryKey>;
  interface Member {
    store: QueryStore<TQueryFnData, TError, TData, TQueryKey>;
    options: WritableAtom<Options>;
  }

  const members = new Map<string, Member>();
  return (params) => {
    const options = define(params);
    if (isServer()) return createQuery(options);
    const key = hashKey(options.queryKey);
    const existing = members.get(key);
    if (existing) {
      // A member is built on its options *store*, not on the object that minted it, because
      // `define` may close over state that has changed since: without this a cache hit would
      // silently keep the first call's queryFn. createQuery feeds a mounted observer from here.
      existing.options.set(options);
      return existing.store;
    }
    const $options = atom<Options>(options);
    const store = createQuery($options);
    onMount(store, () => () => {
      if (members.get(key)?.store === store) members.delete(key);
    });
    members.set(key, { store, options: $options });
    return store;
  };
}
