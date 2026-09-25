import { registerExtension, type HtmxApi } from "./extension";

export { EXTENSION_NAME, INVALIDATED_EVENT, keyFor, registerExtension } from "./extension";

const holder = globalThis as { htmx?: HtmxApi };
if (typeof window !== "undefined") {
  if (holder.htmx) {
    registerExtension(holder.htmx);
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      if (holder.htmx) registerExtension(holder.htmx);
      else
        console.warn(
          "[astro-tanstack-query/htmx] htmx was not found on window; load htmx before this module.",
        );
    });
  }
}
