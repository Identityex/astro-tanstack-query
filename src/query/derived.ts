import {
  atom,
  computed,
  type Gettable,
  type ReadableAtom,
  type Store,
  type StoreValue,
  type StoreValues,
} from "nanostores";
import type { Listener, ListenerValue } from "./observer-store";
import { isServer } from "./scope-reader";

/**
 * `computed()` for values read off this package's stores — `derived($thing, (r) => r.data)`.
 *
 * Use it instead of nanostores' `computed` wherever a source is a store from here. `computed`
 * caches its value behind a module-global epoch counter that only a store *write* advances, and
 * a server store's value comes from a per-read snapshot that never writes — so the value derived
 * for one request would be handed to every later request in that isolate, which is the one thing
 * per-request isolation (D4) exists to prevent. Bumping the epoch cannot fix it: the cache is
 * module-scoped, so concurrent requests share it regardless.
 *
 * Both of `computed`'s shapes are here — one source, or an array of them — because a combination
 * is where the leak hides just as readily: mixing a query store into a multi-source derivation
 * through `computed` reopens it, and a caller with no array form here has nowhere else to go.
 *
 * On the server this recomputes from every source on every read, exactly as the query stores do.
 * In the browser, where there is one client and one page, it is `computed` unchanged.
 */
export function derived<Value, OriginStore extends Store>(
  sources: OriginStore,
  fn: (value: StoreValue<OriginStore>) => Value,
): ReadableAtom<Value>;
export function derived<Value, OriginStores extends readonly Store[]>(
  sources: readonly [...OriginStores],
  fn: (...values: StoreValues<OriginStores>) => Value,
): ReadableAtom<Value>;
export function derived<Value>(
  sources: Store | readonly Store[],
  fn: (...values: unknown[]) => Value,
): ReadableAtom<Value> {
  // Both branches are textually identical on purpose: `computed` has no overload accepting the
  // un-narrowed `Store | readonly Store[]`, so the ternary exists solely to pick one. Collapsing
  // it fails to compile.
  if (!isServer()) return isMultiple(sources) ? computed(sources, fn) : computed(sources, fn);

  // Reading through Gettable<unknown> rather than Store keeps the values `unknown` on the way
  // into fn; Store's own `get()` is typed `any`, which would wave every arg through unchecked.
  const read = (source: Gettable<unknown>): unknown => source.get();
  const snapshot = (): Value =>
    isMultiple(sources) ? fn(...sources.map(read)) : fn(read(sources));
  return snapshotStore(snapshot);
}

function isMultiple(sources: Store | readonly Store[]): sources is readonly Store[] {
  return Array.isArray(sources);
}

/** A read-only store that answers from `snapshot()` every time and never notifies. */
function snapshotStore<Value>(snapshot: () => Value): ReadableAtom<Value> {
  // The initial value is never observable: every read is overridden below. The assertion is
  // load-bearing for the same reason it is in observer-store.ts — nanostores types atom's args
  // as a conditional tuple tsc cannot resolve for an unresolved generic.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const store = atom<Value>(undefined as Value);
  store.get = snapshot;
  store.subscribe = (listener: Listener<Value>) => {
    listener(snapshot() as ListenerValue<Value>);
    return () => {};
  };
  store.listen = () => () => {};
  return store;
}
