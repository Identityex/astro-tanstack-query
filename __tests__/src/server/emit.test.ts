import { QueryClient, QueryObserver, defaultShouldDehydrateQuery } from "@tanstack/query-core";
import { gzipSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vitest";
import { writer as devalueWriter } from "../../../src/serializer/devalue";
import { writer } from "../../../src/serializer/json";
import { injectState, stateScript, warnOnLatePrefetch } from "../../../src/server/emit";

const encoder = new TextEncoder();
const STATE_ELEMENT = /<script type="application\/json" id="astro-tq"[^>]*>.*?<\/script>/s;

afterEach(() => {
  vi.restoreAllMocks();
});

async function prefetched(): Promise<QueryClient> {
  const client = new QueryClient();
  await client.prefetchQuery({ queryKey: ["thing"], queryFn: async () => "<b>hi</b>" });
  return client;
}

/**
 * A request client holding a query with an explicit gcTime. On the server that arms an eviction
 * timer which keeps the client alive for the whole gcTime; only clear() cancels it.
 */
async function retaining(): Promise<QueryClient> {
  const client = new QueryClient();
  await client.prefetchQuery({ queryKey: ["kept"], queryFn: async () => "kept", gcTime: 60_000 });
  return client;
}

/** One chunk per read, so the transform sees each chunk before the next one exists, as it does while a page renders. */
function paced(chunks: Uint8Array[], headers: Record<string, string> = {}): Response {
  let next = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = chunks[next++];
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
}

function split(text: string, size: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let at = 0; at < text.length; at += size)
    chunks.push(encoder.encode(text.slice(at, at + size)));
  return chunks;
}

function bodyOf(response: Response): ReadableStream<Uint8Array> {
  if (!response.body) throw new Error("expected a streamed body");
  return response.body;
}

async function readOn(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  output: string,
  until?: string,
): Promise<string> {
  while (until === undefined || !output.includes(until)) {
    const chunk = await reader.read();
    if (chunk.done) break;
    output += decoder.decode(chunk.value, { stream: true });
  }
  return output;
}

/** The state element sits directly before the document's last `</body>`, and taking it out gives back the page. */
function expectStateBeforeFinalBody(output: string, page: string): void {
  const state = STATE_ELEMENT.exec(output);
  const start = state?.index ?? -1;
  const end = start + (state?.[0].length ?? 0);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBe(output.toLowerCase().lastIndexOf("</body>"));
  expect(output.slice(0, start) + output.slice(end)).toBe(page);
}

function htmlResponse(chunks: string[], headers: Record<string, string> = {}): Response {
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
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const client = await prefetched();
  const response = injectState(htmlResponse(["<p>fragment</p>"]), client, writer);
  expect(await response.text()).toBe("<p>fragment</p>");
  expect(client.getQueryCache().getAll()).toHaveLength(0);
});

it("does not take a custom element named like html or body for a document", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const fragment = '<html-viewer src="/a"></html-viewer><body-copy>b</body-copy>';
  const response = injectState(htmlResponse([fragment]), await prefetched(), writer);
  expect(await response.text()).toBe(fragment);
});

const ISLAND_STATE =
  /^<script type="application\/json" class="astro-tq" data-serializer="json">.*<\/script>$/s;

it("writes a server island's state at the end of its fragment, with a class and no id", async () => {
  const client = await retaining();
  const clear = vi.spyOn(client, "clear");
  const fragment = '<astro-island uid="1"><div>kept</div></astro-island>';

  const output = await injectState(htmlResponse([fragment]), client, writer, {
    island: true,
  }).text();

  expect(output.startsWith(fragment)).toBe(true);
  const state = output.slice(fragment.length);
  // A second #astro-tq ahead of the page's own would be the one getElementById returns.
  expect(state).toMatch(ISLAND_STATE);
  expect(state).not.toContain("id=");
  expect(state).toContain("kept");
  expect(clear).toHaveBeenCalledTimes(1);
});

it("leaves a server island's fragment alone when there is nothing to carry", async () => {
  const fragment = "<p>nothing prefetched</p>";
  const response = injectState(htmlResponse([fragment]), new QueryClient(), writer, {
    island: true,
  });
  expect(await response.text()).toBe(fragment);
});

it("stateScript writes the id-less form for a server island", async () => {
  expect(stateScript(await prefetched(), writer, { island: true })).toMatch(ISLAND_STATE);
});

