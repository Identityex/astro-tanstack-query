<script lang="ts">
  import { $thing as thing } from "../queries/thing";
</script>

<div data-island="svelte">Svelte: {$thing.isPending ? "pending" : $thing.data?.value}</div>
