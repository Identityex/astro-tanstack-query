import { hashKey, type DefaultError, type QueryKey } from "@tanstack/query-core";
import { STORE_UNMOUNT_DELAY, atom, onMount, type WritableAtom } from "nanostores";
import { isServer } from "./scope-reader";
import {
  createQuery,
  type DefinedInitialDataQueryStoreOptions,
  type DefinedQueryStore,
  type QueryStore,
  type QueryStoreOptions,
} from "./store";

/**
 * Memoises one store per `hashKey(queryKey)` and releases it once nothing uses it. When `define`
 * returns `initialData`, every member's `data` is defined.
 */
export function family<
  TParams,
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  define: (
    params: TParams,
  ) => DefinedInitialDataQueryStoreOptions<TQueryFnData, TError, TData, TQueryKey>,
): (params: TParams) => DefinedQueryStore<TQueryFnData, TError, TData, TQueryKey>;
/**
 * Memoises stores by `hashKey(queryKey)` so a component can call `$user(id)` on every render.
 * A member that is not mounted leaves the map after nanostores' unmount delay (about a second),
 * counted from its creation or its last unmount, so the map tracks live use whether or not the
 * member ever mounts. A held member that mounts after that puts itself back.
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
): (params: TParams) => QueryStore<TQueryFnData, TError, TData, TQueryKey>;
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
    const member: Member = { store, options: $options };
    // A flag rather than `!store.lc`: nanostores zeroes `lc` as soon as the last listener leaves
    // but unmounts a delay later, and a listener that returns within that delay does not mount
    // again. Keying on `lc` could evict a live member that would then never rejoin the map.
    let mounted = false;
    const evict = () => {
      if (!mounted && members.get(key) === member) members.delete(key);
    };
    onMount(store, () => {
      mounted = true;
      // A held member first mounted after its eviction rejoins, so the next call returns it rather
      // than minting a second store for the same key.
      if (!members.has(key)) members.set(key, member);
      return () => {
        mounted = false;
        evict();
      };
    });
    members.set(key, member);
    // prefetch(), setData(), invalidate(), refetch() and key never mount a store, so such a member
    // would never see the unmount that evicts it and would live as long as the page client (D3:
    // across View Transitions). Give it the grace an unmounted member gets. The timer must not
    // read the store: get() mounts it, which attaches an observer and can start a fetch.
    setTimeout(evict, STORE_UNMOUNT_DELAY);
    return store;
  };
}
