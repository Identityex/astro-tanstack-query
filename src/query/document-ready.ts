/**
 * Astro imports islands while HTML is still streaming. Wait for the parser before evaluating
 * query consumers, so their first read sees the state written at the end of the document.
 * DOMContentLoaded would deadlock a deferred module that imports us; interactive comes first.
 */
export function documentReady(doc: Document): Promise<void> {
  if (doc.readyState !== "loading") return Promise.resolve();
  return new Promise((resolve) => {
    const parsed = () => {
      if (doc.readyState === "loading") return;
      doc.removeEventListener("readystatechange", parsed);
      resolve();
    };
    doc.addEventListener("readystatechange", parsed);
  });
}
