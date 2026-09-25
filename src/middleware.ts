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
    { queryClient, url: context.url, callAction: context.callAction },
    () => next(),
  );

  return settings.emit === "middleware"
    ? injectState(response, queryClient, stateWriter)
    : response;
});
