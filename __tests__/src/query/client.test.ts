// @vitest-environment happy-dom
import { QueryClient, dehydrate } from "@tanstack/query-core";
import { afterEach, expect, it, vi } from "vitest";
import { STATE_ELEMENT_ID } from "../../../src/serializer/types";
import { writer } from "../../../src/serializer/json";
import {
  getQueryClient,
  hydrateFromDocument,
  pageClient,
  resetPageClientForTests,
} from "../../../src/query/client";

function stateElement(
  doc: Document,
  client: QueryClient,
  serializerName = "json",
): HTMLScriptElement {
  const el = doc.createElement("script");
  el.type = "application/json";
  el.id = STATE_ELEMENT_ID;
  el.dataset["serializer"] = serializerName;
  el.textContent = writer.stringify(dehydrate(client));
  doc.body.appendChild(el);
  return el;
}

async function clientWith(key: unknown[], data: unknown, updatedAt: number): Promise<QueryClient> {
  const source = new QueryClient();
  await source.prefetchQuery({ queryKey: key, queryFn: () => data });
  source.getQueryCache().find({ queryKey: key })?.setState({ dataUpdatedAt: updatedAt });
  return source;
}

afterEach(() => {
  resetPageClientForTests();
  document.getElementById(STATE_ELEMENT_ID)?.remove();
  vi.restoreAllMocks();
});

it("creates one client per page and mounts it", () => {
  const mount = vi.spyOn(QueryClient.prototype, "mount");
  expect(pageClient()).toBe(pageClient());
  expect(mount).toHaveBeenCalledTimes(1);
  expect(getQueryClient()).toBe(pageClient());
});

it("carries the configured SSR staleTime, so hydrated data is not stale on arrival", () => {
  // The prefetch is only worth anything if the page client agrees with the request client about
  // freshness; at staleTime 0 every hydrated query refetches the moment an island mounts.
  expect(pageClient().getDefaultOptions().queries?.staleTime).toBe(60_000);
});

it("hydrates from the state element on creation", async () => {
  stateElement(document, await clientWith(["thing"], { value: 1 }, 10));
  expect(pageClient().getQueryData(["thing"])).toEqual({ value: 1 });
});

it("refuses a blob written by a different serializer", async () => {
  stateElement(document, await clientWith(["thing"], 1, 10), "devalue");
  expect(() => pageClient()).toThrowError(/serialized with "devalue"/);
});

it.each([
  ["written by another serializer", "devalue", undefined],
  ["that is not valid JSON", "json", "{not json"],
])(
  "keeps one page client when the page's state %s fails to hydrate",
  async (_, serializerName, text) => {
    const el = stateElement(document, await clientWith(["thing"], 1, 10), serializerName);
    if (text !== undefined) el.textContent = text;
    const mount = vi.spyOn(QueryClient.prototype, "mount");

    expect(() => pageClient()).toThrow();
    // Every later store read reaches pageClient() again; each one used to build and mount another
    // client, with its own focus and online listeners, and throw again.
    const client = pageClient();
    expect(pageClient()).toBe(client);
    expect(mount).toHaveBeenCalledTimes(1);
  },
);

it("re-hydrates from a new document only when the data is newer", async () => {
  stateElement(document, await clientWith(["thing"], "old", 10));
  const client = pageClient();

  const staleDoc = document.implementation.createHTMLDocument();
  stateElement(staleDoc, await clientWith(["thing"], "stale", 5));
  expect(hydrateFromDocument(client, staleDoc)).toBe(true);
  expect(client.getQueryData(["thing"])).toBe("old");

  const newerDoc = document.implementation.createHTMLDocument();
  stateElement(newerDoc, await clientWith(["thing"], "new", 20));
  hydrateFromDocument(client, newerDoc);
  expect(client.getQueryData(["thing"])).toBe("new");
});

it("returns false when a document carries no state", () => {
  expect(hydrateFromDocument(pageClient(), document.implementation.createHTMLDocument())).toBe(
    false,
  );
});
