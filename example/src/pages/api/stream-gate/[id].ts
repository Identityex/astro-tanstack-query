import type { APIRoute } from "astro";
import { releaseStream } from "../../../fixtures/stream-gate";

export const POST: APIRoute = ({ params }) =>
  new Response(null, {
    status: params.id && releaseStream(params.id) ? 204 : 404,
  });
