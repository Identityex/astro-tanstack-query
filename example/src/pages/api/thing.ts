import type { APIRoute } from "astro";

let serverHits = 0;

export const GET: APIRoute = () => {
  serverHits += 1;
  return new Response(JSON.stringify({ value: `hello #${serverHits}`, serverHits }), {
    headers: { "content-type": "application/json" },
  });
};
