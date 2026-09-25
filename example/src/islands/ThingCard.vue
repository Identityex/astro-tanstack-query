<script setup lang="ts">
import { useStore } from "@nanostores/vue";
import { $thing } from "../queries/thing";
const thing = useStore($thing);
</script>

<template>
  <div data-island="vue">Vue: {{ thing.isPending ? "pending" : thing.data?.value }}</div>
</template>
