import {
  defaultShouldDehydrateQuery,
  dehydrate,
  type DehydratedState,
  type QueryClient,
} from "@tanstack/query-core";
import { STATE_ELEMENT_ID, type StateWriter } from "../serializer/types";

const CLOSE_BODY = "</body>";
/** Matched on the original text rather than a lowercased copy: `İ`.toLowerCase() is two code units, which shifts every index after it. */
const CLOSE_BODY_PATTERN = /<\/body>/gi;
/**
 * What may follow a `</body>` that could still be the document's own: whitespace and `</html>`,
 * or a stream cut short of them (`</ht` waiting for `ml>`). Anything else makes that `</body>`
 * content — a string in an inline script, a comment — that must stream on untouched.
 */
const TRAILER_SO_FAR = /^\s*(?:<(?:\/(?:h(?:t(?:m(?:l(?:>\s*)?)?)?)?)?)?)?$/i;
/** The same trailer, complete: what the held tail must be at flush for the state to go before it. */
const DOCUMENT_END = /^<\/body>\s*(?:<\/html>\s*)?$/i;
/**
 * What tells a document apart from a fragment. Astro prepends `<!DOCTYPE html>` to every page
 * render unless the route sets `partial`, and a partial is exactly the response that must not be
 * given a state element (verified: `runtime/server/render/astro/render.js`, DOCTYPE_EXP). The tag
 * names end at whitespace or `>`, so a fragment holding `<html-viewer>` or `<body-copy>` is still
 * a fragment.
 */
const DOCUMENT_PATTERN = /<!doctype|<html[\s>]|<body[\s>]/i;
const CHARSET_PATTERN = /;\s*charset\s*=\s*"?([^";\s]+)/i;
const UTF8_LABEL = /^utf-?8$/i;

/**
 * `cancel` is in the Streams standard, and every Node the package's `engines` allows calls it when
 * the readable side is cancelled or the source errors (nodejs/node#50126), but TypeScript's DOM
 * lib does not declare it yet. It is what releases the client of a response nobody finished reading.
 */
type ReleasingTransformer = Transformer<Uint8Array, Uint8Array> & { cancel(): void };

/**
 * The route Astro renders a `server:defer` component on (`SERVER_ISLAND_ROUTE` in
 * `core/server-islands/endpoint.js`). It is `routePattern`, which a configured `base` never
 * changes: `base` reaches only the route's regex.
 */
export const SERVER_ISLAND_ROUTE = "/_server-islands/[name]";

export interface EmitOptions {
  /**
   * Warn, once per request, about prefetches the state cannot carry: one still in flight when it
   * is written, and one that failed. The middleware and `<QueryState />` turn it on in
   * development and while prerendering: `astro build` runs with `DEV` false, and a static page's
   * failed prefetch is otherwise invisible.
   */
  warn?: boolean;
  /**
   * This response renders a server island (`routePattern === SERVER_ISLAND_ROUTE`). Its HTML is a
   * fragment the browser inserts into a page that has its own `#astro-tq`, so the state goes in an
   * element with no id, found by its class instead: a second `#astro-tq` ahead of the page's own
   * would shadow it. The page client hydrates each one as it arrives.
   */
  island?: boolean;
}

/**
 * The state element for this request, or null when there is nothing to write.
 *
 * The config's `dehydrate.shouldDehydrateQuery` still chooses what goes in, but a pending query
 * never does: one blob written at the end of the body cannot resume a promise, and query-core
 * attaches one to every pending query it dehydrates. TanStack's streaming recipe lets pending
 * queries through; under JSON the promise arrives as `{}` and hydrate() throws in the browser,
 * and under devalue stringify() throws here.
 */
export function stateScript(
  client: QueryClient,
  writer: StateWriter,
  options: EmitOptions = {},
): string | null {
  if (options.warn) warnUnemitted(client);
  const state = dehydrateForPage(client);
  if (state.queries.length === 0 && state.mutations.length === 0) return null;
  const text = serialize(state, writer);
  if (text === null) return null;
  // The class shares the id's name: one string for the browser to look for either way.
  const target = options.island ? `class="${STATE_ELEMENT_ID}"` : `id="${STATE_ELEMENT_ID}"`;
  return `<script type="application/json" ${target} data-serializer="${writer.name}">${text}</script>`;
}

