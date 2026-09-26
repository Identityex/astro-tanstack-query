// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { pageClient, resetPageClientForTests } from "../../../src/query/client";
import {
  EXTENSION_NAME,
  INVALIDATED_EVENT,
  keyFor,
  registerExtension,
  type HtmxApi,
  type HtmxExtension,
} from "../../../src/htmx/extension";

afterEach(() => resetPageClientForTests());

function fakeHtmx() {
  let extension: HtmxExtension | undefined;
  const htmx: HtmxApi = {
    defineExtension: (name, ext) => {
      expect(name).toBe(EXTENSION_NAME);
      extension = ext;
    },
    swap: vi.fn(),
  };
  registerExtension(htmx);
  if (!extension) throw new Error("extension not registered");
  return { htmx, extension };
}

function getElement(url: string, attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement("button");
  el.setAttribute("hx-get", url);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
}

const beforeRequest = (elt: HTMLElement, target: HTMLElement, finalRequestPath?: string) =>
  new CustomEvent("htmx:beforeRequest", {
    detail: {
      elt,
      target,
      pathInfo: { requestPath: elt.getAttribute("hx-get"), finalRequestPath },
    },
  });

const xhr = (status: number) => ({ status }) as XMLHttpRequest;

it("misses, stores the response, then serves from cache and cancels the request", () => {
  const { htmx, extension } = fakeHtmx();
  const elt = getElement("/frag", { "hx-swap": "outerHTML", "hx-tq-stale-time": "60000" });
  const target = document.createElement("div");

  expect(extension.onEvent("htmx:beforeRequest", beforeRequest(elt, target))).toBe(true);
  expect(extension.transformResponse("<span>one</span>", xhr(200), elt)).toBe("<span>one</span>");
  expect(pageClient().getQueryData(keyFor("/frag"))).toBe("<span>one</span>");

  expect(extension.onEvent("htmx:beforeRequest", beforeRequest(elt, target))).toBe(false);
  expect(htmx.swap).toHaveBeenCalledWith(
    target,
    "<span>one</span>",
    { swapStyle: "outerHTML" },
    { select: undefined },
  );
});

it("treats a stale entry as a miss", () => {
  const { extension } = fakeHtmx();
  const elt = getElement("/stale");
  extension.transformResponse("x", xhr(200), elt);
  expect(extension.onEvent("htmx:beforeRequest", beforeRequest(elt, document.body))).toBe(true);
});

it("does not inherit the page client's default staleTime", () => {
  const { htmx, extension } = fakeHtmx();
  // The page client caches SSR-prefetched data for the hydration handoff; a fragment must not
  // silently ride on that default, or every un-annotated hx-get would stop revalidating.
  expect(pageClient().getDefaultOptions().queries?.staleTime).toBe(60_000);
  const elt = getElement("/uncached");
  const target = document.createElement("div");

  extension.onEvent("htmx:beforeRequest", beforeRequest(elt, target));
  extension.transformResponse("<span>stored</span>", xhr(200), elt);
  expect(pageClient().getQueryData(keyFor("/uncached"))).toBe("<span>stored</span>");

  expect(extension.onEvent("htmx:beforeRequest", beforeRequest(elt, target))).toBe(true);
  expect(htmx.swap).not.toHaveBeenCalled();
});

it("does not cache an error response", () => {
  const { extension } = fakeHtmx();
  const elt = getElement("/boom", { "hx-tq-stale-time": "60000" });
  const target = document.createElement("div");

  extension.onEvent("htmx:beforeRequest", beforeRequest(elt, target));
  expect(extension.transformResponse("<p>not found</p>", xhr(404), elt)).toBe("<p>not found</p>");
  expect(pageClient().getQueryData(keyFor("/boom"))).toBeUndefined();
  // Still a miss next time, so htmx goes back to the server rather than replaying the 404 body.
  expect(extension.onEvent("htmx:beforeRequest", beforeRequest(elt, target))).toBe(true);
});

it("keys on the path htmx resolved, so one element's parameter sets do not collide", () => {
  const { htmx, extension } = fakeHtmx();
  const elt = getElement("/search", { "hx-tq-stale-time": "60000" });
  const target = document.createElement("div");

  extension.onEvent("htmx:beforeRequest", beforeRequest(elt, target, "/search?q=a"));
  extension.transformResponse("<i>a</i>", xhr(200), elt);

  expect(extension.onEvent("htmx:beforeRequest", beforeRequest(elt, target, "/search?q=b"))).toBe(
    true,
  );
  expect(htmx.swap).not.toHaveBeenCalled();
  extension.transformResponse("<i>b</i>", xhr(200), elt);

  expect(pageClient().getQueryData(keyFor("/search?q=a"))).toBe("<i>a</i>");
  expect(pageClient().getQueryData(keyFor("/search?q=b"))).toBe("<i>b</i>");
  expect(pageClient().getQueryData(keyFor("/search"))).toBeUndefined();

  // And the first parameter set is still served from its own entry.
  expect(extension.onEvent("htmx:beforeRequest", beforeRequest(elt, target, "/search?q=a"))).toBe(
    false,
  );
  expect(htmx.swap).toHaveBeenCalledWith(
    target,
    "<i>a</i>",
    { swapStyle: "innerHTML" },
    { select: undefined },
  );
});

