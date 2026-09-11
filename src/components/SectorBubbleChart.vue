<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { fetchSectorReplay } from '../services/api.js';

const frames = ref([]);
const frameIndex = ref(0);
const isLoading = ref(true);
const isPlaying = ref(false);
const errorMessage = ref('');
const selectedSector = ref(null);
const watchlistOnly = ref(false);
let timer = null;

const currentFrame = computed(() => frames.value[frameIndex.value] ?? null);

const numericRange = (values) => {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { min: -1, max: 1 };
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  return min === max ? { min: min - 1, max: max + 1 } : { min, max };
}

const bubbles = computed(() => {
  const sectors = currentFrame.value?.sectors ?? [];
  const xValues = sectors.map((sector) => sector.recent5NetBuyAmount);
  const yValues = sectors.map((sector) => (sector.recent5NetBuyAmount / 5) - (sector.recent20NetBuyAmount / 20));
  const sizeValues = sectors.map((sector) => Math.abs(sector.recent20NetBuyAmount));
  const xRange = numericRange(xValues);
  const yRange = numericRange(yValues);
  const maxSize = Math.max(...sizeValues, 1);
  return sectors.map((sector) => {
    const acceleration = (sector.recent5NetBuyAmount / 5) - (sector.recent20NetBuyAmount / 20);
    const x = 52 + ((sector.recent5NetBuyAmount - xRange.min) / (xRange.max - xRange.min)) * 696;
    const y = 350 - ((acceleration - yRange.min) / (yRange.max - yRange.min)) * 272;
    const radius = 13 + Math.sqrt(Math.abs(sector.recent20NetBuyAmount) / maxSize) * 28;
    return { ...sector, x, y, radius, acceleration };
  });
});

const stateLabels = { surge: '漲潮', rotation: '輪動', watch: '觀望', ebb: '退潮' };
const stateColors = { surge: '#e14848', rotation: '#d7a233', watch: '#6c7bd9', ebb: '#1fa37a' };

const formatAmount = (value) => {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(1)} 億`;
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(0)} 萬`;
  return `${sign}${Math.round(abs).toLocaleString('zh-TW')}`;
}

const selectBubble = (bubble) => {
  selectedSector.value = bubble;
}

const step = (direction) => {
  if (!frames.value.length) return;
  frameIndex.value = Math.min(Math.max(frameIndex.value + direction, 0), frames.value.length - 1);
}

const togglePlay = () => {
  isPlaying.value = !isPlaying.value;
  if (isPlaying.value) {
    timer = window.setInterval(() => {
      if (frameIndex.value >= frames.value.length - 1) {
        isPlaying.value = false;
        window.clearInterval(timer);
        timer = null;
        return;
      }
      frameIndex.value += 1;
    }, 900);
  } else if (timer) {
    window.clearInterval(timer);
    timer = null;
  }
}

const loadReplay = async () => {
  isLoading.value = true;
  errorMessage.value = '';
  try {
    const body = await fetchSectorReplay({ days: 20, watchlistOnly: watchlistOnly.value });
    frames.value = body.frames ?? [];
    frameIndex.value = Math.max(0, frames.value.length - 1);
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isLoading.value = false;
  }
}

onMounted(loadReplay);
onUnmounted(() => { if (timer) window.clearInterval(timer); });
</script>

