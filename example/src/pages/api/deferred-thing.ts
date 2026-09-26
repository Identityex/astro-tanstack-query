import type { APIRoute } from "astro";

export const GET: APIRoute = () =>
  new Response("fetched-in-the-browser", { headers: { "content-type": "text/plain" } });
