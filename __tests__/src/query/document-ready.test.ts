// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { documentReady } from "../../../src/query/document-ready";

it("waits for parsing, without depending on DOMContentLoaded", async () => {
  const doc = document.implementation.createHTMLDocument();
  const state = vi.spyOn(doc, "readyState", "get").mockReturnValue("loading");
  const ready = vi.fn();
  const waiting = documentReady(doc).then(ready);
  await Promise.resolve();
  expect(ready).not.toHaveBeenCalled();
  doc.dispatchEvent(new Event("readystatechange"));
  await Promise.resolve();
  expect(ready).not.toHaveBeenCalled();
  state.mockReturnValue("interactive");
  doc.dispatchEvent(new Event("readystatechange"));
  await waiting;
  expect(ready).toHaveBeenCalledOnce();
  state.mockRestore();
});

it("does not wait again on a parsed document", async () => {
  const doc = document.implementation.createHTMLDocument();
  const state = vi.spyOn(doc, "readyState", "get").mockReturnValue("interactive");
  await documentReady(doc);
  state.mockRestore();
});
