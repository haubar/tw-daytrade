<script setup>
// StatItem.vue — 「標籤 + 數值」配對，原本在 StatusBar.vue 裡重複寫了三次
// （資料時間／大盤漲跌幅／候選檔數），抽出來變成一個可複用元件。
defineProps({
  label: { type: String, required: true },
  value: { type: String, required: true },
  // tone 是可選的：只有「大盤漲跌幅」這種有漲跌方向的數值才需要，其餘留 null 用預設文字色
  tone: { type: String, default: null, validator: (v) => v === null || v === 'surge' || v === 'ebb' },
});
</script>

<template>
  <div class="flex flex-col gap-0.5">
    <span class="text-[0.72rem] text-mute">{{ label }}</span>
    <span
      class="font-mono text-base font-semibold"
      :class="tone === 'surge' ? 'text-surge' : tone === 'ebb' ? 'text-ebb' : 'text-paper'"
    >
      {{ value }}
    </span>
  </div>
</template>