<template>
  <section class="mb-4 overflow-hidden rounded-md border border-hairline bg-panel">
    <header class="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline px-4 pb-3 pt-4">
      <div>
        <h2 class="m-0 font-display text-[1.15rem] font-bold text-crest">板塊資金潮汐回放</h2>
        <p class="m-0 mt-1 text-[0.72rem] text-mute">右邊代表近 5 日流入，上方代表近期力道相對增強；圓圈大小代表近 20 日規模。</p>
      </div>
      <button type="button" class="text-sm text-mute underline hover:text-paper" :disabled="isLoading" @click="loadReplay">重新整理</button>
    </header>

    <p v-if="errorMessage" class="m-4 rounded border border-ebb/40 bg-ebb/10 px-3 py-2 text-sm text-paper">{{ errorMessage }}</p>
    <p v-else-if="isLoading" class="px-4 py-8 text-center text-mute">正在讀取回放資料…</p>
    <p v-else-if="!currentFrame" class="px-4 py-8 text-center text-mute">目前尚未累積足夠的法人歷史資料。</p>

    <template v-else>
      <div class="overflow-x-auto px-4 pt-4">
        <svg viewBox="0 0 800 410" class="h-auto min-w-[680px] w-full rounded border border-hairline bg-ink" role="img" aria-label="板塊資金泡泡圖">
          <line x1="400" y1="26" x2="400" y2="382" stroke="#2e3140" stroke-width="1" />
          <line x1="24" y1="205" x2="776" y2="205" stroke="#2e3140" stroke-width="1" />
          <text x="28" y="24" fill="#8a8fa3" font-size="12">力道增強</text>
          <text x="28" y="400" fill="#8a8fa3" font-size="12">力道減弱</text>
          <text x="28" y="222" fill="#8a8fa3" font-size="12">資金流出</text>
          <text x="690" y="222" fill="#8a8fa3" font-size="12">資金流入</text>
          <g v-for="bubble in bubbles" :key="bubble.id" class="cursor-pointer" @click="selectBubble(bubble)">
            <circle :cx="bubble.x" :cy="bubble.y" :r="bubble.radius" :fill="stateColors[bubble.state]" fill-opacity="0.72" stroke="#edebe4" stroke-opacity="0.35" />
            <text :x="bubble.x" :y="bubble.y + 4" text-anchor="middle" fill="#edebe4" font-size="11">{{ bubble.name }}</text>
          </g>
        </svg>
      </div>

      <div class="flex flex-wrap items-center gap-2 px-4 py-3">
        <button type="button" class="rounded border px-2 py-1 text-xs" :class="watchlistOnly ? 'border-gold bg-gold text-ink' : 'border-hairline text-mute hover:text-paper'" @click="watchlistOnly = !watchlistOnly; loadReplay()">{{ watchlistOnly ? '只看自選相關' : '全部熱門板塊' }}</button>
        <button type="button" class="rounded border border-hairline px-2 py-1 text-sm text-mute hover:text-paper" @click="step(-1)">‹</button>
        <button type="button" class="rounded border border-gold px-3 py-1 text-sm text-gold" @click="togglePlay">{{ isPlaying ? '暫停' : '播放' }}</button>
        <button type="button" class="rounded border border-hairline px-2 py-1 text-sm text-mute hover:text-paper" @click="step(1)">›</button>
        <span class="font-mono text-xs text-mute">{{ currentFrame.date }} · 第 {{ frameIndex + 1 }}／{{ frames.length }} 天</span>
      </div>

      <div v-if="selectedSector" class="mx-4 mb-4 rounded border border-hairline bg-panel-raised p-3">
        <div class="flex items-baseline justify-between gap-2">
          <h3 class="m-0 text-sm font-bold">{{ selectedSector.name }}</h3>
          <span class="rounded px-2 py-1 text-xs" :style="{ color: stateColors[selectedSector.state] }">{{ stateLabels[selectedSector.state] }}</span>
        </div>
        <p class="m-0 mt-2 font-mono text-xs text-mute">近 5 日 {{ formatAmount(selectedSector.recent5NetBuyAmount) }} · 近 20 日 {{ formatAmount(selectedSector.recent20NetBuyAmount) }} · 買 {{ selectedSector.recent5BuyCount }}／賣 {{ selectedSector.recent5SellCount }}</p>
        <p class="m-0 mt-1 text-[0.7rem] text-mute">圓圈只代表資金規模，不代表好壞；板塊分類與法人金額皆是整理／估算資料。</p>
      </div>
    </template>
  </section>
</template>
