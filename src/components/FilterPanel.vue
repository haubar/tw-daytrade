<script setup>
// FilterPanel.vue — 成交量／股價／漲跌幅篩選面板。
// 先做簡單的數字輸入框（v-model 直接綁定數字），之後如果需要更直覺的操作，
// 可以再疊加滑桿（range input）在同一組資料上，不用重新設計狀態結構。

const filters = defineModel({ required: true });

function resetFilters() {
  filters.value = { minPrice: null, maxPrice: null, minVolume: null, minGainPercent: null };
}
</script>

<template>
  <section class="rounded-md border border-hairline bg-panel p-4">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="m-0 font-display text-base font-bold">篩選條件</h2>
      <button
        type="button"
        class="rounded-sm border border-hairline px-2 py-1 text-xs text-mute hover:text-paper"
        @click="resetFilters"
      >
        清除篩選
      </button>
    </div>

    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <label class="flex flex-col gap-1">
        <span class="text-[0.72rem] text-mute">最低股價</span>
        <input
          v-model.number="filters.minPrice"
          type="number"
          min="0"
          placeholder="不限"
          class="rounded-sm border border-hairline bg-ink px-2 py-1 font-mono text-sm text-paper placeholder:text-mute"
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-[0.72rem] text-mute">最高股價</span>
        <input
          v-model.number="filters.maxPrice"
          type="number"
          min="0"
          placeholder="不限"
          class="rounded-sm border border-hairline bg-ink px-2 py-1 font-mono text-sm text-paper placeholder:text-mute"
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-[0.72rem] text-mute">最小成交量（股）</span>
        <input
          v-model.number="filters.minVolume"
          type="number"
          min="0"
          placeholder="不限"
          class="rounded-sm border border-hairline bg-ink px-2 py-1 font-mono text-sm text-paper placeholder:text-mute"
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-[0.72rem] text-mute">最小漲跌幅度（%）</span>
        <input
          v-model.number="filters.minGainPercent"
          type="number"
          min="0"
          step="0.1"
          placeholder="不限"
          class="rounded-sm border border-hairline bg-ink px-2 py-1 font-mono text-sm text-paper placeholder:text-mute"
        />
      </label>
    </div>

    <p class="m-0 mt-2 text-[0.72rem] text-mute">
      漲跌幅度篩選會取絕對值：多方觀察榜看漲幅有沒有超過門檻，空方觀察榜看跌幅有沒有超過門檻。
    </p>
  </section>
</template>
