import { QueryClient } from "@tanstack/query-core";
import { defineMiddleware } from "astro/middleware";
import { defaultOptions, settings, stateWriter } from "virtual:astro-tanstack-query/config";
import { TanstackQueryAstroError } from "./query/errors";
import { injectState, SERVER_ISLAND_ROUTE } from "./server/emit";
import { currentScope, runInScope } from "./server/scope";

/**
 * One client per request (D4). It lives on `locals` for frontmatter and inside the request scope
 * for stores read during island SSR. There is no other way to reach a server client.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  // Stores decide their side with `typeof window` (D15). A DOM shim registered globally on the
  // server sends every one of them to the page client, a module singleton: one visitor's prefetch
  // would be served to the next. Failing every request is the only safe answer.
  if (typeof window !== "undefined") {
    throw new TanstackQueryAstroError(
      "window-on-server",
      "a global `window` exists in the server process (a DOM shim or registrator?). Every store would take its browser path and share one cache across requests. Remove the global shim from the server.",
    );
  }

  // Astro.rewrite() runs the middleware again, inside the page that called it. That pass keeps the
  // request's client and leaves emitting and releasing to the outer one, so the document gets one
  // state element holding both pages' prefetches. Keyed on the scope, not on `locals`: an error
  // page rendered after a failed one can share its `locals` object (the Vercel adapter passes
  // one), but it renders once the failed pass has left its scope, and needs a client of its own.
  const outer = currentScope();
  const queryClient =
    outer?.queryClient ??
    new QueryClient({
      defaultOptions: {
        ...defaultOptions,
        queries: { staleTime: settings.ssrStaleTime, ...defaultOptions.queries },
      },
    });
  context.locals.queryClient = queryClient;

  // Entered on every pass, so absoluteUrl() resolves against the page actually rendering. On
  // @astrojs/node the URL's host is the client's Host header, unchecked; `ssr.origin` replaces it.
  let response: Response;
  try {
    response = await runInScope(
      {
        queryClient,
        url: settings.origin
          ? new URL(context.url.pathname + context.url.search, settings.origin)
          : context.url,
        callAction: context.callAction,
        isPrerendered: context.isPrerendered,
      },
      () => next(),
    );
  } catch (error) {
    // A page that throws before responding never reaches injectState, which is what releases the
    // client; an explicit gcTime would otherwise pin it. A rewritten pass leaves that to the page
    // that called it, which may catch the error and render on.
    if (!outer) queryClient.clear();
    throw error;
  }
  if (outer) return response;

  // Both modes go through injectState: it is what releases the request client once the response
  // has ended. In component mode it only releases; <QueryState /> has written the state itself.
  // Diagnostics also run while prerendering: `astro build` has DEV false, and it is where a
  // prefetch through absoluteUrl() fails. Passed in, because the scope is gone by flush.
  // Keyed on the route rather than on "is a fragment": a server island's HTML lands in a page
  // whose client drains its state, an htmx partial's does not.
  const warn = import.meta.env.DEV || context.isPrerendered;
  const island = context.routePattern === SERVER_ISLAND_ROUTE;
  return injectState(response, queryClient, settings.emit === "middleware" ? stateWriter : null, {
    warn,
    island,
  });
});
