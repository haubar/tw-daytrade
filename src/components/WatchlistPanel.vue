<script setup>
// WatchlistPanel.vue — 多方/空方觀察榜共用的面板元件。
//
// 重構筆記：
// - formatPercent/formatPrice 原本在這裡跟 StatusBar.vue 各寫一份，改成從 utils/format.js 共用引入
// - 市場標籤（上市/上櫃）抽成 Badge.vue 複用元件
// - 版面／間距／色彩改用 Tailwind 工具類別，原本一大塊 scoped <style> 只留下真的必要的部分
//   （grid-template-columns 的精確欄寬設定，Tailwind 沒有內建剛好符合的預設值，用 arbitrary value 表達）
import ScoreBar from './ScoreBar.vue';
import Badge from './base/Badge.vue';
import { formatPercent, formatPrice, formatVolume } from '../utils/format.js';
import { getPriceBand, getPriceMoveForTicks } from '../utils/filterWatchlist.js';

defineProps({
  title: { type: String, required: true },
  items: { type: Array, required: true },
  tone: { type: String, required: true, validator: (v) => v === 'surge' || v === 'ebb' },
  emptyMessage: { type: String, default: '目前沒有符合條件的股票。' },
});

function profitReference(price) {
  const band = getPriceBand(price);
  if (!band || band.profitTicks == null) return null;
  const move = getPriceMoveForTicks(price, band.profitTicks);
  return `獲利參考 +${formatPrice(move)} 元（${band.profitTicks} 檔）`;
}
</script>

<template>
  <section class="overflow-hidden rounded-md border border-hairline bg-panel">
    <header class="flex items-baseline justify-between border-b border-hairline px-4 pb-3 pt-4">
      <h2
        class="m-0 font-display text-[1.15rem] font-bold"
        :class="tone === 'surge' ? 'text-surge' : 'text-ebb'"
      >
        {{ title }}
      </h2>
      <span class="font-mono text-[0.85rem] text-mute">{{ items.length }} 檔</span>
    </header>

    <ol v-if="items.length > 0" class="m-0 list-none divide-y divide-hairline p-0">
      <li
        v-for="(item, index) in items"
        :key="item.code"
        class="grid grid-cols-[1.8rem_minmax(0,1fr)_minmax(0,0.8fr)] items-center gap-2 px-4 py-3 hover:bg-panel-raised sm:grid-cols-[2.2rem_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.6fr)] sm:gap-3"
      >
        <span class="font-mono text-[0.85rem] text-mute">{{ String(index + 1).padStart(2, '0') }}</span>

        <span class="flex min-w-0 items-baseline gap-2">
          <span class="shrink-0 font-mono text-[0.85rem] text-mute">{{ item.code }}</span>
          <span class="overflow-hidden text-ellipsis whitespace-nowrap font-medium">{{ item.name }}</span>
          <Badge :label="item.market === 'TWSE' ? '上市' : '上櫃'" />
        </span>

        <span class="flex flex-col items-end font-mono leading-tight">
          <span class="text-[0.9rem]">{{ formatPrice(item.close) }}</span>
          <span
            class="text-[0.8rem] font-semibold"
            :class="tone === 'surge' ? 'text-surge' : 'text-ebb'"
          >
            {{ formatPercent(item.changePercent) }}
          </span>
          <span class="text-[0.7rem] text-mute">{{ formatVolume(item.volume) }}</span>
          <span v-if="profitReference(item.close)" class="mt-0.5 text-[0.65rem] text-gold">
            {{ profitReference(item.close) }}
          </span>
        </span>

        <ScoreBar
          class="col-span-full sm:col-auto"
          :volume-contribution="item.volumeContribution"
          :gap-contribution="item.gapContribution"
          :relative-strength-contribution="item.relativeStrengthContribution"
          :institutional-contribution="item.institutionalContribution"
          :score="item.score"
          :tone="tone"
        />
      </li>
    </ol>

    <p v-else class="px-4 py-8 text-center text-mute">{{ emptyMessage }}</p>
  </section>
</template>
