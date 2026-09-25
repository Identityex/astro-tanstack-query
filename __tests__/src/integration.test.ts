import { expect, it, vi } from "vitest";
import tanstackQuery from "../../src/integration";

it("wires middleware, vite config and types", async () => {
  const integration = tanstackQuery({ devtools: true });
  expect(integration.name).toBe("astro-tanstack-query");

  const addMiddleware = vi.fn();
  const updateConfig = vi.fn();
  const addDevToolbarApp = vi.fn();
  const injectTypes = vi.fn(() => new URL("file:///proj/.astro/types.d.ts"));

  const setup = integration.hooks["astro:config:setup"];
  const done = integration.hooks["astro:config:done"];
  if (!setup || !done) throw new Error("hooks missing");

  await setup({
    addMiddleware,
    updateConfig,
    addDevToolbarApp,
    command: "dev",
    config: { root: new URL("file:///proj/") },
  } as unknown as Parameters<typeof setup>[0]);
  await done({ injectTypes } as unknown as Parameters<typeof done>[0]);

  expect(addMiddleware).toHaveBeenCalledWith({
    entrypoint: "astro-tanstack-query/middleware",
    order: "pre",
  });
  const vite = updateConfig.mock.calls[0]?.[0].vite;
  expect(vite.resolve.dedupe).toEqual(["@tanstack/query-core", "nanostores"]);
  expect(vite.ssr.noExternal).toEqual(["astro-tanstack-query"]);
  expect(vite.optimizeDeps.exclude).toEqual(["astro-tanstack-query"]);
  expect(vite.plugins).toHaveLength(1);
  expect(addDevToolbarApp).toHaveBeenCalledWith(
    expect.objectContaining({ id: "astro-tanstack-query" }),
  );
  expect(injectTypes).toHaveBeenCalledWith({
    filename: "types.d.ts",
    content: expect.stringContaining("interface Locals"),
  });
});
