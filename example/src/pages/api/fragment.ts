import type { APIRoute } from "astro";

let hits = 0;

export const GET: APIRoute = () => {
  hits += 1;
  return new Response(`<span>fragment hit #${hits}</span>`, {
    headers: { "content-type": "text/html" },
  });
};
