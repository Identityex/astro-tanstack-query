import { notifyManager, type MutationFilters, type QueryFilters } from "@tanstack/query-core";
import { atom, onMount, type ReadableAtom } from "nanostores";
// Server checks here are written inline, `(!browserBuild && isServer())`, so a client build folds
// them to false and drops the branches behind them. Keep them inline; a helper function defeats
// the fold: neither esbuild nor Rolldown inlines it.
import { browserBuild } from "virtual:astro-tanstack-query/config";
import { pageClient } from "./client";
import { isServer } from "./scope-reader";

/**
 * A count over the page client's caches, recounted whenever they change. It is not an observer
 * store (D2): nothing here fetches or mutates, so there is no observer to bridge, only a cache to
 * listen to. The page client is reached only on mount, so creating one at module level does not
 * create the client (D3).
 */
function activity(
  count: () => number,
  subscribe: (listener: () => void) => () => void,
): ReadableAtom<number> {
  const $count = atom(0);
  // Nothing fetches or mutates during SSR (D5), so 0 is the true answer. Returning before onMount
  // matters as much as the value: a server read would otherwise mount the atom and call
  // pageClient(), which throws there, and counting the request client instead would tie a
  // module-level atom to one request (D4).
  if (!browserBuild && isServer()) return $count;
  onMount($count, () => {
    const update = () => $count.set(count());
    update();
    // The same batched tick the observer stores update on, so the count changes together with
    // the islands it summarises rather than midway through a cache dispatch.
    return subscribe(notifyManager.batchCalls(update));
  });
  return $count;
}

/**
 * How many queries matching `filters` are fetching right now, across every island on the page.
 * Always 0 on the server, as with upstream `useIsFetching`.
 */
export function createIsFetching(filters?: QueryFilters): ReadableAtom<number> {
  return activity(
    () => pageClient().isFetching(filters),
    (listener) => pageClient().getQueryCache().subscribe(listener),
  );
}

/**
 * How many mutations matching `filters` are pending right now, across every island on the page.
 * Always 0 on the server, as with upstream `useIsMutating`.
 */
export function createIsMutating(filters?: MutationFilters): ReadableAtom<number> {
  return activity(
    () => pageClient().isMutating(filters),
    (listener) => pageClient().getMutationCache().subscribe(listener),
  );
}