it("warns once, in development, that a fragment dropped prefetched queries", async () => {
  vi.resetModules();
  const fresh = await import("../../../src/server/emit");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const fragment = () => htmlResponse(["<p>fragment</p>"]);

  // A server store read adds an idle query, which was never prefetched; nothing is lost.
  const readOnly = new QueryClient();
  new QueryObserver(readOnly, { queryKey: ["read"], queryFn: async () => 1 }).getCurrentResult();
  await fresh.injectState(fragment(), readOnly, writer).text();
  // A server island carries its state.
  await fresh.injectState(fragment(), await prefetched(), writer, { island: true }).text();
  expect(warn).not.toHaveBeenCalled();

  await fresh.injectState(fragment(), await prefetched(), writer).text();
  await fresh.injectState(fragment(), await prefetched(), writer).text();

  expect(warn).toHaveBeenCalledTimes(1);
  const message = String(warn.mock.calls[0]?.[0]);
  expect(message).toContain("1 prefetched query was dropped from an HTML fragment");
  expect(message).toContain('["thing"]');
  expect(message).not.toContain("<b>hi</b>");
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

it("releases the request client once for a response that carries no page", async () => {
  for (const response of [
    new Response('{"a":1}', { headers: { "content-type": "application/json" } }),
    new Response(null, { status: 302, headers: { location: "/elsewhere" } }),
  ]) {
    const client = await retaining();
    const clear = vi.spyOn(client, "clear");
    expect(injectState(response, client, writer)).toBe(response);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  }
});

it.each([
  ["the state writer", writer],
  ["no writer", null],
])(
  "releases the request client once when the reader goes away before </body>, with %s",
  async (_, stateWriter) => {
    const client = await retaining();
    const clear = vi.spyOn(client, "clear");
    const endless = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(encoder.encode("<!DOCTYPE html><html><body><p>more</p>"));
        },
      },
      { highWaterMark: 0 },
    );
    const response = injectState(
      new Response(endless, { headers: { "content-type": "text/html" } }),
      client,
      stateWriter,
    );
    const reader = bodyOf(response).getReader();
    await reader.read();
    expect(clear).not.toHaveBeenCalled();
    await reader.cancel();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  },
);

it("with no writer, passes a page through untouched and releases the client only once it has streamed", async () => {
  const client = await retaining();
  const clear = vi.spyOn(client, "clear");
  const page = "<!DOCTYPE html><html><body><p>x</p></body></html>";
  const response = injectState(
    htmlResponse([page], { "content-length": String(page.length) }),
    client,
    null,
  );
  // <QueryState /> and its siblings render while the body streams, so they still need the client.
  expect(clear).not.toHaveBeenCalled();
  expect(await response.text()).toBe(page);
  expect(clear).toHaveBeenCalledTimes(1);
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  expect(response.headers.get("content-length")).toBe(String(page.length));
});

it("with no writer, passes a compressed page through byte for byte without warning", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const client = await retaining();
  const gzipped = Uint8Array.from(gzipSync("<!DOCTYPE html><html><body></body></html>"));
  const response = injectState(paced([gzipped], { "content-encoding": "gzip" }), client, null);
  expect(client.getQueryCache().getAll()).toHaveLength(1);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(gzipped);
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  expect(warn).not.toHaveBeenCalled();
});

it("returns a compressed page untouched and releases the client", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const client = await retaining();
  const clear = vi.spyOn(client, "clear");
  const gzipped = Uint8Array.from(gzipSync("<!DOCTYPE html><html><body></body></html>"));
  const response = paced([gzipped], { "content-encoding": "gzip" });
  expect(injectState(response, client, writer)).toBe(response);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(gzipped);
  expect(clear).toHaveBeenCalledTimes(1);
  expect(client.getQueryCache().getAll()).toHaveLength(0);
});

it("returns a page in a legacy charset untouched and releases the client", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const client = await retaining();
  const latin1 = Uint8Array.from([
    ...encoder.encode("<!DOCTYPE html><html><body>caf"),
    0xe9,
    ...encoder.encode("</body></html>"),
  ]);
  const response = paced([latin1], { "content-type": "text/html; charset=iso-8859-1" });
  expect(injectState(response, client, writer)).toBe(response);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(latin1);
  expect(client.getQueryCache().getAll()).toHaveLength(0);
});

it("still writes into a page that names UTF-8 another way, or an identity encoding", async () => {
  const variants: Record<string, string>[] = [
    { "content-type": 'text/html; charset="UTF-8"' },
    { "content-type": "text/html;charset=utf8" },
    { "content-encoding": "identity" },
  ];
  for (const headers of variants) {
    const page = "<!DOCTYPE html><html><body></body></html>";
    const output = await injectState(
      paced([encoder.encode(page)], headers),
      await prefetched(),
      writer,
    ).text();
    expectStateBeforeFinalBody(output, page);
  }
});

