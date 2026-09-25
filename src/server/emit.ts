import { dehydrate, type QueryClient } from "@tanstack/query-core";
import { STATE_ELEMENT_ID, type StateWriter } from "../serializer/types";

const CLOSE_BODY = "</body>";
/** Matched on the original text rather than a lowercased copy: `İ`.toLowerCase() is two code units, which shifts every index after it. */
const CLOSE_BODY_PATTERN = /<\/body>/i;
/**
 * What tells a document apart from a fragment. Astro prepends `<!DOCTYPE html>` to every page
 * render unless the route sets `partial`, and a partial is exactly the response that must not be
 * given a state element (verified: `runtime/server/render/astro/render.js`, DOCTYPE_EXP).
 */
const DOCUMENT_PATTERN = /<!doctype|<html|<body/i;

/** The state element for this request, or null when nothing was prefetched. Only successful queries are dehydrated; errors are redacted by query-core. */
export function stateScript(client: QueryClient, writer: StateWriter): string | null {
  const state = dehydrate(client);
  if (state.queries.length === 0 && state.mutations.length === 0) return null;
  return `<script type="application/json" id="${STATE_ELEMENT_ID}" data-serializer="${writer.name}">${writer.stringify(state)}</script>`;
}

/**
 * Streams the HTML through and writes the state element before `</body>` (or at the end of a
 * document that has none; a fragment is left alone). It runs after every prefetch: Astro yields
 * `</body>` only once the body's components have rendered. The client is cleared afterwards —
 * the request is over.
 */
export function injectState(
  response: Response,
  client: QueryClient,
  writer: StateWriter,
): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.body || !contentType.includes("text/html")) return response;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let carry = "";
  let injected = false;
  let sawDocument = false;
  const emit = (): string => {
    injected = true;
    const script = stateScript(client, writer) ?? "";
    client.clear();
    return script;
  };

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (injected) {
        controller.enqueue(chunk);
        return;
      }
      const text = carry + decoder.decode(chunk, { stream: true });
      if (!sawDocument) sawDocument = DOCUMENT_PATTERN.test(text);
      const at = text.search(CLOSE_BODY_PATTERN);
      if (at !== -1) {
        controller.enqueue(encoder.encode(text.slice(0, at) + emit() + text.slice(at)));
        carry = "";
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
      // A fragment (an htmx swap, say) is served as text/html but has no document to own the state
      // element. Appending one anyway puts a second #astro-tq in the DOM ahead of the page's own,
      // so the next hydrateFromDocument reads the fragment's state. A document that merely never
      // closed its body still gets the blob — browsers move it into `<body>` (design.md § 13).
      const script = injected || !sawDocument ? "" : emit();
      client.clear(); // the request is over either way; clear() on an empty cache is a no-op
      controller.enqueue(encoder.encode(tail + script));
    },
  });

  // The body grows by the state element, so a length a route set for itself is now a lie the
  // adapter would enforce by truncating. Astro never sets one on streamed HTML; a user route can.
  const headers = new Headers(response.headers);
  headers.delete("content-length");

  return new Response(response.body.pipeThrough(transform), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
