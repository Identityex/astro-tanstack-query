import type { QueryKey } from "@tanstack/query-core";
import type { APIContext } from "astro";
import { settings } from "virtual:astro-tanstack-query/config";
import { afterEach, expect, it, vi } from "vitest";
import { onRequest } from "../../src/middleware";
import { requestScope } from "../../src/query/scope-reader";
import { absoluteUrl } from "../../src/query/url";
import { reader } from "../../src/serializer/json";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

interface Where {
  url?: string;
  /** Astro hands a rewrite, and an error page after a failed render, the same `locals` object. */
  locals?: object;
}

function context(
  isPrerendered = false,
  { url = "http://x/page", locals = {} }: Where = {},
): APIContext {
  return {
    url: new URL(url),
    locals,
    isPrerendered,
    callAction: (() => Promise.resolve({ data: undefined })) as unknown as APIContext["callAction"],
  } as unknown as APIContext;
}

const html = (body: string) => new Response(body, { headers: { "content-type": "text/html" } });
const page = (body: string) => html(`<!DOCTYPE html><html><body>${body}</body></html>`);

/** The query keys in each state element of `text`, one list per element. */
function stateKeys(text: string): QueryKey[][] {
  const elements = text.matchAll(
    /<script type="application\/json" id="astro-tq"[^>]*>(.*?)<\/script>/gs,
  );
  return [...elements].map(([, state]) =>
    reader.parse(state ?? "").queries.map((query) => query.queryKey),
  );
}

it("creates a per-request client on locals with the ssr staleTime", async () => {
  const ctx = context();
  await onRequest(ctx, () => Promise.resolve(html("<body></body>")));
  expect(ctx.locals.queryClient.getDefaultOptions().queries?.staleTime).toBe(60_000);
});

it("makes the scope visible while rendering and emits the state", async () => {
  const ctx = context();
  const response = await onRequest(ctx, async () => {
    const scope = requestScope();
    expect(scope?.queryClient).toBe(ctx.locals.queryClient);
    expect(scope?.url).toBe(ctx.url);
    await ctx.locals.queryClient.prefetchQuery({ queryKey: ["t"], queryFn: async () => 1 });
    return html("<body><p>hi</p></body>");
  });
  const text = await (response as Response).text();
  expect(text).toContain('id="astro-tq"');
  expect(text.indexOf("astro-tq")).toBeLessThan(text.indexOf("</body>"));
});

it("gives every request its own client", async () => {
  const a = context();
  const b = context();
  await onRequest(a, () => Promise.resolve(html("")));
  await onRequest(b, () => Promise.resolve(html("")));
  expect(a.locals.queryClient).not.toBe(b.locals.queryClient);
});

type Emit = typeof settings.emit;

/** The middleware reads the emit mode per request, so one case can switch it and put it back. */
async function withEmit<T>(emit: Emit, run: () => Promise<T>): Promise<T> {
  const previous = settings.emit;
  settings.emit = emit;
  try {
    return await run();
  } finally {
    settings.emit = previous;
  }
}

async function respond(ctx: APIContext, render: () => Promise<Response>): Promise<Response> {
  const response = await onRequest(ctx, render);
  if (!(response instanceof Response)) throw new Error("the middleware returned no Response");
  return response;
}

// An explicit gcTime arms a server eviction timer that pins the client until clear() cancels it.
const prefetchRetained = (ctx: APIContext) =>
  ctx.locals.queryClient.prefetchQuery({
    queryKey: ["kept"],
    queryFn: async () => 1,
    gcTime: 60_000,
  });

it.each<Emit>(["middleware", "component"])(
  "releases the request client after an endpoint in %s mode",
  async (emit) => {
    const ctx = context();
    await withEmit(emit, () =>
      respond(ctx, async () => {
        await prefetchRetained(ctx);
        return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
      }),
    );
    expect(ctx.locals.queryClient.getQueryCache().getAll()).toHaveLength(0);
  },
);

it("in component mode, adds no state to a page and releases its client once the body has streamed", async () => {
  const ctx = context();
  const page = "<!DOCTYPE html><html><body><p>hi</p></body></html>";
  const response = await withEmit("component", () =>
    respond(ctx, async () => {
      await prefetchRetained(ctx);
      return html(page);
    }),
  );
  // The body renders as it streams; islands and <QueryState /> still read the client until then.
  expect(ctx.locals.queryClient.getQueryCache().getAll()).toHaveLength(1);
  expect(await response.text()).toBe(page);
  expect(ctx.locals.queryClient.getQueryCache().getAll()).toHaveLength(0);
});

it("tells the request scope whether the page is being prerendered", async () => {
  const seen: (boolean | undefined)[] = [];
  for (const prerendering of [true, false]) {
    await respond(context(prerendering), async () => {
      seen.push(requestScope()?.isPrerendered);
      return html("");
    });
  }
  expect(seen).toEqual([true, false]);
});