/** What stateScript() writes: the config's own choice, never a pending query. */
function dehydrateForPage(client: QueryClient): DehydratedState {
  const chosen =
    client.getDefaultOptions().dehydrate?.shouldDehydrateQuery ?? defaultShouldDehydrateQuery;
  return dehydrate(client, {
    shouldDehydrateQuery: (query) => query.state.status !== "pending" && chosen(query),
  });
}

/**
 * `writer.stringify(state)`, or, when a value in it cannot be serialized, the state without the
 * queries that hold one. A throw here would error the body stream after the status and most of
 * the page have gone out; Astro's node adapter then writes "Internal server error" into that 200
 * and logs nothing. A BigInt column under JSON, or an ORM instance under devalue, is enough.
 * Leaving the query out costs one browser fetch instead. This path runs only once the whole state
 * has failed.
 */
function serialize(state: DehydratedState, writer: StateWriter): string | null {
  try {
    return writer.stringify(state);
  } catch (error) {
    const fits = (partial: DehydratedState): boolean => {
      try {
        writer.stringify(partial);
        return true;
      } catch {
        return false;
      }
    };
    const queries = state.queries.filter((query) => fits({ queries: [query], mutations: [] }));
    const mutations = state.mutations.filter((mutation) =>
      fits({ queries: [], mutations: [mutation] }),
    );
    const droppedMutations = state.mutations.length - mutations.length;
    const dropped = [
      ...state.queries.filter((query) => !queries.includes(query)).map((query) => query.queryHash),
      ...(droppedMutations > 0 ? [`${droppedMutations} mutation(s)`] : []),
    ];
    // The message alone: a DevalueError also carries the value it choked on and the root it was
    // serializing, which are query data, and the package never logs query data.
    const reason = error instanceof Error ? error.message : "unknown error";
    const remedy =
      writer.name === "json"
        ? 'Return plain data from the queryFn, or use serializer: "devalue" for Dates, Maps, Sets and BigInt.'
        : "Return plain data from the queryFn.";
    console.error(
      `[astro-tanstack-query] the query state could not be serialized (${reason}), so the page ships without ${dropped.join(", ")} and the browser fetches it again. ${remedy}`,
    );
    if (queries.length === 0 && mutations.length === 0) return null;
    try {
      // Every survivor serialized on its own, so only a serializer that is not a pure function of
      // its input can throw here; it still must not truncate the page.
      return writer.stringify({ queries, mutations });
    } catch {
      return null;
    }
  }
}

/** Names query hashes only, never data or error bodies. */
function warnUnemitted(client: QueryClient): void {
  const cache = client.getQueryCache();
  // A server store read adds its query without fetching it, so an idle pending query is no sign
  // of a lost prefetch; a fetching one is.
  const inFlight = cache.findAll({ fetchStatus: "fetching" }).map((query) => query.queryHash);
  const failed = cache
    .getAll()
    .filter((query) => query.state.status === "error")
    .map((query) => query.queryHash);
  const problems: string[] = [];
  if (inFlight.length > 0) {
    problems.push(
      `a prefetch was still in flight when the query state was written: ${inFlight.join(", ")}. Its result is not in the page, so the browser fetches it again. Await $store.prefetch() before rendering any island that reads it; to keep the head streaming, start it early and await it in a component that wraps the island. With emit: "component", <QueryState /> sees only prefetches awaited in page or layout frontmatter.`,
    );
  }
  if (failed.length > 0) {
    problems.push(
      `server prefetch of ${failed.join(", ")} failed; a failed query is never written into the page, so the browser fetches it again. While prerendering, absoluteUrl() resolves against the build's origin (\`site\`, or localhost), not this build: pass a server fetcher, $store.prefetch(() => readFromSource()).`,
    );
  }
  if (problems.length > 0) console.warn(`[astro-tanstack-query] ${problems.join("\n")}`);
}

