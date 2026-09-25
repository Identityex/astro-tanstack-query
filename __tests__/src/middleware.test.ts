import type { APIContext } from "astro";
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
