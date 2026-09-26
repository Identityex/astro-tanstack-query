import { QueryClient } from "@tanstack/query-core";
import { defineMiddleware } from "astro/middleware";
import { defaultOptions, settings, stateWriter } from "virtual:astro-tanstack-query/config";
import { injectState } from "./server/emit";
import { runInScope } from "./server/scope";

/**
 * One client per request (D4). It lives on `locals` for frontmatter and inside the request scope
 * for stores read during island SSR. There is no other way to reach a server client.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      ...defaultOptions,
      queries: { staleTime: settings.ssrStaleTime, ...defaultOptions.queries },
    },
  });
  context.locals.queryClient = queryClient;

  const response = await runInScope(
    {
      queryClient,
      url: context.url,
      callAction: context.callAction,
      isPrerendered: context.isPrerendered,
    },
    () => next(),
  );

  // Both modes go through injectState: it is what releases the request client once the response
  // has ended. In component mode it only releases; <QueryState /> has written the state itself.
  // Diagnostics also run while prerendering: `astro build` has DEV false, and it is where a
  // prefetch through absoluteUrl() fails. Passed in, because the scope is gone by flush.
  const warn = import.meta.env.DEV || context.isPrerendered;
  return injectState(response, queryClient, settings.emit === "middleware" ? stateWriter : null, {
    warn,
  });
});