it("looks a fragment up by its hash rather than scanning the cache", () => {
  const { htmx, extension } = fakeHtmx();
  // Stand-ins for everything else a page caches: find() would re-hash the key against each one,
  // on every hx-get, and a miss is the normal case for the first request to any URL.
  for (let i = 0; i < 50; i++) pageClient().setQueryData(["other", i], i);
  const elt = getElement("/hashed", { "hx-tq-stale-time": "60000" });
  const target = document.createElement("div");
  extension.onEvent("htmx:beforeRequest", beforeRequest(elt, target));
  extension.transformResponse("<span>hit</span>", xhr(200), elt);
  const scan = vi.spyOn(pageClient().getQueryCache(), "getAll");

  expect(extension.onEvent("htmx:beforeRequest", beforeRequest(elt, target))).toBe(false);
  expect(htmx.swap).toHaveBeenCalledWith(
    target,
    "<span>hit</span>",
    { swapStyle: "innerHTML" },
    { select: undefined },
  );
  expect(extension.onEvent("htmx:beforeRequest", beforeRequest(getElement("/miss"), target))).toBe(
    true,
  );
  expect(scan).not.toHaveBeenCalled();
});

it("serves a cached fragment under a custom queryKeyHashFn from the client defaults", () => {
  const { htmx, extension } = fakeHtmx();
  // What a `config` module's defaultOptions would give the page client. A lookup that hashed the
  // key itself with hashKey() would miss every fragment setQueryData stored under this hash.
  const queryKeyHashFn = (key: readonly unknown[]) => `custom:${JSON.stringify(key)}`;
  const client = pageClient();
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, queryKeyHashFn } });
  const elt = getElement("/custom-hash", { "hx-tq-stale-time": "60000" });
  const target = document.createElement("div");

  extension.onEvent("htmx:beforeRequest", beforeRequest(elt, target));
  extension.transformResponse("<span>custom</span>", xhr(200), elt);
  expect(client.getQueryCache().get('custom:["htmx","/custom-hash"]')).toBeDefined();

  expect(extension.onEvent("htmx:beforeRequest", beforeRequest(elt, target))).toBe(false);
  expect(htmx.swap).toHaveBeenCalledWith(
    target,
    "<span>custom</span>",
    { swapStyle: "innerHTML" },
    { select: undefined },
  );
});

it("invalidates declared keys after a successful non-GET and dispatches the DOM event", async () => {
  const { extension } = fakeHtmx();
  await pageClient().prefetchQuery({ queryKey: ["todos"], queryFn: async () => "t" });
  const form = document.createElement("form");
  form.setAttribute("hx-post", "/todos");
  form.setAttribute("hx-tq-invalidate", '[["todos"]]');
  document.body.appendChild(form);
  const listener = vi.fn();
  document.body.addEventListener(INVALIDATED_EVENT, listener);

  extension.onEvent(
    "htmx:afterRequest",
    new CustomEvent("htmx:afterRequest", { detail: { elt: form, successful: true } }),
  );
  await vi.waitFor(() => expect(listener).toHaveBeenCalled());
  const event = listener.mock.calls[0]?.[0] as CustomEvent<{ key: unknown[] }>;
  expect(event.detail.key).toEqual(["todos"]);
});

it("inherits hx-tq-stale-time from an ancestor, like hx-tq-invalidate", () => {
  const { htmx, extension } = fakeHtmx();
  // The opt-in lives on a container, which is how anyone would mark a group of fragments as
  // cacheable. Reading it with getAttribute instead of closest() would silently ignore it.
  const container = document.createElement("div");
  container.setAttribute("hx-tq-stale-time", "60000");
  document.body.appendChild(container);
  const elt = document.createElement("button");
  elt.setAttribute("hx-get", "/inherited");
  container.appendChild(elt);
  const target = document.createElement("div");

  expect(extension.onEvent("htmx:beforeRequest", beforeRequest(elt, target))).toBe(true);
  extension.transformResponse("<span>one</span>", xhr(200), elt);

  // Fresh under the inherited 60 s, so this must be served from cache and the request cancelled.
  expect(extension.onEvent("htmx:beforeRequest", beforeRequest(elt, target))).toBe(false);
  expect(htmx.swap).toHaveBeenCalled();
});
