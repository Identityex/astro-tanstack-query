import { QueryClient, hydrate } from "@tanstack/query-core";
// Server checks here are written inline, `(!browserBuild && isServer())`, so a client build folds
// them to false and drops the branches behind them. Keep them inline; a helper function defeats
// the fold: neither esbuild nor Rolldown inlines it.
import {
  browserBuild,
  defaultOptions,
  settings,
  stateReader,
} from "virtual:astro-tanstack-query/config";
import { STATE_ELEMENT_ID } from "../serializer/types";
import { TanstackQueryAstroError } from "./errors";
import { documentReady } from "./document-ready";
import { isServer, requestScope } from "./scope-reader";

// Holding module evaluation also holds island hydration: no loading flash or premature fetch.
if (!(!browserBuild && isServer())) await documentReady(document);

let page: QueryClient | undefined;
let islands: MutationObserver | undefined;

/**
 * The one client for this page. Created on first use, never injected page-wide (D3),
 * so a page that imports no store pays nothing. `mount()` is what wires
 * refetchOnWindowFocus / refetchOnReconnect — without it they are silently dead.
 */
export function pageClient(): QueryClient {
  if (!browserBuild && isServer()) {
    throw new TanstackQueryAstroError(
      "browser-only",
      "pageClient() is browser-only. On the server use getQueryClient() inside a request.",
    );
  }
  if (page) return page;

  // Same defaults the middleware gives the request client: hydrate() writes the server's
  // dataUpdatedAt verbatim, so without ssr.staleTime here every prefetched query arrives stale
  // and refetches on mount, undoing the prefetch. The user's own `queries` still win.
  const client = new QueryClient({
    defaultOptions: {
      ...defaultOptions,
      queries: { staleTime: settings.ssrStaleTime, ...defaultOptions.queries },
    },
  });
  client.mount();
  // Wired up before anything hydrates: a blob that cannot hydrate throws out of this call (on
  // purpose, for a serializer mismatch), and an unrecorded client would be built and mounted again
  // by every store read after it.
  page = client;
  // View Transitions: the module survives navigation, the document does not.
  document.addEventListener("astro:before-swap", (event) => {
    hydrateFromDocument(client, (event as Event & { newDocument: Document }).newDocument);
  });
  // A server island's state arrives later, in the id-less element its HTML carries (D6). Astro
  // inserts that HTML in one call, and the observer's microtask is queued before any island inside
  // it has finished the awaited import that precedes its hydration, so the state is in the cache
  // before that island first reads. Watched here rather than checked on each read: a live
  // collection walks the document again after every DOM change, and reads run on every render.
  const pending = document.getElementsByClassName(STATE_ELEMENT_ID);
  const drain = (): void => {
    // Spread first: dropping the class takes an element out of the live collection. Dropped before
    // hydrating, so one that throws is not retried on every later mutation.
    for (const element of [...pending]) {
      element.classList.remove(STATE_ELEMENT_ID);
      // Only a <script> is state: a class survives HTML sanitizers, a script element does not, so
      // user content styled with this class can never write into the cache.
      if (element.tagName === "SCRIPT") hydrateElement(client, element);
    }
  };
  islands = new MutationObserver(drain);
  islands.observe(document, { childList: true, subtree: true });
  hydrateFromDocument(client, document);
  // For a page whose first store read comes from inside a server island that has already arrived.
  drain();
  return client;
}

/** Hydrates `client` from `doc`'s state element. Newer `dataUpdatedAt` wins; older is ignored. */
export function hydrateFromDocument(client: QueryClient, doc: Document): boolean {
  // Not getElementById: an id survives HTML sanitizers, so user content earlier in the page could
  // carry it too. Only the page can put a <script> there.
  const element = doc.querySelector(`script#${STATE_ELEMENT_ID}`);
  if (!element) return false;
  hydrateElement(client, element);
  return true;
}

function hydrateElement(client: QueryClient, element: Element): void {
  const name = element.getAttribute("data-serializer");
  if (name !== stateReader.name) {
    throw new TanstackQueryAstroError(
      "serializer-mismatch",
      `page state was serialized with "${name ?? "unknown"}" but the client is configured for "${stateReader.name}". Set the same serializer in astro.config.`,
    );
  }
  hydrate(client, stateReader.parse(element.textContent ?? ""));
}

/** The right client for where you are: the page client in the browser, the request client on the server. */
export function getQueryClient(): QueryClient {
  if (!(!browserBuild && isServer())) return pageClient();
  const scope = requestScope();
  if (!scope) {
    throw new TanstackQueryAstroError(
      "server-client-outside-request",
      "getQueryClient() was called on the server outside a request. Call it from frontmatter, an endpoint, or middleware.",
    );
  }
  return scope.queryClient;
}

/** @internal Test hook: forget the page client so the next pageClient() creates a fresh one. */
export function resetPageClientForTests(): void {
  // Left observing, the old client's drain would take the next test's island state first.
  islands?.disconnect();
  islands = undefined;
  page?.unmount();
  page = undefined;
}
