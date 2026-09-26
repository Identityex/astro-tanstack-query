// @vitest-environment happy-dom
import { ToolbarAppEventTarget, serverHelpers } from "astro/runtime/client/dev-toolbar/helpers.js";
import { beforeEach, expect, it, vi } from "vitest";

/**
 * Astro imports every toolbar app on every dev page and calls `init` on idle, so what this file
 * pins is what that costs a page nobody opens the app on. A mock factory runs when its module is
 * first evaluated, which makes these counters a record of what was loaded, not of what was
 * called. The mocks are registered with `vi.doMock` after `vi.resetModules` in every test,
 * because `resetModules` keeps a hoisted `vi.mock`'s module: a test running after another one had
 * loaded it would then count nothing, and pass whatever the toolbar imported.
 */
const loaded = { queryClient: 0, queryDevtools: 0 };
const panels: { options: unknown; target: HTMLElement | undefined; unmounted: boolean }[] = [];

class FakeDevtools {
  readonly panel: (typeof panels)[number];
  constructor(options: unknown) {
    this.panel = { options, target: undefined, unmounted: false };
    panels.push(this.panel);
  }
  mount(target: HTMLElement) {
    this.panel.target = target;
  }
  unmount() {
    this.panel.unmounted = true;
  }
}

beforeEach(() => {
  loaded.queryClient = 0;
  loaded.queryDevtools = 0;
  panels.length = 0;
  vi.resetModules();
  vi.doMock("../../../src/query/client", () => {
    loaded.queryClient += 1;
    return { pageClient: () => ({}) };
  });
  vi.doMock("@tanstack/query-devtools", () => {
    loaded.queryDevtools += 1;
    return { TanstackQueryDevtools: FakeDevtools };
  });
});

async function startToolbarApp() {
  const { default: toolbarApp } = await import("../../../src/devtools/toolbar");
  if (!toolbarApp.init) throw new Error("the toolbar app has no init");
  const canvas = document.createElement("div").attachShadow({ mode: "open" });
  const app = new ToolbarAppEventTarget();
  await toolbarApp.init(canvas, app, serverHelpers);
  // What Astro's toolbar dispatches when its button for this app is clicked.
  const toggle = (state: boolean) =>
    app.dispatchEvent(new CustomEvent("app-toggled", { detail: { state } }));
  return { canvas, toggle };
}

// A second mount would follow the first within the same run of already-loaded modules, so one
// macrotask after the first is enough to see it.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

it("loads neither the query runtime nor the devtools until the app is opened", async () => {
  const { canvas, toggle } = await startToolbarApp();
  toggle(false);
  await settle();

  expect(loaded).toEqual({ queryClient: 0, queryDevtools: 0 });
  expect(panels).toHaveLength(0);
  expect(canvas.childElementCount).toBe(0);
});

it("mounts one panel on first open, however fast the app is toggled while it loads", async () => {
  const { canvas, toggle } = await startToolbarApp();
  toggle(true);
  toggle(false);
  toggle(true);
  await vi.waitFor(() => expect(panels).toHaveLength(1), { timeout: 5_000 });
  await settle();

  expect(panels).toHaveLength(1);
  expect(canvas.childElementCount).toBe(1);
  expect(panels[0]?.target).toBe(canvas.firstElementChild);
  expect(panels[0]?.options).toMatchObject({
    initialIsOpen: true,
    buttonPosition: "relative",
    position: "bottom",
  });
  // Also proves the counters above are wired to the modules the toolbar really loads.
  expect(loaded).toEqual({ queryClient: 1, queryDevtools: 1 });
});

it("keeps the panel mounted when the app is closed, so reopening it keeps its state", async () => {
  const { canvas, toggle } = await startToolbarApp();
  toggle(true);
  await vi.waitFor(() => expect(panels).toHaveLength(1), { timeout: 5_000 });

  toggle(false);
  toggle(true);
  await settle();

  expect(panels).toHaveLength(1);
  expect(panels[0]?.unmounted).toBe(false);
  expect(canvas.childElementCount).toBe(1);
});
