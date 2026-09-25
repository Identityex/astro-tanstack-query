import { QueryClient, hydrate } from "@tanstack/query-core";
import { defaultOptions, settings, stateReader } from "virtual:astro-tanstack-query/config";
import { STATE_ELEMENT_ID } from "../serializer/types";
import { TanstackQueryAstroError } from "./errors";
import { documentReady } from "./document-ready";
import { isServer, requestScope } from "./scope-reader";

// Holding module evaluation also holds island hydration: no loading flash or premature fetch.
if (!isServer()) await documentReady(document);

let page: QueryClient | undefined;

/**
 * The one client for this page. Created on first use, never injected page-wide (D3),
 * so a page that imports no store pays nothing. `mount()` is what wires
 * refetchOnWindowFocus / refetchOnReconnect — without it they are silently dead.
 */
export function pageClient(): QueryClient {
  if (isServer()) {
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
  hydrateFromDocument(client, document);
  // View Transitions: the module survives navigation, the document does not.
  document.addEventListener("astro:before-swap", (event) => {
    hydrateFromDocument(client, (event as Event & { newDocument: Document }).newDocument);
  });
  page = client;
  return client;
}

/** Hydrates `client` from `doc`'s state element. Newer `dataUpdatedAt` wins; older is ignored. */
export function hydrateFromDocument(client: QueryClient, doc: Document): boolean {
  const element = doc.getElementById(STATE_ELEMENT_ID);
  if (!element) return false;
  const name = element.getAttribute("data-serializer");
  if (name !== stateReader.name) {
    throw new TanstackQueryAstroError(
      "serializer-mismatch",
      `page state was serialized with "${name ?? "unknown"}" but the client is configured for "${stateReader.name}". Set the same serializer in astro.config.`,
    );
  }
  hydrate(client, stateReader.parse(element.textContent ?? ""));
  return true;
}

/** The right client for where you are: the page client in the browser, the request client on the server. */
export function getQueryClient(): QueryClient {
  if (!isServer()) return pageClient();
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
  page?.unmount();
  page = undefined;
}
