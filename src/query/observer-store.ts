import { QueryClient, notifyManager } from "@tanstack/query-core";
import { atom, onMount, type ReadableAtom } from "nanostores";
// Server checks here are written inline, `(!browserBuild && isServer())`, so a client build folds
// them to false and drops the branches behind them. Keep them inline; a helper function defeats
// the fold: neither esbuild nor Rolldown inlines it.
import { browserBuild } from "virtual:astro-tanstack-query/config";
import { pageClient } from "./client";
import { isServer, requestScope } from "./scope-reader";

export interface ObserverLike<TOptions, TResult> {
  subscribe(listener: (result: TResult) => void): () => void;
  getCurrentResult(): TResult;
  trackResult(result: TResult): TResult;
  setOptions(options: TOptions): void;
}

export interface ObserverStoreParts<TOptions, TResult> {
  store: ReadableAtom<TResult>;
  resolveOptions(): TOptions;
  /** Browser only: the store's one observer, created on first use. */
  observer(): ObserverLike<TOptions, TResult>;
}

// nanostores hands a listener `ReadonlyIfObject<T>`, not `T`, and does not re-export
// that helper from its entry point — so derive the signature from the store itself
// rather than hand-rolling one that drifts from the library.
export type Listener<T> = Parameters<ReadableAtom<T>["subscribe"]>[0];
export type ListenerValue<T> = Parameters<Listener<T>>[0];

function isStore<T>(value: T | ReadableAtom<T>): value is ReadableAtom<T> {
  return typeof value === "object" && value !== null && "subscribe" in value && "get" in value;
}

// Used only to shape placeholder results on the server when no request scope exists.
// It is never prefetched into and never reachable by users. Deliberately not memoised: every
// read builds a Query in the client's cache, and on the server `gcTime` defaults to Infinity, for
// which no eviction timer is armed — a shared client would grow one entry per key for the life
// of the isolate, on exactly the runtimes (Cloudflare, Vercel Edge) that reach this path.
// Infinity is only the default: a store's own `gcTime` arms a timer here too, which holds only
// this throwaway client and its one empty query until it fires. The request client is different:
// an explicit `gcTime` arms timers there that only the end-of-request `clear()` cancels
// (design.md §3.2).
const detachedClient = () => new QueryClient();

let warnedNoScope = false;
function warnNoScopeOnce(): void {
  // Dev only: in production this is the documented fallback for a runtime without usable
  // AsyncLocalStorage, where the warning is noise a deployment cannot act on. The optional
  // chain is load-bearing — this module is also bundled for plain Node, which has no
  // `import.meta.env` for Vite to define.
  if (warnedNoScope || !import.meta.env?.DEV) return;
  warnedNoScope = true;
  console.warn(
    "[astro-tanstack-query] a store was read on the server outside a request scope; rendering it as pending. Is the integration added to astro.config, and does this runtime support AsyncLocalStorage?",
  );
}

/**
 * The whole framework bridge (D2): one observer's results pushed into one nanostore.
 * Browser: the observer attaches in onMount and detaches when the last listener leaves.
 * Server: every read is a snapshot of the request client; nothing subscribes, nothing fetches (D5).
 */
export function createObserverStore<TOptions, TResult>(
  input: TOptions | ReadableAtom<TOptions>,
  makeObserver: (client: QueryClient, options: TOptions) => ObserverLike<TOptions, TResult>,
): ObserverStoreParts<TOptions, TResult> {
  const $options = isStore(input) ? input : undefined;
  const resolveOptions = (): TOptions => ($options ? $options.get() : (input as TOptions));

  // The initial value is never observable: get() mounts first (browser) or is overridden (server).
  // The assertion below looks redundant and eslint calls it so, but it is load-bearing: nanostores
  // types atom's args as `undefined extends Value ? [] | [Value] : [Value]`, and tsc cannot resolve
  // that conditional for an unresolved generic. Removing it fails with TS2345.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const store = atom<TResult>(undefined as TResult);

  let observerInstance: ObserverLike<TOptions, TResult> | undefined;
  const observer = (): ObserverLike<TOptions, TResult> =>
    (observerInstance ??= makeObserver(pageClient(), resolveOptions()));

  if (!browserBuild && isServer()) {
    const snapshot = (): TResult => {
      const scope = requestScope();
      if (!scope) warnNoScopeOnce();
      return makeObserver(
        scope?.queryClient ?? detachedClient(),
        resolveOptions(),
      ).getCurrentResult();
    };
    store.get = snapshot;
    store.subscribe = (listener: Listener<TResult>) => {
      listener(snapshot() as ListenerValue<TResult>);
      return () => {};
    };
    store.listen = () => () => {};
  } else {
    let lastResult: TResult | undefined;
    let trackedResult: TResult;
    const snapshot = (): TResult => {
      const current = observer();
      const result = current.getCurrentResult();
      if (result !== lastResult) {
        lastResult = result;
        trackedResult = current.trackResult(result);
      }
      return trackedResult;
    };
    const get = store.get.bind(store);
    store.get = () => {
      get(); // Preserve nanostores' lazy mount and delayed cleanup.
      return snapshot();
    };
    store.subscribe = (listener: Listener<TResult>) => {
      const stop = store.listen(listener);
      // A previous reader may track only data. Its cached notification can predate changes to
      // isFetching/error that this reader needs; the observer always has the current result.
      listener(snapshot() as ListenerValue<TResult>);
      return stop;
    };
    onMount(store, () => {
      const current = observer();
      current.setOptions(resolveOptions());
      const stopObserver = current.subscribe(
        notifyManager.batchCalls(() => {
          store.set(snapshot());
        }),
      );
      store.set(snapshot());
      const stopOptions = $options?.listen((next) => {
        current.setOptions(next);
      });
      return () => {
        stopOptions?.();
        stopObserver();
      };
    });
  }

  return { store, resolveOptions, observer };
}
