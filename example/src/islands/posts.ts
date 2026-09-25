import { keepPreviousData } from "@tanstack/query-core";
import { createQuery, queryOptions } from "astro-tanstack-query/query";
import { atom, computed } from "nanostores";

export type Posts = { page: number; items: string[] };

export const $page = atom(1);

// In memory rather than behind an endpoint: the pager fixture checks which cache entry each page's
// data lands in, and that needs only a fresh object per fetch. staleTime: Infinity means nothing
// ever refetches over an entry another key's data was written into, so the damage stays visible.
const postsOptions = (page: number) =>
  queryOptions({
    queryKey: ["posts", page],
    queryFn: async (): Promise<Posts> => ({ page, items: [`post ${page}a`, `post ${page}b`] }),
    staleTime: Infinity,
  });

/** Follows $page, showing the previous page while the next one loads. */
export const $posts = createQuery(
  computed($page, (page) => ({ ...postsOptions(page), placeholderData: keepPreviousData })),
);

/** Pinned to the key the pager starts on and then leaves behind. */
export const $firstPage = createQuery(postsOptions(1));

export const describePosts = (posts: Posts | undefined): string =>
  posts ? `page ${posts.page}: ${posts.items.join(", ")}` : "pending";
