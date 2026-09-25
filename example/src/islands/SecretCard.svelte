<script lang="ts">
  import { $secret as secret } from "../queries/secret";
</script>

<div data-island="svelte-secret">svelte-secret: {$secret.data ?? "none"}</div>