const failedPrefetch = (ctx: APIContext) =>
  ctx.locals.queryClient.prefetchQuery({
    queryKey: ["from-the-build-origin"],
    queryFn: async (): Promise<never> => {
      throw new Error("fetch failed");
    },
    retry: false,
  });

it.each([
  [true, false, 1],
  [false, true, 1],
  [false, false, 0],
])(
  "with DEV %s and prerendering %s, warns %i time(s) about a failed prefetch",
  async (dev, prerendering, warnings) => {
    vi.stubEnv("DEV", dev);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = context(prerendering);
    const response = await respond(ctx, async () => {
      await failedPrefetch(ctx);
      return html("<!DOCTYPE html><html><body></body></html>");
    });

    const text = await response.text();

    expect(text).not.toContain('id="astro-tq"');
    expect(warn).toHaveBeenCalledTimes(warnings);
    if (warnings > 0) expect(warn.mock.calls[0]?.[0]).toContain('["from-the-build-origin"]');
  },
);

async function withOrigin<T>(origin: string, run: () => Promise<T>): Promise<T> {
  const previous = settings.origin;
  settings.origin = origin;
  try {
    return await run();
  } finally {
    settings.origin = previous;
  }
}

it("under Astro.rewrite(), keeps the request's client and writes one state element", async () => {
  // Astro.rewrite() runs the middleware again from inside the page that called it, on its `locals`.
  const locals = {};
  const product = context(false, { url: "http://x/product/p-1", locals });
  const notFound = context(false, { url: "http://x/404", locals });
  const response = await respond(product, async () => {
    await product.locals.queryClient.prefetchQuery({
      queryKey: ["product", "p-1"],
      queryFn: async () => null,
    });
    return respond(notFound, async () => {
      expect(requestScope()?.url.pathname).toBe("/404");
      expect(requestScope()?.queryClient).toBe(product.locals.queryClient);
      await notFound.locals.queryClient.prefetchQuery({
        queryKey: ["notFoundCopy"],
        queryFn: async () => "gone",
      });
      return page("<p>not found</p>");
    });
  });

  expect(stateKeys(await response.text())).toEqual([[["product", "p-1"], ["notFoundCopy"]]]);
  expect(product.locals.queryClient.getQueryCache().getAll()).toHaveLength(0);
});

it("gives an error page its own client after a failed render, though they share `locals`", async () => {
  // Astro renders 404.astro or 500.astro with the failed render's `locals` (the Vercel adapter
  // always passes one), but only once that render has left its scope.
  const locals = {};
  const failed = context(false, { url: "http://x/broken", locals });
  await expect(respond(failed, () => Promise.reject(new Error("render failed")))).rejects.toThrow(
    "render failed",
  );
  const failedClient = failed.locals.queryClient;

  const errorPage = context(false, { url: "http://x/500", locals });
  const response = await respond(errorPage, async () => {
    await errorPage.locals.queryClient.prefetchQuery({
      queryKey: ["errorCopy"],
      queryFn: async () => "oops",
    });
    return page("<p>500</p>");
  });

  expect(errorPage.locals.queryClient).not.toBe(failedClient);
  expect(stateKeys(await response.text())).toEqual([[["errorCopy"]]]);
});

it("releases the request client when the render throws", async () => {
  const ctx = context();
  await expect(
    respond(ctx, async () => {
      await prefetchRetained(ctx);
      throw new Error("render failed");
    }),
  ).rejects.toThrow("render failed");
  expect(ctx.locals.queryClient.getQueryCache().getAll()).toHaveLength(0);
});

it("leaves a rewrite that throws to the page that called it, which may render on", async () => {
  const locals = {};
  const product = context(false, { url: "http://x/product/p-1", locals });
  const broken = context(false, { url: "http://x/broken", locals });
  const response = await respond(product, async () => {
    await product.locals.queryClient.prefetchQuery({
      queryKey: ["product", "p-1"],
      queryFn: async () => null,
    });
    await respond(broken, () => Promise.reject(new Error("rewrite failed"))).catch(() => null);
    return page("<p>fallback</p>");
  });

  expect(stateKeys(await response.text())).toEqual([[["product", "p-1"]]]);
});

it("refuses to serve from a process with a global window, where stores would share one cache", async () => {
  vi.stubGlobal("window", {});
  const ctx = context();
  const render = vi.fn(() => Promise.resolve(page("")));

  await expect(onRequest(ctx, render)).rejects.toMatchObject({ kind: "window-on-server" });
  expect(render).not.toHaveBeenCalled();
});

it("with ssr.origin, resolves absoluteUrl() against it rather than a forged Host", async () => {
  // On @astrojs/node the request URL's host is whatever Host header the client sent.
  const ctx = context(false, { url: "http://169.254.169.254/page?x=1" });
  const seen: string[] = [];
  await withOrigin("https://app.example", () =>
    respond(ctx, async () => {
      seen.push(absoluteUrl("/api/x"), requestScope()?.url.href ?? "no scope");
      return html("");
    }),
  );
  expect(seen).toEqual(["https://app.example/api/x", "https://app.example/page?x=1"]);
});
