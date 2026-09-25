import type { APIContext } from "astro";
import { settings } from "virtual:astro-tanstack-query/config";
import { expect, it } from "vitest";
import { onRequest } from "../../src/middleware";
import { requestScope } from "../../src/query/scope-reader";

function context(): APIContext {
  return {
    url: new URL("http://x/page"),
    locals: {},
    callAction: (() => Promise.resolve({ data: undefined })) as unknown as APIContext["callAction"],
  } as unknown as APIContext;
}

const html = (body: string) => new Response(body, { headers: { "content-type": "text/html" } });

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
    expect(scope?.url.pathname).toBe("/page");
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
