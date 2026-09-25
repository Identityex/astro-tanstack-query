// @vitest-environment happy-dom
import type { UserConfig } from "vite";
import { afterEach, expect, it, vi } from "vitest";
import { VIRTUAL_ID } from "../../../src/integration/virtual-config";
import {
  absoluteUrl,
  createMutation,
  createQuery,
  derived,
  family,
} from "../../../src/query/index";
import { installTestQueryConfig, resetTestQueryClient } from "../../../src/testing/index";

/**
 * Consumer-shaped on purpose: every store comes from the package's public `/query` surface and
 * there is not one `vi.mock` in this file. That is the entry point's whole claim — a consumer's
 * unit test drives the real bridge, so it cannot drift from it the way a hand-rolled fake does.
 */

type Resolver = (id: string) => string | undefined;
type Loader = (id: string) => string | undefined;
type Configure = () => UserConfig;

afterEach(async () => {
  await resetTestQueryClient();
});

it("fetches once and shares the result with every reader", async () => {
  const queryFn = vi.fn(async () => ({ posts: 3 }));
  const $feed = createQuery({ queryKey: ["posts"], queryFn });
  const $same = createQuery({ queryKey: ["posts"], queryFn });
  const $count = derived($feed, (result) => result.data?.posts);

  $feed.subscribe(() => {});
  $same.subscribe(() => {});
  $count.subscribe(() => {});
  await vi.waitFor(() => expect($feed.get().data).toEqual({ posts: 3 }));

  // One fetch behind two stores and a derivation is the whole point: they share a cache because
  // they share the page client, not because a fake handed each of them the same object.
  expect(queryFn).toHaveBeenCalledTimes(1);
  expect($same.get().data).toEqual({ posts: 3 });
  expect($count.get()).toBe(3);
});

it("caches until the page client is reset", async () => {
  const queryFn = vi.fn(async () => "first post");
  const $first = createQuery({ queryKey: ["post"], queryFn });
  $first.subscribe(() => {});
  await vi.waitFor(() => expect($first.get().data).toBe("first post"));
  expect(queryFn).toHaveBeenCalledTimes(1);

  // What `afterEach(resetTestQueryClient)` buys a consumer: test two starts empty rather than
  // reading test one's cache.
  await resetTestQueryClient();

  const $afterReset = createQuery({ queryKey: ["post"], queryFn });
  $afterReset.subscribe(() => {});
  await vi.waitFor(() => expect($afterReset.get().data).toBe("first post"));
  expect(queryFn).toHaveBeenCalledTimes(2);
});

it("memoises a family member and resolves a relative path against the page", async () => {
  const $post = family((slug: string) => ({
    queryKey: ["post", slug],
    queryFn: async () => slug.toUpperCase(),
  }));
  const $hello = $post("hello-world");
  expect($post("hello-world")).toBe($hello);
  expect($post("second-post")).not.toBe($hello);

  $hello.subscribe(() => {});
  await vi.waitFor(() => expect($hello.get().data).toBe("HELLO-WORLD"));

  // Absolute against whatever origin the DOM environment sets, the point being that the browser
  // path needs no request scope to answer at all.
  expect(absoluteUrl("/api/posts")).toBe(new URL("/api/posts", window.location.href).href);
});

it("runs a mutation through the same client", async () => {
  const $publish = createMutation({ mutationFn: async (text: string) => `published: ${text}` });
  $publish.subscribe(() => {});
  await expect($publish.mutateAsync("second-post")).resolves.toBe("published: second-post");
  await vi.waitFor(() => expect($publish.get().data).toBe("published: second-post"));
});

it("serves the virtual config module Astro's own plugin serves", () => {
  const plugin = installTestQueryConfig();
  const resolveId = plugin.resolveId as Resolver;
  expect(resolveId(VIRTUAL_ID)).toBe("\0" + VIRTUAL_ID);
  expect(resolveId("other")).toBeUndefined();

  const code = (plugin.load as Loader)("\0" + VIRTUAL_ID) ?? "";
  expect(code).toContain(
    'export { reader as stateReader, writer as stateWriter } from "astro-tanstack-query/serializer/json";',
  );
  expect(code).toContain("export const defaultOptions = user.defaultOptions ?? {};");
  expect(code).toContain('"ssrStaleTime":60000');
});

it("takes the integration's options, so a devalue consumer tests devalue", () => {
  const plugin = installTestQueryConfig({
    serializer: "devalue",
    config: "./src/query.config.ts",
    root: "/proj",
  });
  const code = (plugin.load as Loader)("\0" + VIRTUAL_ID) ?? "";
  expect(code).toContain('import * as user from "/proj/src/query.config.ts";');
  expect(code).toContain('from "astro-tanstack-query/serializer/devalue";');
});

it("keeps the package out of Vite's externals, where a virtual id cannot survive", () => {
  const vite = (installTestQueryConfig().config as Configure)();
  expect(vite.ssr?.noExternal).toEqual(["astro-tanstack-query"]);
  expect(vite.resolve?.dedupe).toEqual(["@tanstack/query-core", "nanostores"]);
});
