<script setup>
import { computed, onMounted, ref } from 'vue';
import { fetchSectorFlow } from '../services/api.js';

const flow = ref(null);
const isLoading = ref(true);
const errorMessage = ref('');
const selectedState = ref('all');
const watchlistOnly = ref(false);

const stateLabels = {
  surge: '漲潮',
  rotation: '輪動',
  watch: '觀望',
  ebb: '退潮',
};

const filteredSectors = computed(() => {
  const sectors = flow.value?.sectors ?? [];
  return selectedState.value === 'all'
    ? sectors
    : sectors.filter((sector) => sector.state === selectedState.value);
});

function formatAmount(value) {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(1)} 億`;
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(0)} 萬`;
  return `${sign}${Math.round(abs).toLocaleString('zh-TW')}`;
}

function stateClass(state) {
  return {
    surge: 'border-surge/40 bg-surge/10 text-surge',
    rotation: 'border-gold/40 bg-gold/10 text-gold',
    watch: 'border-signal/40 bg-signal/10 text-signal',
    ebb: 'border-ebb/40 bg-ebb/10 text-ebb',
  }[state] || 'border-hairline bg-ink text-mute';
}

async function loadFlow() {
  isLoading.value = true;
  errorMessage.value = '';
  try {
    flow.value = await fetchSectorFlow({ days: 20, watchlistOnly: watchlistOnly.value });
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isLoading.value = false;
  }
}

onMounted(loadFlow);
</script>

<template>
  <section class="mb-4 overflow-hidden rounded-md border border-hairline bg-panel">
    <header class="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline px-4 pb-3 pt-4">
      <div>
        <h2 class="m-0 font-display text-[1.15rem] font-bold text-crest">熱門板塊資金流向</h2>
        <p class="m-0 mt-1 text-[0.72rem] text-mute">近 5 日看短線流向，近 20 日看資金累積；金額為估算值。</p>
      </div>
      <button type="button" class="text-sm text-mute underline hover:text-paper" :disabled="isLoading" @click="loadFlow">重新整理</button>
    </header>

    <div class="flex flex-wrap gap-2 border-b border-hairline px-4 py-3">
      <button type="button" class="rounded border px-2 py-1 text-xs" :class="watchlistOnly ? 'border-gold bg-gold text-ink' : 'border-hairline text-mute hover:text-paper'" @click="watchlistOnly = !watchlistOnly; loadFlow()">{{ watchlistOnly ? '只看自選相關' : '全部熱門板塊' }}</button>
      <button
        v-for="(label, state) in { all: '全部', surge: '漲潮', rotation: '輪動', watch: '觀望', ebb: '退潮' }"
        :key="state"
        type="button"
        class="rounded border px-2 py-1 text-xs"
        :class="selectedState === state ? 'border-paper bg-paper text-ink' : 'border-hairline text-mute hover:text-paper'"
        @click="selectedState = state"
      >{{ label }}</button>
    </div>

    <p v-if="errorMessage" class="m-4 rounded border border-ebb/40 bg-ebb/10 px-3 py-2 text-sm text-paper">{{ errorMessage }}</p>
    <p v-else-if="isLoading" class="px-4 py-8 text-center text-mute">正在讀取板塊資金資料…</p>
    <p v-else-if="!flow || flow.daysScanned === 0" class="px-4 py-8 text-center text-mute">目前尚未累積足夠的法人歷史資料。</p>

    <div v-else class="overflow-x-auto">
      <table class="w-full min-w-[720px] border-collapse text-sm">
        <thead class="border-b border-hairline text-left text-[0.7rem] text-mute">
          <tr>
            <th class="px-4 py-2 font-normal">板塊</th>
            <th class="px-2 py-2 font-normal">狀態</th>
            <th class="px-2 py-2 text-right font-normal">近 5 日資金</th>
            <th class="px-2 py-2 text-right font-normal">近 20 日資金</th>
            <th class="px-2 py-2 text-right font-normal">買／賣筆數</th>
            <th class="px-4 py-2 font-normal">主要貢獻</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-hairline">
          <tr v-for="sector in filteredSectors" :key="sector.id" class="hover:bg-panel-raised">
            <td class="px-4 py-3 font-medium">{{ sector.name }} <span class="text-xs text-mute">{{ sector.constituentCount }} 檔</span></td>
            <td class="px-2 py-3"><span class="rounded border px-2 py-1 text-xs" :class="stateClass(sector.state)">{{ stateLabels[sector.state] }}</span></td>
            <td class="px-2 py-3 text-right font-mono" :class="sector.recent5NetBuyAmount >= 0 ? 'text-surge' : 'text-ebb'">{{ formatAmount(sector.recent5NetBuyAmount) }}</td>
            <td class="px-2 py-3 text-right font-mono" :class="sector.recent20NetBuyAmount >= 0 ? 'text-surge' : 'text-ebb'">{{ formatAmount(sector.recent20NetBuyAmount) }}</td>
            <td class="px-2 py-3 text-right font-mono text-mute">{{ sector.recent5BuyCount }}／{{ sector.recent5SellCount }}</td>
            <td class="px-4 py-3 font-mono text-xs text-mute">
              <span v-if="sector.leaders?.length">{{ sector.leaders.map((leader) => `${leader.code} ${formatAmount(leader.netBuyAmount)}`).join('、') }}</span>
              <span v-else>目前沒有可換算金額的資料</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="flow && !isLoading" class="m-0 border-t border-hairline px-4 py-2 text-[0.7rem] text-mute">
      使用 {{ flow.daysScanned }}／{{ flow.daysRequested }} 個交易日；{{ flow.disclaimer }}
    </p>
  </section>
</template>
