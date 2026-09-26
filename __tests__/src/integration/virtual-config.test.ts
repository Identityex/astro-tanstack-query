import { expect, it } from "vitest";
import { resolveOptions } from "../../../src/integration/options";
import { VIRTUAL_ID, virtualConfigPlugin } from "../../../src/integration/virtual-config";

type Loader = (id: string, opts?: { ssr?: boolean }) => string | undefined;
type Resolver = (id: string) => string | undefined;
const plugin = (options: Parameters<typeof resolveOptions>[0]) =>
  virtualConfigPlugin(resolveOptions(options), new URL("file:///proj/"));

it("resolves only its own id", () => {
  const p = plugin({});
  const resolveId = p.resolveId as Resolver;
  expect(resolveId(VIRTUAL_ID)).toBe("\0" + VIRTUAL_ID);
  expect(resolveId("other")).toBeUndefined();
});

it("generates the json default module", () => {
  const load = plugin({}).load as Loader;
  const code = load("\0" + VIRTUAL_ID) ?? "";
  // Both halves, under distinct names: naming only one is what lets the other be shaken out of
  // the browser bundle, so a regression to a single `serializer` export must fail here.
  expect(code).toContain(
    'export { reader as stateReader, writer as stateWriter } from "astro-tanstack-query/serializer/json";',
  );
  expect(code).toContain("stateReader");
  expect(code).toContain("stateWriter");
  expect(code).toContain("export const defaultOptions = user.defaultOptions ?? {};");
  expect(code).toContain('"emit":"middleware"');
  expect(code).toContain('"ssrStaleTime":60000');
  // The browser reads this object too: an unset origin must not reach it, even as null.
  expect(code).not.toContain("origin");
});

it("sets browserBuild only when Vite loads the module for the client", () => {
  const load = plugin({}).load as Loader;
  // True is what lets a client build fold every server branch away; anything else must keep the
  // runtime check, because a module that thinks it is in a browser takes the page client on a
  // server and shares it across requests.
  expect(load("\0" + VIRTUAL_ID, { ssr: false })).toContain("export const browserBuild = true;");
  expect(load("\0" + VIRTUAL_ID, { ssr: true })).toContain("export const browserBuild = false;");
  expect(load("\0" + VIRTUAL_ID)).toContain("export const browserBuild = false;");
});

it("lets a caller fix browserBuild whatever environment Vite names", () => {
  const load = virtualConfigPlugin(resolveOptions({}), new URL("file:///proj/"), {
    browserBuild: false,
  }).load as Loader;
  expect(load("\0" + VIRTUAL_ID, { ssr: false })).toContain("export const browserBuild = false;");
});

it("carries ssr.origin in the settings when it is set", () => {
  const load = plugin({ ssr: { origin: "https://example.com/" } }).load as Loader;
  expect(load("\0" + VIRTUAL_ID)).toContain('"origin":"https://example.com"');
});

it("imports the user config file and the devalue serializer when asked", () => {
  const load = plugin({ config: "./src/query.config.ts", serializer: "devalue" }).load as Loader;
  const code = load("\0" + VIRTUAL_ID) ?? "";
  expect(code).toContain('import * as user from "/proj/src/query.config.ts";');
  expect(code).toContain(
    'export { reader as stateReader, writer as stateWriter } from "astro-tanstack-query/serializer/devalue";',
  );
});