/**
 * Streams the HTML through and, at flush, writes the state element before the document's final
 * `</body>` (or at the end of a document that has none). A fragment is left alone, except a server
 * island's (`options.island`), which gets the id-less element at its end. Flush is the only moment
 * every prefetch is known to have finished: Astro renders siblings concurrently, and a `</body>`
 * earlier in the stream can be a string in a script.
 *
 * Every response releases the request client exactly once: a page it streams through at flush, or
 * when the reader cancels, as does any other response with a body; one with no body at once. A `null` writer streams the page through
 * untouched and releases without emitting: that is `emit: "component"`, where `<QueryState />`
 * writes the state into the page itself. `options` reach stateScript() at flush, once the request
 * scope they would otherwise be read from has gone.
 * Releasing is what cancels the gc timers an explicit `gcTime` arms on the server; without it a
 * JSON endpoint or an aborted page pins its client, and everything in it, for that long.
 */
export function injectState(
  response: Response,
  client: QueryClient,
  writer: StateWriter | null,
  options: EmitOptions = {},
): Response {
  // Nothing left to render: a redirect, or an empty response. Returned as the same object, which
  // Astro's own handling of a bodiless reroute relies on.
  if (!response.body) {
    client.clear();
    return response;
  }

  // Everything below can still be rendering while it streams: `next()` resolves once the page's
  // frontmatter has run, and its components render as the body is read — in component mode
  // <QueryState /> among them. So the client goes only once the stream has ended. Where no state
  // is written, the bytes pass through untouched, which is also what keeps a compressed or
  // non-UTF-8 page intact.
  const contentType = response.headers.get("content-type") ?? "";
  if (!writer || !contentType.includes("text/html")) {
    return releasedAtEnd(response, response.body, client);
  }
  if (!isUtf8Text(response.headers, contentType)) {
    warnUnwritableOnce();
    return releasedAtEnd(response, response.body, client);
  }

  const decoder = new TextDecoder("utf-8", { ignoreBOM: true }); // keep a BOM the page was sent with
  const encoder = new TextEncoder();
  let carry = "";
  let sawDocument = false;

  const inject: ReleasingTransformer = {
    transform(chunk, controller) {
      const text = carry + decoder.decode(chunk, { stream: true });
      if (!sawDocument) sawDocument = DOCUMENT_PATTERN.test(text);
      const end = documentEndAt(text);
      if (end !== -1) {
        // Hold the candidate and what follows it; a later chunk either completes the trailer or
        // shows it was content, and the next scan releases it.
        controller.enqueue(encoder.encode(text.slice(0, end)));
        carry = text.slice(end);
        return;
      }
      // Hold back enough to recognise a marker split across chunks.
      let keep = Math.max(0, text.length - (CLOSE_BODY.length - 1));
      // `text` is UTF-16: cutting between the halves of a surrogate pair hands TextEncoder two
      // orphans, and each becomes U+FFFD. Carry the high half over to meet its low half instead.
      const last = text.charCodeAt(keep - 1);
      if (last >= 0xd800 && last <= 0xdbff) keep -= 1;
      controller.enqueue(encoder.encode(text.slice(0, keep)));
      carry = text.slice(keep);
    },
    flush(controller) {
      const tail = carry + decoder.decode();
      let script: string | null = null;
      try {
        // A fragment (an htmx swap, say) is served as text/html but has no document to own the
        // state element. Appending one anyway puts a second #astro-tq in the DOM ahead of the
        // page's own, so the next hydrateFromDocument reads the fragment's state. A server island
        // is the one fragment that gets its state, in the id-less form the page client drains.
        if (sawDocument || options.island) script = stateScript(client, writer, options);
        else warnDroppedFromFragmentOnce(client);
      } finally {
        client.clear();
      }
      if (script === null) {
        controller.enqueue(encoder.encode(tail));
        return;
      }
      // A document that never closed its body, or put content after its `</body>`, gets the
      // element appended instead — browsers move it into `<body>` (design.md § 13).
      controller.enqueue(encoder.encode(DOCUMENT_END.test(tail) ? script + tail : tail + script));
    },
    cancel() {
      // The reader went away (a client disconnect: Astro's node writer cancels on socket close),
      // so flush never runs.
      client.clear();
    },
  };

  // The body grows by the state element, so a length a route set for itself is now a lie the
  // adapter would enforce by truncating. Astro never sets one on streamed HTML; a user route can.
  const headers = new Headers(response.headers);
  headers.delete("content-length");

  return new Response(response.body.pipeThrough(new TransformStream(inject)), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Dev aid for `emit: "component"`. `<QueryState />` serialises the state when it renders, and Astro
 * renders the components after an async sibling concurrently with it, so a prefetch in one of
 * them can finish too late to reach the page. Keyed on a fetch rather than on a query being added:
 * a server store read adds its query to the cache without fetching it.
 */
export function warnOnLatePrefetch(client: QueryClient): void {
  const stop = client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "fetch") return;
    stop();
    console.warn(
      `[astro-tanstack-query] a query was prefetched after <QueryState /> rendered; prefetch in page frontmatter or use emit: 'middleware'. Query: ${event.query.queryHash}`,
    );
  });
}

