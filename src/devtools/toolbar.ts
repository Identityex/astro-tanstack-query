import { defineToolbarApp } from "astro/toolbar";

// Astro imports every toolbar app on every dev page and calls `init` when the browser is idle,
// not when the app is opened. So `init` only listens: the query runtime and the devtools panel
// (about 110 kB gzipped in development) load the first time someone opens the app, and a page
// with no store still pays nothing for them (D3). Nothing is lost by waiting, because the panel
// shows the cache as it is and keeps no history.
export default defineToolbarApp({
  init(canvas, app) {
    // Set before the import settles, so toggling on, off and on again while it loads cannot mount
    // a second panel. Once mounted the panel stays: toggling the app off only hides the canvas,
    // and remounting would throw away the panel's own UI state.
    let mounted: Promise<unknown> | undefined;
    app.onToggled(({ state }) => {
      if (!state || mounted) return;
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;inset:auto 0 0 0;height:50vh;z-index:2147483646;";
      canvas.appendChild(host);
      mounted = import("./client").then(({ mountDevtools }) =>
        mountDevtools(host, {
          initialIsOpen: true,
          buttonPosition: "relative",
          position: "bottom",
        }),
      );
    });
  },
});
