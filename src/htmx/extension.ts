import { pageClient } from "../query/client";

export interface HtmxExtension {
  onEvent(name: string, event: Event): boolean;
  transformResponse(text: string, xhr: XMLHttpRequest, elt: Element): string;
}

export interface HtmxApi {
  defineExtension(name: string, extension: HtmxExtension): void;
  swap(
    target: Element,
    content: string,
    spec: { swapStyle: string },
    options?: { select?: string },
  ): void;
}

interface RequestDetail {
  elt: Element;
  target: Element;
  /** `finalRequestPath` is the URL htmx actually asks for: the one carrying hx-vals / hx-include params. */
  pathInfo?: { requestPath?: string; finalRequestPath?: string };
  successful?: boolean;
}

export const EXTENSION_NAME = "tanstack-query";
export const INVALIDATED_EVENT = "tanstack-query:invalidated";

export function keyFor(url: string): ["htmx", string] {
  return ["htmx", url];
}

const isGet = (elt: Element) => elt.hasAttribute("hx-get");
const requestUrl = (elt: Element, detail?: RequestDetail) =>
  detail?.pathInfo?.finalRequestPath ??
  detail?.pathInfo?.requestPath ??
  elt.getAttribute("hx-get") ??
  "";
const isOk = (xhr: XMLHttpRequest) => xhr.status >= 200 && xhr.status < 300;
const swapStyle = (elt: Element) =>
  (elt.closest("[hx-swap]")?.getAttribute("hx-swap") ?? "innerHTML").split(" ")[0] ?? "innerHTML";

/**
 * Read-through cache for `hx-get` (D12): a fresh cached fragment is swapped in and the request is
 * cancelled; responses are stored; `hx-tq-invalidate` keys are invalidated after a successful
 * non-GET; every invalidation is announced on <body> so elements can re-fetch with hx-trigger.
 */
export function registerExtension(htmx: HtmxApi): void {
  const client = pageClient();
  // transformResponse gets no detail, so the path resolved at beforeRequest is remembered here.
  // Reading and writing the same key matters: for one `hx-get="/search"` driven by hx-vals, the
  // attribute alone would collapse every parameter set onto one entry and serve the wrong fragment.
  const requested = new WeakMap<Element, string>();

  htmx.defineExtension(EXTENSION_NAME, {
    onEvent(name, event) {
      const detail = (event as CustomEvent<RequestDetail>).detail;
      if (name === "htmx:beforeRequest") {
        requested.set(detail.elt, requestUrl(detail.elt, detail));
        return serveFromCache(detail);
      }
      if (name === "htmx:afterRequest") invalidateDeclared(detail);
      return true;
    },
    transformResponse(text, xhr, elt) {
      const url = requested.get(elt) ?? requestUrl(elt);
      requested.delete(elt);
      // A 404 or 500 also arrives as a fragment; caching it would serve the error for a whole staleTime.
      if (isGet(elt) && isOk(xhr)) client.setQueryData(keyFor(url), text);
      return text;
    },
  });

  client.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "invalidate") {
      const key = event.query.queryKey as readonly unknown[];
      document.body.dispatchEvent(new CustomEvent(INVALIDATED_EVENT, { detail: { key } }));
    }
  });

  function serveFromCache(detail: RequestDetail): boolean {
    const { elt, target } = detail;
    if (!isGet(elt)) return true;
    // A direct hash lookup, not find(): find() re-hashes the key against every cached query, so a
    // miss (the first request to any URL) scans them all. This is the hash setQueryData stored the
    // fragment under, so a queryKeyHashFn in the client's defaults still matches.
    const { queryHash } = client.defaultQueryOptions({ queryKey: keyFor(requestUrl(elt, detail)) });
    const query = client.getQueryCache().get<string>(queryHash);
    // Deliberately 0, not the page client's default staleTime: that default exists for the
    // hydration handoff, so data already embedded in the HTML is not refetched the instant it
    // hydrates. A fragment has no handoff — a user clicked — and silently replaying minute-old HTML
    // for every un-annotated hx-get is a footgun, so caching a fragment is opt-in via
    // hx-tq-stale-time.
    // Read with closest(), matching hx-tq-invalidate below and htmx's own inheriting attributes:
    // now that caching is opt-in, marking a container is the natural way to say "these fragments
    // are cacheable", and a direct getAttribute would silently ignore it.
    const staleTime = Number(
      elt.closest("[hx-tq-stale-time]")?.getAttribute("hx-tq-stale-time") ?? 0,
    );
    if (!query || query.state.data === undefined || query.isStaleByTime(staleTime)) return true;
    htmx.swap(
      target,
      query.state.data,
      { swapStyle: swapStyle(elt) },
      { select: elt.getAttribute("hx-select") ?? undefined },
    );
    return false;
  }

  function invalidateDeclared(detail: RequestDetail): void {
    if (isGet(detail.elt) || !detail.successful) return;
    const declared = detail.elt.closest("[hx-tq-invalidate]")?.getAttribute("hx-tq-invalidate");
    if (!declared) return;
    for (const queryKey of JSON.parse(declared) as unknown[][])
      void client.invalidateQueries({ queryKey });
  }
}