it("warns once, in development, that a page it cannot write into ships without state", async () => {
  vi.resetModules();
  const fresh = await import("../../../src/server/emit");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const page = encoder.encode("<!DOCTYPE html><html><body></body></html>");
  // Component mode is the remedy the warning names, so it has nothing to warn about.
  await fresh
    .injectState(paced([page], { "content-encoding": "gzip" }), await retaining(), null)
    .body?.cancel();
  expect(warn).not.toHaveBeenCalled();
  fresh.injectState(paced([page], { "content-encoding": "gzip" }), await retaining(), writer);
  fresh.injectState(
    paced([page], { "content-type": "text/html; charset=iso-8859-1" }),
    await retaining(),
    writer,
  );
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0]?.[0]).toContain('emit: "component"');
});

it("keeps a UTF-8 byte order mark", async () => {
  const page = encoder.encode("\uFEFF<!DOCTYPE html><html><body></body></html>");
  const untouched = injectState(paced([page]), new QueryClient(), writer);
  expect(new Uint8Array(await untouched.arrayBuffer())).toEqual(page);
  const withState = injectState(paced([page]), await prefetched(), writer);
  expect([...new Uint8Array(await withState.arrayBuffer()).subarray(0, 3)]).toEqual([
    0xef, 0xbb, 0xbf,
  ]);
});

const SCRIPT_DECOY =
  '<!DOCTYPE html><html><head><script>f.srcdoc = "<html><body>hi</body></html>";</script></head><body><div>x</div></body></html>\n';

it.each([
  ["a string in an inline script", SCRIPT_DECOY],
  ["a comment", "<!DOCTYPE html><html><body><!-- see </body> --><p>y</p></body>\n</html>"],
  ["capitals", "<!DOCTYPE html><html><body><p>z</p></BODY></HTML>"],
])("writes the state before the final </body> past %s, at every chunk size", async (_, page) => {
  for (let size = 1; size <= 40; size++) {
    const output = await injectState(paced(split(page, size)), await prefetched(), writer).text();
    expectStateBeforeFinalBody(output, page);
  }
});

it("includes a query that settles after a decoy </body> has streamed", async () => {
  const head =
    '<!DOCTYPE html><html><head><script>f.srcdoc = "<html><body>hi</body></html>";</script></head><body>';
  const rest = "<div>x</div></body></html>\n";
  const client = await prefetched();
  const reader = bodyOf(
    injectState(paced([encoder.encode(head), encoder.encode(rest)]), client, writer),
  ).getReader();
  const decoder = new TextDecoder();

  let output = await readOn(reader, decoder, "", '</html>";</script>');
  expect(output).toContain('hi</body></html>";</script>');
  client.setQueryData(["late"], "settled late");
  output = await readOn(reader, decoder, output);

  expect(output).toContain("settled late");
  expectStateBeforeFinalBody(output, head + rest);
});

it("appends the state at flush when content follows the document's </body>", async () => {
  const page = "<!DOCTYPE html><html><body><p>x</p></body><script>tail()</script></html>";
  const output = await injectState(htmlResponse([page]), await prefetched(), writer).text();
  expect(output.startsWith(page)).toBe(true);
  expect(output.slice(page.length)).toMatch(
    /^<script type="application\/json" id="astro-tq"[^>]*>.*<\/script>$/s,
  );
});

it("finishes the page and releases the client when no state can be written", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const client = await retaining();
  const clear = vi.spyOn(client, "clear");
  const failing = {
    name: "json",
    stringify: () => {
      throw new Error("unserialisable");
    },
  };
  const page = "<!DOCTYPE html><html><body></body></html>";
  expect(await injectState(htmlResponse([page]), client, failing).text()).toBe(page);
  expect(clear).toHaveBeenCalledTimes(1);
  expect(error).toHaveBeenCalledTimes(1);
  expect(error.mock.calls[0]?.[0]).toContain("unserialisable");
  expect(error.mock.calls[0]?.[0]).toContain('["kept"]');
});

class Money {
  constructor(readonly cents: number) {}
}

it.each([
  ["a BigInt under JSON", writer, () => ({ secret: "hunter2", id: 1n }), {}],
  ["a class instance under devalue", devalueWriter, () => new Money(4200), {}],
  ["a function in meta under devalue", devalueWriter, () => "hunter2", { format: () => "x" }],
])(
  "leaves out only the query holding %s, and still finishes the page",
  async (_, stateWriter, data, meta) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = await prefetched();
    await client.prefetchQuery({ queryKey: ["unserializable"], queryFn: async () => data(), meta });
    const page = "<!DOCTYPE html><html><body><p>x</p></body></html>";

    const output = await injectState(htmlResponse([page]), client, stateWriter).text();

    expectStateBeforeFinalBody(output, page);
    const state = STATE_ELEMENT.exec(output)?.[0] ?? "";
    expect(state).toContain("thing");
    expect(state).not.toContain("unserializable");
    expect(error).toHaveBeenCalledTimes(1);
    const message = String(error.mock.calls[0]?.[0]);
    expect(message).toContain('["unserializable"]');
    expect(message).not.toContain('["thing"]');
    // Switching to devalue is the remedy only for a page that is not already using it.
    expect(message.includes('serializer: "devalue"')).toBe(stateWriter === writer);
    // Query data never reaches a log, not even through the serializer's own error.
    expect(message).not.toContain("hunter2");
    expect(message).not.toContain("4200");
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  },
);

