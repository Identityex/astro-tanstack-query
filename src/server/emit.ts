import { dehydrate, type QueryClient } from "@tanstack/query-core";
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
 * given a state element (verified: `runtime/server/render/astro/render.js`, DOCTYPE_EXP).
 */
const DOCUMENT_PATTERN = /<!doctype|<html|<body/i;
const CHARSET_PATTERN = /;\s*charset\s*=\s*"?([^";\s]+)/i;
const UTF8_LABEL = /^utf-?8$/i;

/**
 * `cancel` is in the Streams standard, and every Node the package's `engines` allows calls it when
 * the readable side is cancelled or the source errors (nodejs/node#50126), but TypeScript's DOM
 * lib does not declare it yet. It is what releases the client of a response nobody finished reading.
 */
type ReleasingTransformer = Transformer<Uint8Array, Uint8Array> & { cancel(): void };

/** The state element for this request, or null when nothing was prefetched. Only successful queries are dehydrated; errors are redacted by query-core. */
export function stateScript(client: QueryClient, writer: StateWriter): string | null {
  const state = dehydrate(client);
  if (state.queries.length === 0 && state.mutations.length === 0) return null;
  return `<script type="application/json" id="${STATE_ELEMENT_ID}" data-serializer="${writer.name}">${writer.stringify(state)}</script>`;
}

/**
 * Streams the HTML through and, at flush, writes the state element before the document's final
 * `</body>` (or at the end of a document that has none; a fragment is left alone). Flush is the
 * only moment every prefetch is known to have finished: Astro renders siblings concurrently, and a
 * `</body>` earlier in the stream can be a string in a script.
 *
 * Every response releases the request client exactly once: a page it streams through at flush, or
 * when the reader cancels; anything else at once. A `null` writer streams the page through
 * untouched and releases without emitting: that is `emit: "component"`, where `<QueryState />`
 * writes the state into the page itself.
 * Releasing is what cancels the gc timers an explicit `gcTime` arms on the server; without it a
 * JSON endpoint or an aborted page pins its client, and everything in it, for that long.
 */
export function injectState(
  response: Response,
  client: QueryClient,
  writer: StateWriter | null,
): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.body || !contentType.includes("text/html")) {
    // An endpoint has finished with the client by the time it returns its Response.
    client.clear();
    return response;
  }

  // Checked before the encoding guard below: in component mode the page is still rendering while
  // it streams, <QueryState /> included, so the client may only go once the stream has ended. The
  // bytes pass through untouched, so a compressed or non-UTF-8 page is safe here.
  if (!writer) return releasedAtEnd(response, response.body, client);

  if (!isUtf8Text(response.headers, contentType)) {
    warnUnwritableOnce();
    client.clear();
    return response;
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
        // page's own, so the next hydrateFromDocument reads the fragment's state.
        if (sawDocument) script = stateScript(client, writer);
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
