import { from } from "solid-js";
import { $page, $posts, describePosts } from "../posts";

export default function PostPager() {
  const posts = from($posts, $posts.get());
  return (
    <div data-island="solid-pager">
      <p>Solid pager: {describePosts(posts().data)}</p>
      <button onClick={() => $page.set(Math.max(1, $page.get() - 1))}>previous page</button>
      <button onClick={() => $page.set($page.get() + 1)}>next page</button>
    </div>
  );
}
