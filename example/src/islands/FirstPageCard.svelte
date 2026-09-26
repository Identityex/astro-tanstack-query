<script lang="ts">
  import { $firstPage as firstPage, describePosts } from "./posts";

  // Rendered on demand, not on mount. A reader that has already painted is never told when its
  // cached object is overwritten in place, so only a render after the pager moves on shows what
  // page 1's cache entry holds by then.
  let shown = $state(false);
</script>

<div data-island="svelte-first-page">
  <button onclick={() => (shown = true)}>show page 1</button>
  {#if shown}<span>Svelte: {describePosts($firstPage.data)}</span>{/if}
</div>
