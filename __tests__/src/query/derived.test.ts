import { QueryClient } from "@tanstack/query-core";
import { atom } from "nanostores";
import { afterEach, expect, it, vi } from "vitest";
import { derived } from "../../../src/query/derived";
import { SCOPE_KEY, type RequestScope } from "../../../src/query/scope-reader";
import { createQuery } from "../../../src/query/store";

const holder = globalThis as Record<string, unknown>;
const publish = (scope: RequestScope) => {
  holder[SCOPE_KEY] = { getStore: () => scope };
};
async function requestHolding(secret: string): Promise<RequestScope> {
  const queryClient = new QueryClient();
  await queryClient.prefetchQuery({ queryKey: ["secret"], queryFn: async () => secret });
  return { queryClient, url: new URL("http://x/") };
}
/** Every value a listener was handed, in order. nanostores also passes the old value; ignore it. */
const seenBy = (listener: ReturnType<typeof vi.fn>): unknown[] =>
  listener.mock.calls.map(([value]) => value);

afterEach(() => {
  delete holder[SCOPE_KEY];
  vi.unstubAllGlobals();
});

it("recomputes per read on the server, so one request cannot read another's value", async () => {
  const $secret = createQuery({ queryKey: ["secret"], queryFn: async () => "unfetched" });
  const $shown = derived($secret, (result) => result.data);

  publish(await requestHolding("secret-for-alice"));
  expect($shown.get()).toBe("secret-for-alice");

  // nanostores' own computed() answers "secret-for-alice" here: its epoch cache is module-scoped
  // and no store wrote, so it never recomputes. That is the leak this store exists to close.
  publish(await requestHolding("secret-for-bob"));
  expect($shown.get()).toBe("secret-for-bob");
});

it("recomputes every source of an array derivation per read on the server", async () => {
  const $secret = createQuery({ queryKey: ["secret"], queryFn: async () => "unfetched" });
  const $window = atom("today");
  const $line = derived([$secret, $window], (result, window) => `${result.data} in ${window}`);

  publish(await requestHolding("secret-for-alice"));
  expect($line.get()).toBe("secret-for-alice in today");

  // The array form is the shape that tempts a caller back to computed(), so it has to hold the
  // same discipline: both the request-scoped source and the plain one are read fresh.
  publish(await requestHolding("secret-for-bob"));

  // Read BEFORE touching $window. Writing any store bumps nanostores' epoch, which makes even a
  // leaky computed() recompute — so an assertion made after the write passes either way and tests
  // nothing. This read is the one that fails if the array form caches across requests.
  expect($line.get()).toBe("secret-for-bob in today");

  $window.set("this-week");
  expect($line.get()).toBe("secret-for-bob in this-week");
});

it("hands a server subscriber the snapshot once and nothing after", async () => {
  publish(await requestHolding("secret-for-alice"));
  const $shown = derived(
    createQuery({ queryKey: ["secret"], queryFn: async () => "unfetched" }),
    (result) => result.data,
  );

  const listener = vi.fn();
  const stop = $shown.subscribe(listener);
  expect(listener.mock.calls).toEqual([["secret-for-alice"]]);
  stop();
  expect($shown.listen(() => {})).toBeTypeOf("function");
});

it("tracks the source in the browser", () => {
  vi.stubGlobal("window", {});
  const $window = atom("today");
  const $label = derived($window, (current) => `top posts: ${current}`);

  // Subscription is what separates the two paths. Both recompute on get(), so reading the value
  // after a set() would pass on the server path too; only the browser path calls a listener a
  // second time, because only it is tracking the source.
  const listener = vi.fn();
  $label.subscribe(listener);
  $window.set("this-week");
  expect(seenBy(listener)).toEqual(["top posts: today", "top posts: this-week"]);
});

it("tracks every source of an array derivation in the browser", () => {
  vi.stubGlobal("window", {});
  const $window = atom("today");
  const $facet = atom("person");
  const $label = derived([$facet, $window], (facet, window) => `${facet}/${window}`);

  const listener = vi.fn();
  $label.subscribe(listener);
  $facet.set("place");
  $window.set("all-time");
  expect(seenBy(listener)).toEqual(["person/today", "place/today", "place/all-time"]);
});
