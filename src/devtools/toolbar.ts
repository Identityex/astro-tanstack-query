import { defineToolbarApp } from "astro/toolbar";
import { mountDevtools } from "./client";

export default defineToolbarApp({
  init(canvas) {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:auto 0 0 0;height:50vh;z-index:2147483646;";
    canvas.appendChild(host);
    void mountDevtools(host, {
      initialIsOpen: true,
      buttonPosition: "relative",
      position: "bottom",
    });
  },
});
