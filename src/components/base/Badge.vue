<script setup>
// Badge.vue — 通用小徽章，目前用在股票列表的「上市/上櫃」標籤，
// 之後如果要加「隔日沖介入強度」（Phase 2 規劃）之類的標記，也可以直接複用這個元件。
defineProps({
  label: { type: String, required: true },
});
</script>

<template>
  <span class="shrink-0 rounded-sm border border-hairline px-1 py-0.5 text-[0.7rem] text-mute">
    {{ label }}
  </span>
</template>