it("keeps the config's own predicate but never emits a pending query", async () => {
  const client = new QueryClient({
    defaultOptions: {
      dehydrate: {
        // TanStack's streaming recipe, plus a key the page chose to keep out.
        shouldDehydrateQuery: (query) =>
          query.queryKey[0] !== "private" &&
          (defaultShouldDehydrateQuery(query) || query.state.status === "pending"),
      },
    },
  });
  await client.prefetchQuery({ queryKey: ["thing"], queryFn: async () => "done" });
  await client.prefetchQuery({ queryKey: ["private"], queryFn: async () => "mine" });
  void client.prefetchQuery({ queryKey: ["slow"], queryFn: () => new Promise<never>(() => {}) });

  const script = stateScript(client, writer) ?? "";

  expect(script).toContain("thing");
  expect(script).not.toContain("private");
  expect(script).not.toContain("slow");
  expect(script).not.toContain("promise");
  // Under devalue a pending query's promise used to throw on the server instead.
  const onlyPending = new QueryClient({
    defaultOptions: { dehydrate: { shouldDehydrateQuery: () => true } },
  });
  void onlyPending.prefetchQuery({
    queryKey: ["slow"],
    queryFn: () => new Promise<never>(() => {}),
  });
  expect(stateScript(onlyPending, devalueWriter)).toBeNull();
});

const rejecting = async (): Promise<never> => {
  throw new Error("upstream said hunter2");
};

it("warns once about failed prefetches, naming their keys and nothing they returned", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const client = new QueryClient();
  await client.prefetchQuery({ queryKey: ["broken"], queryFn: rejecting, retry: false });
  await client.prefetchQuery({ queryKey: ["also-broken"], queryFn: rejecting, retry: false });
  const page = "<!DOCTYPE html><html><body></body></html>";

  const output = await injectState(htmlResponse([page]), client, writer, { warn: true }).text();

  expect(output).toBe(page);
  expect(warn).toHaveBeenCalledTimes(1);
  const message = String(warn.mock.calls[0]?.[0]);
  expect(message).toContain('["broken"], ["also-broken"]');
  expect(message).toContain("prefetch(() => readFromSource())");
  expect(message).not.toContain("hunter2");
});

it("warns once about a prefetch still in flight when the state is written, not about a store read", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const client = new QueryClient();
  new QueryObserver(client, { queryKey: ["read"], queryFn: async () => 1 }).getCurrentResult();
  void client.prefetchQuery({ queryKey: ["slow"], queryFn: () => new Promise<never>(() => {}) });

  expect(stateScript(client, writer, { warn: true })).toBeNull();

  expect(warn).toHaveBeenCalledTimes(1);
  const message = String(warn.mock.calls[0]?.[0]);
  expect(message).toContain('["slow"]');
  expect(message).not.toContain('["read"]');
  expect(message).toContain("Await $store.prefetch()");
});

it("names both kinds of lost prefetch in one warning", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const client = new QueryClient();
  await client.prefetchQuery({ queryKey: ["broken"], queryFn: rejecting, retry: false });
  void client.prefetchQuery({ queryKey: ["slow"], queryFn: () => new Promise<never>(() => {}) });

  stateScript(client, writer, { warn: true });

  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0]?.[0]).toContain('["slow"]');
  expect(warn.mock.calls[0]?.[0]).toContain('["broken"]');
});

it.each([{ warn: false }, {}])("stays quiet about lost prefetches with %o", async (options) => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const client = new QueryClient();
  await client.prefetchQuery({ queryKey: ["broken"], queryFn: rejecting, retry: false });
  void client.prefetchQuery({ queryKey: ["slow"], queryFn: () => new Promise<never>(() => {}) });
  const page = "<!DOCTYPE html><html><body></body></html>";

  expect(stateScript(client, writer, options)).toBeNull();
  expect(await injectState(htmlResponse([page]), client, writer, options).text()).toBe(page);
  expect(warn).not.toHaveBeenCalled();
});

it("warnOnLatePrefetch warns once, for a fetch but not for a store read or a cache write", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const client = new QueryClient();
  warnOnLatePrefetch(client);

  new QueryObserver(client, { queryKey: ["read"], queryFn: async () => 1 }).getCurrentResult();
  client.setQueryData(["written"], 1);
  expect(warn).not.toHaveBeenCalled();

  await client.prefetchQuery({ queryKey: ["late"], queryFn: async () => 2 });
  await client.prefetchQuery({ queryKey: ["later"], queryFn: async () => 3 });
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0]?.[0]).toContain('["late"]');
});
