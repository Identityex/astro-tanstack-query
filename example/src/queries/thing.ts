import { absoluteUrl, createQuery } from "astro-tanstack-query/query";

export type Thing = { value: string; serverHits: number };

export const $thing = createQuery<Thing>({
  queryKey: ["thing"],
  queryFn: async ({ signal }) => {
    const response = await fetch(absoluteUrl("/api/thing"), { signal });
    return (await response.json()) as Thing;
  },
});
