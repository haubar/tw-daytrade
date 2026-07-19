<script setup>
// StatusBar.vue — 頂部狀態列。
//
// 重構筆記：三個「標籤+數值」統計項目原本各寫一份，改用 StatItem.vue 複用元件；
// formatDateTime/formatPercent 改從 utils/format.js 共用引入。
import StatItem from './base/StatItem.vue';
import { formatDateTime, formatPercent } from '../utils/format.js';

defineProps({
    generatedAt: { type: String, required: true },
    marketChangePercent: { type: Number, required: true },
    marketChangePercentIsEstimate: { type: Boolean, default: true },
    totalCandidates: { type: Number, required: true },
    dataSourceStatus: { type: Object, required: true },
    isSample: { type: Boolean, default: false },
});
</script>

<template>
    <header class="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-4">
        <div>
            <h1 class="m-0 mb-1 font-display text-[1.75rem] font-bold tracking-wide">阿韭衝衝衝觀察榜</h1>
            <p class="m-0 text-[0.85rem] text-mute">全市場盤後量化篩選 · 量能異常 · 跳空幅度 · 相對大盤強弱勢</p>
        </div>

        <div class="flex flex-wrap gap-4 sm:gap-6">
            <StatItem label="資料時間" :value="formatDateTime(generatedAt)" />
            <StatItem
                :label="marketChangePercentIsEstimate ? '大盤漲跌幅（估計）' : '大盤漲跌幅'"
                :value="formatPercent(marketChangePercent)"
                :tone="marketChangePercent >= 0 ? 'surge' : 'ebb'"
            />
            <StatItem label="候選檔數" :value="String(totalCandidates)" />
        </div>

        <p v-if="isSample" class="m-0 basis-full rounded-sm bg-gold px-3 py-2 text-[0.8rem] font-medium text-ink">
            目前顯示的是範例資料，不是真實行情。部署到 Netlify 並實際執行過一次掃描後，這裡會換成真正的每日結果。
        </p>
    </header>
</template>
