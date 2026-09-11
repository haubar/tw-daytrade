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
    <header class="mb-6 overflow-hidden rounded-xl border border-hairline bg-panel shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
        <div class="flex flex-wrap items-end justify-between gap-5 p-5 sm:p-6">
            <div>
                <p class="m-0 mb-2 text-[0.68rem] font-bold tracking-[0.16em] text-crest">TW MARKET · AFTER CLOSE</p>
                <h1 class="m-0 font-display text-[1.8rem] font-bold tracking-wide sm:text-[2.1rem]">阿韭衝衝衝觀察榜</h1>
                <p class="m-0 mt-2 max-w-xl text-[0.82rem] leading-relaxed text-mute">用量能、法人與相對強弱整理盤後訊號，協助你從市場脈絡回到自己的判斷。</p>
            </div>

            <div class="grid min-w-full grid-cols-3 gap-2 sm:min-w-0 sm:gap-3">
                <div class="rounded-lg border border-hairline bg-ink/50 px-3 py-2.5 sm:min-w-[112px]">
                    <StatItem label="資料時間" :value="formatDateTime(generatedAt)" />
                </div>
                <div class="rounded-lg border border-hairline bg-ink/50 px-3 py-2.5 sm:min-w-[112px]">
                    <StatItem
                        :label="marketChangePercentIsEstimate ? '大盤漲跌（估計）' : '大盤漲跌'"
                        :value="formatPercent(marketChangePercent)"
                        :tone="marketChangePercent >= 0 ? 'surge' : 'ebb'"
                    />
                </div>
                <div class="rounded-lg border border-hairline bg-ink/50 px-3 py-2.5 sm:min-w-[112px]">
                    <StatItem label="候選檔數" :value="String(totalCandidates)" />
                </div>
            </div>
        </div>

        <p v-if="isSample" class="m-0 basis-full rounded-sm bg-gold px-3 py-2 text-[0.8rem] font-medium text-ink">
            目前顯示的是範例資料，不是真實行情。部署到 Netlify 並實際執行過一次掃描後，這裡會換成真正的每日結果。
        </p>
    </header>
</template>
