import { QueryClient } from "@tanstack/query-core";
import { expect, it } from "vitest";
import { writer } from "../../../src/serializer/json";
import { injectState, stateScript } from "../../../src/server/emit";

async function prefetched(): Promise<QueryClient> {
  const client = new QueryClient();
  await client.prefetchQuery({ queryKey: ["thing"], queryFn: async () => "<b>hi</b>" });
  return client;
}

function htmlResponse(chunks: string[], headers: Record<string, string> = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "x-keep": "1", ...headers },
  });
}

it("stateScript is null when there is nothing to dehydrate", () => {
  expect(stateScript(new QueryClient(), writer)).toBeNull();
});

it("stateScript emits an escaped json script element", async () => {
  const script = stateScript(await prefetched(), writer);
  expect(script).toMatch(/^<script type="application\/json" id="astro-tq" data-serializer="json">/);
  expect(script).not.toContain("<b>");
  expect(script).toContain("\\u003cb\\u003e");
});

it("injects before </body> even when the marker is split across chunks", async () => {
  const client = await prefetched();
  const response = injectState(
    htmlResponse(["<html><body><p>x</p></bo", "dy></html>"]),
    client,
    writer,
  );
  const text = await response.text();
  expect(text).toMatch(
    /<p>x<\/p><script type="application\/json" id="astro-tq"[^>]*>.*<\/script><\/body><\/html>$/s,
  );
  expect(text.indexOf("</body>")).toBeGreaterThan(text.indexOf("astro-tq"));
  expect(client.getQueryCache().getAll()).toHaveLength(0); // cleared after emission
  expect(response.headers.get("x-keep")).toBe("1");
});

it("injects before a shouting </BODY>", async () => {
  const response = injectState(
    htmlResponse(["<HTML><BODY><p>x</p></BODY></HTML>"]),
    await prefetched(),
    writer,
  );
  const text = await response.text();
  expect(text).toMatch(/<p>x<\/p><script type="application\/json" id="astro-tq"[^>]*>.*<\/BODY>/s);
});

it("keeps a surrogate pair whole when the chunk boundary falls inside it", async () => {
  // The hold-back window is the last six code units, which lands between the halves of this emoji.
  const response = injectState(
    htmlResponse(["<html><body><p>\u{1F600}abcde", "</p></body></html>"]),
    await prefetched(),
    writer,
  );
  const text = await response.text();
  expect(text).toContain("<p>\u{1F600}abcde</p>");
  expect(text).not.toContain("\uFFFD");
});

it("appends at flush when a document never closes its body", async () => {
  const response = injectState(htmlResponse(["<html><body><p>x</p>"]), await prefetched(), writer);
  expect(await response.text()).toMatch(
    /^<html><body><p>x<\/p><script type="application\/json" id="astro-tq"/,
  );
});

it("leaves an html fragment alone, and still clears the client", async () => {
  const client = await prefetched();
  const response = injectState(htmlResponse(["<p>fragment</p>"]), client, writer);
  expect(await response.text()).toBe("<p>fragment</p>");
  expect(client.getQueryCache().getAll()).toHaveLength(0);
});

it("drops a content-length the body has outgrown", async () => {
  const response = injectState(
    htmlResponse(["<html><body></body></html>"], { "content-length": "26" }),
    await prefetched(),
    writer,
  );
  expect(response.headers.get("content-length")).toBeNull();
  expect(response.headers.get("x-keep")).toBe("1");
});

it("leaves non-html and empty-state responses untouched", async () => {
  const json = new Response('{"a":1}', { headers: { "content-type": "application/json" } });
  expect(injectState(json, await prefetched(), writer)).toBe(json);
  const html = htmlResponse(["<body></body>"]);
  expect(await injectState(html, new QueryClient(), writer).text()).toBe("<body></body>");
});