/** Where the document's own `</body>` may start in `text`, or -1. */
function documentEndAt(text: string): number {
  for (const match of text.matchAll(CLOSE_BODY_PATTERN)) {
    if (TRAILER_SO_FAR.test(text.slice(match.index + CLOSE_BODY.length))) return match.index;
  }
  return -1;
}

/** The body passes through byte for byte; the client is released once it has been read or dropped. */
function releasedAtEnd(
  response: Response,
  body: ReadableStream<Uint8Array>,
  client: QueryClient,
): Response {
  const release = (): void => client.clear();
  const passThrough: ReleasingTransformer = { flush: release, cancel: release };
  return new Response(body.pipeThrough(new TransformStream(passThrough)), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * The transform decodes UTF-8 text. A compressed body is not text, and a legacy charset's bytes
 * are not UTF-8: decoding either corrupts the page, and a UTF-8 blob spliced into a latin-1 page
 * would be misread by the browser anyway.
 */
function isUtf8Text(headers: Headers, contentType: string): boolean {
  const encoding = headers.get("content-encoding")?.trim().toLowerCase();
  if (encoding && encoding !== "identity") return false;
  const charset = CHARSET_PATTERN.exec(contentType)?.[1];
  return charset === undefined || UTF8_LABEL.test(charset);
}

let warnedFragment = false;
/**
 * Names query hashes only. Once per process: an htmx partial may prefetch only to render the data
 * into its own HTML, and would otherwise repeat this on every swap.
 */
function warnDroppedFromFragmentOnce(client: QueryClient): void {
  if (warnedFragment || !import.meta.env?.DEV) return;
  const dropped = dehydrateForPage(client).queries.map((query) => query.queryHash);
  if (dropped.length === 0) return;
  warnedFragment = true;
  console.warn(
    `[astro-tanstack-query] ${dropped.length} prefetched quer${dropped.length === 1 ? "y was" : "ies were"} dropped from an HTML fragment (a response without <!DOCTYPE html>, such as an htmx partial): ${dropped.join(", ")}. A fragment carries no query state, so an island inside it fetches again in the browser. Prefetch in the page that renders the island instead; a server island (server:defer) is the one fragment whose state reaches the page. Shown once.`,
  );
}

let warnedUnwritable = false;
function warnUnwritableOnce(): void {
  // The optional chain is load-bearing: this module is also bundled for plain Node, which has no
  // `import.meta.env` for Vite to define.
  if (warnedUnwritable || !import.meta.env?.DEV) return;
  warnedUnwritable = true;
  console.warn(
    '[astro-tanstack-query] an HTML response was compressed, or declared a charset other than UTF-8, before the query state could be written into it, so the page ships without it and its islands fetch in the browser. Use emit: "component" to render <QueryState /> into the page instead.',
  );
}
