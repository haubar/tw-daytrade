<script setup>
// Badge.vue — 通用小徽章，目前用在股票列表的「上市/上櫃」標籤，
// 以及「法人資料暫缺」這類需要引起注意的提示標記（variant="notice"）。
// 之後如果要加「隔日沖介入強度」（Phase 2 規劃）之類的標記，也可以直接複用這個元件。
defineProps({
  label: { type: String, required: true },
  title: { type: String, default: '' },
  variant: { type: String, default: 'default', validator: (v) => v === 'default' || v === 'notice' },
});
</script>

<template>
  <span
    class="shrink-0 rounded-sm border px-1 py-0.5 text-[0.7rem]"
    :class="
      variant === 'notice'
        ? 'border-gold/40 bg-gold/10 text-gold'
        : 'border-hairline text-mute'
    "
    :title="title || undefined"
  >
    {{ label }}
  </span>
</template>
