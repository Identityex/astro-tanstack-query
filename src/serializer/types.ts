import type { DehydratedState } from "@tanstack/query-core";

/** The id of the `<script type="application/json">` carrying dehydrated state. */
export const STATE_ELEMENT_ID = "astro-tq";

// A serializer is two objects rather than one because its halves run on opposite sides of the
// wire, and a bundler cannot shake a property off a live object. Held together on one literal,
// `stringify` — which runs solely on the server, in stateScript() — rode into every browser
// bundle that opted into `serializer: "devalue"`: 3,830 B gzip where the reader alone is 2,137 B,
// for 1.7 kB the page never calls. Split, a browser imports the reader and pays for `parse` alone.

/** The browser half: read during hydration, in hydrateFromDocument(). */
export interface StateReader {
  /** Checked against `data-serializer`; the client refuses a blob from a different serializer. */
  readonly name: string;
  parse(text: string): DehydratedState;
}

/** The server half: written during emission, in stateScript(). Never reached from browser code. */
export interface StateWriter {
  /** Written into `data-serializer`; the client refuses a blob from a different serializer. */
  readonly name: string;
  /** Must return text safe to embed inside a `<script>` element. */
  stringify(state: DehydratedState): string;
}
