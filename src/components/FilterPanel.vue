<script setup>
// FilterPanel.vue — 成交量／股價／漲跌幅篩選面板。
// 所有控制都使用可拖曳的 range input；成交量與漲跌幅採交易者常用的離散門檻，
// 股價則可用雙把手微調，並提供既定價格帶一鍵套用。
import { getPriceBandUpperBound, PRICE_BANDS } from '../utils/filterWatchlist.js';

const filters = defineModel({ required: true });

const PRICE_SLIDER_MAX = 999;
const VOLUME_OPTIONS = [null, 100, 500, 1000, 5000, 10000]; // 單位：張
const GAIN_OPTIONS = [null, 1, 3, 5, 7, 10];

function displayPrice(value, fallback) {
  return value == null ? fallback : `${value} 元`;
}

function setMinPrice(event) {
  const value = Number(event.target.value);
  const max = filters.value.maxPrice ?? PRICE_SLIDER_MAX;
  filters.value.minPrice = value === 0 ? null : Math.min(value, max);
  if (filters.value.maxPrice != null && filters.value.maxPrice < value) filters.value.maxPrice = value;
}

function setMaxPrice(event) {
  const value = Number(event.target.value);
  const min = filters.value.minPrice ?? 0;
  filters.value.maxPrice = value === PRICE_SLIDER_MAX ? null : Math.max(value, min);
  if (filters.value.minPrice != null && filters.value.minPrice > value) filters.value.minPrice = value;
}

function setMinVolume(event) {
  const lots = VOLUME_OPTIONS[Number(event.target.value)];
  filters.value.minVolume = lots == null ? null : lots * 1000;
}

function setMinGainPercent(event) {
  filters.value.minGainPercent = GAIN_OPTIONS[Number(event.target.value)];
}

function volumeOptionIndex() {
  const index = VOLUME_OPTIONS.indexOf(filters.value.minVolume == null ? null : filters.value.minVolume / 1000);
  return index === -1 ? 0 : index;
}

function gainOptionIndex() {
  const index = GAIN_OPTIONS.indexOf(filters.value.minGainPercent);
  return index === -1 ? 0 : index;
}

function applyPriceBand(band, index) {
  filters.value.minPrice = band.min;
  filters.value.maxPrice = getPriceBandUpperBound(index);
}

function resetFilters() {
  // 不直接替換 defineModel 指向的物件，避免父層傳入 reactive 物件時失去連結，
  // 這也是原本「清除篩選」看似沒有作用的原因。
  Object.assign(filters.value, { minPrice: null, maxPrice: null, minVolume: null, minGainPercent: null });
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

    <div class="grid gap-5 lg:grid-cols-[1.4fr_1fr_1fr]">
      <div>
        <div class="mb-2 flex items-center justify-between">
          <span class="text-[0.72rem] text-mute">股價範圍（元）</span>
          <span class="font-mono text-xs text-paper">
            {{ displayPrice(filters.minPrice, '最低不限') }} — {{ displayPrice(filters.maxPrice, '最高 999 元') }}
          </span>
        </div>
        <div class="range-stack" aria-label="股價範圍">
          <input :value="filters.minPrice ?? 0" type="range" min="0" :max="PRICE_SLIDER_MAX" step="0.1" aria-label="最低股價" @input="setMinPrice" />
          <input :value="filters.maxPrice ?? PRICE_SLIDER_MAX" type="range" min="0" :max="PRICE_SLIDER_MAX" step="0.1" aria-label="最高股價" @input="setMaxPrice" />
        </div>
        <div class="mt-3 flex flex-wrap gap-1.5">
          <button
            v-for="band in PRICE_BANDS"
            :key="`${band.min}-${band.max}`"
            type="button"
            class="rounded-sm border border-hairline px-1.5 py-1 font-mono text-[0.68rem] text-mute hover:border-gold hover:text-paper"
            @click="applyPriceBand(band, index)"
          >
            {{ band.min === 0 ? '3.6 以下' : `${band.min}–${band.max}` }} · 略過 {{ band.skipCount }} 檔
          </button>
        </div>
      </div>

      <label class="flex flex-col gap-2">
        <span class="text-[0.72rem] text-mute">最小成交量</span>
        <span class="font-mono text-sm text-paper">{{ VOLUME_OPTIONS[volumeOptionIndex()] == null ? '不限' : `${VOLUME_OPTIONS[volumeOptionIndex()].toLocaleString()} 張以上` }}</span>
        <input :value="volumeOptionIndex()" type="range" min="0" :max="VOLUME_OPTIONS.length - 1" step="1" aria-label="最小成交量" @input="setMinVolume" />
        <span class="flex justify-between font-mono text-[0.65rem] text-mute"><span>不限</span><span>100</span><span>500</span><span>1千</span><span>5千</span><span>1萬+</span></span>
      </label>

      <label class="flex flex-col gap-2">
        <span class="text-[0.72rem] text-mute">最小漲跌幅度</span>
        <span class="font-mono text-sm text-paper">{{ GAIN_OPTIONS[gainOptionIndex()] == null ? '不限' : `${GAIN_OPTIONS[gainOptionIndex()]}% 以上` }}</span>
        <input :value="gainOptionIndex()" type="range" min="0" :max="GAIN_OPTIONS.length - 1" step="1" aria-label="最小漲跌幅度" @input="setMinGainPercent" />
        <span class="flex justify-between font-mono text-[0.65rem] text-mute"><span>不限</span><span>1%</span><span>3%</span><span>5%</span><span>7%</span><span>10%</span></span>
      </label>
    </div>

    <p class="m-0 mt-2 text-[0.72rem] text-mute">
      千元以上股票固定排除。漲跌幅度會取絕對值：多方看漲幅、空方看跌幅是否超過門檻；「略過」為各價格帶的操作參考，不會改變排行榜分數。
    </p>
  </section>
</template>

<style scoped>
input[type='range'] { accent-color: var(--color-gold); cursor: pointer; width: 100%; }
.range-stack { height: 1.4rem; position: relative; }
.range-stack input { left: 0; margin: 0; pointer-events: none; position: absolute; top: 0; }
.range-stack input::-webkit-slider-thumb { pointer-events: auto; }
.range-stack input::-moz-range-thumb { pointer-events: auto; }
</style>
