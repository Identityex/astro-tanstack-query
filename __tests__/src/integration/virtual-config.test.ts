import { expect, it } from "vitest";
import { resolveOptions } from "../../../src/integration/options";
import { VIRTUAL_ID, virtualConfigPlugin } from "../../../src/integration/virtual-config";

type Loader = (id: string) => string | undefined;
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
