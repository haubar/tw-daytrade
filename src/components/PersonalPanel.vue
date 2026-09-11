<script setup>
import { computed, onMounted, ref } from 'vue';
import Badge from './base/Badge.vue';
import { formatPercent, formatPrice, formatVolume } from '../utils/format.js';
import {
  addSharedWatchlistItem,
  fetchSharedWatchlist,
  fetchStockDetail,
  removeSharedWatchlistItem,
  searchStocks,
} from '../services/api.js';

const items = ref([]);
const audit = ref([]);
const isLoading = ref(true);
const isSaving = ref(false);
const errorMessage = ref('');
const searchInput = ref('');
const searchResults = ref([]);
const selectedStock = ref(null);
const searchLoading = ref(false);
const searchError = ref('');
const filterInput = ref('');
const detail = ref(null);
const detailLoading = ref(false);
const detailError = ref('');

const filteredItems = computed(() => {
  const keyword = filterInput.value.trim().toLowerCase();
  if (!keyword) return items.value;
  return items.value.filter((item) => `${item.code} ${item.name}`.toLowerCase().includes(keyword));
});

const applyWatchlist = (body) => {
  items.value = Array.isArray(body.items) ? body.items : [];
  audit.value = Array.isArray(body.audit) ? body.audit : [];
}

const loadWatchlist = async () => {
  isLoading.value = true;
  errorMessage.value = '';
  try {
    applyWatchlist(await fetchSharedWatchlist());
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isLoading.value = false;
  }
}

const addItem = async () => {
  if (!selectedStock.value) {
    errorMessage.value = '請先搜尋並選擇一檔已確認存在的股票';
    return;
  }

  isSaving.value = true;
  errorMessage.value = '';
  try {
    applyWatchlist(await addSharedWatchlistItem(selectedStock.value));
    searchInput.value = '';
    searchResults.value = [];
    selectedStock.value = null;
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isSaving.value = false;
  }
}

let searchTimer;
const searchStockOptions = async () => {
  clearTimeout(searchTimer);
  selectedStock.value = null;
  searchError.value = '';
  searchResults.value = [];
  const query = searchInput.value.trim();
  if (!query) return;

  searchTimer = setTimeout(async () => {
    searchLoading.value = true;
    try {
      const body = await searchStocks(query);
      searchResults.value = body.items ?? [];
      if (searchResults.value.length === 0) searchError.value = '找不到符合的股票，請改用股號或完整／部分名稱搜尋。';
    } catch (error) {
      searchError.value = error.message;
    } finally {
      searchLoading.value = false;
    }
  }, 350);
}

const selectStock = (stock) => {
  selectedStock.value = stock;
  searchInput.value = `${stock.code} ${stock.name}`;
  searchResults.value = [];
  searchError.value = '';
}

const removeItem = async (item) => {
  if (!window.confirm(`確定要從共用自選股移除 ${item.name}（${item.code}）嗎？這會影響所有使用者。`)) return;

  isSaving.value = true;
  errorMessage.value = '';
  try {
    applyWatchlist(await removeSharedWatchlistItem(item.code));
  } catch (error) {
    errorMessage.value = error.message;
  } finally {
    isSaving.value = false;
  }
}

const displayPercent = (value) => {
  return value == null ? '—' : formatPercent(value);
}

const displayPrice = (value) => {
  return value == null ? '—' : formatPrice(value);
}

const displayVolume = (value) => {
  return value == null ? '—' : formatVolume(value);
}

const openDetail = async (item) => {
  detailLoading.value = true;
  detailError.value = '';
  try {
    const body = await fetchSharedWatchlist();
    // 重新讀取共用清單，避免在其他使用者剛修改後使用過期項目。
    applyWatchlist(body);
    detail.value = await fetchStockDetail(item.code, 60);
  } catch (error) {
    detailError.value = error.message;
  } finally {
    detailLoading.value = false;
  }
}

onMounted(loadWatchlist);
</script>

<template>
  <section class="mb-4 overflow-hidden rounded-md border border-hairline bg-panel">
    <header class="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline px-4 pb-3 pt-4">
      <div>
        <h2 class="m-0 font-display text-[1.15rem] font-bold text-gold">我的自選（共用）</h2>
        <p class="m-0 mt-1 text-[0.72rem] text-mute">所有使用者共用，加入或移除會影響整份清單。</p>
      </div>
      <span class="font-mono text-[0.85rem] text-mute">{{ items.length }} 檔</span>
    </header>

    <div class="border-b border-hairline p-4">
      <label class="flex flex-col gap-1 text-[0.72rem] text-mute">
        搜尋股票名稱或股號
        <input v-model="searchInput" class="rounded border border-hairline bg-ink px-2 py-2 text-paper" placeholder="例如 2330、台積電" autocomplete="off" @input="searchStockOptions" @keyup.enter="searchResults[0] && selectStock(searchResults[0])">
      </label>

      <p v-if="searchLoading" class="m-0 mt-2 text-xs text-mute">正在查詢 TWSE／TPEx 最新行情…</p>
      <p v-if="searchError" class="m-0 mt-2 text-xs text-ebb">{{ searchError }}</p>

      <ul v-if="searchResults.length" class="m-0 mt-2 list-none overflow-hidden rounded border border-hairline bg-ink p-0">
        <li v-for="stock in searchResults" :key="`${stock.market}-${stock.code}`">
          <button type="button" class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-panel-raised" @click="selectStock(stock)">
            <span><span class="font-mono text-mute">{{ stock.code }}</span> <span class="text-paper">{{ stock.name }}</span></span>
            <span class="text-xs text-mute">{{ stock.market === 'TPEx' ? '上櫃' : '上市' }}</span>
          </button>
        </li>
      </ul>

      <div v-if="selectedStock" class="mt-2 flex flex-wrap items-center justify-between gap-2 rounded border border-gold/30 bg-gold/10 px-3 py-2 text-sm">
        <span>已選擇：<strong>{{ selectedStock.name }}</strong> <span class="font-mono text-mute">{{ selectedStock.code }}</span></span>
        <button type="button" class="rounded bg-gold px-3 py-2 text-sm font-bold text-ink disabled:cursor-not-allowed disabled:opacity-50" :disabled="isSaving" @click="addItem">
        {{ isSaving ? '處理中…' : '加入自選' }}
        </button>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 pt-3">
      <input v-model="filterInput" class="rounded border border-hairline bg-ink px-2 py-1.5 text-sm text-paper" placeholder="搜尋共用自選股">
      <button type="button" class="text-sm text-mute underline hover:text-paper" :disabled="isLoading || isSaving" @click="loadWatchlist">重新整理</button>
    </div>

    <p v-if="errorMessage" class="mx-4 mb-3 rounded border border-ebb/40 bg-ebb/10 px-3 py-2 text-sm text-paper">{{ errorMessage }}</p>
    <p v-if="isLoading" class="px-4 py-6 text-center text-mute">正在讀取共用自選股…</p>
    <p v-else-if="filteredItems.length === 0" class="px-4 py-6 text-center text-mute">目前沒有符合的共用自選股。</p>

    <ul v-else class="m-0 list-none divide-y divide-hairline p-0">
      <li v-for="item in filteredItems" :key="item.code" class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-panel-raised">
        <div class="flex min-w-0 items-center gap-2">
          <span class="font-mono text-sm text-mute">{{ item.code }}</span>
          <span class="truncate font-medium">{{ item.name }}</span>
          <Badge :label="item.market === 'TPEx' ? '上櫃' : '上市'" />
          <span v-if="item.addCount > 1" class="text-[0.7rem] text-mute">加入 {{ item.addCount }} 次</span>
        </div>
        <div class="flex items-center gap-3">
          <button type="button" class="text-sm text-gold underline hover:text-paper" :disabled="isSaving || detailLoading" @click="openDetail(item)">查看資料</button>
          <button type="button" class="text-sm text-mute underline hover:text-ebb" :disabled="isSaving" @click="removeItem(item)">移除</button>
        </div>
      </li>
    </ul>

    <section v-if="detail || detailLoading || detailError" class="border-t border-hairline bg-panel-raised p-4">
      <p v-if="detailLoading" class="m-0 text-sm text-mute">正在讀取 {{ detail?.code || '個股' }} 詳細資料…</p>
      <p v-if="detailError" class="m-0 rounded border border-ebb/40 bg-ebb/10 px-3 py-2 text-sm text-paper">{{ detailError }}</p>
      <template v-if="detail && !detailLoading">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 class="m-0 font-display text-lg font-bold">{{ detail.name }} <span class="font-mono text-sm text-mute">{{ detail.code }}</span></h3>
            <p class="m-0 mt-1 text-xs text-mute">資料日 {{ detail.signalDate || '—' }} · 勝率樣本期間 {{ detail.daysRequested }} 個交易日</p>
          </div>
          <button type="button" class="text-sm text-mute underline hover:text-paper" @click="detail = null">關閉</button>
        </div>

        <div v-if="detail.current" class="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div><span class="block text-xs text-mute">收盤價</span><span class="font-mono">{{ displayPrice(detail.current.close) }}</span></div>
          <div><span class="block text-xs text-mute">漲跌幅</span><span class="font-mono">{{ displayPercent(detail.current.changePercent) }}</span></div>
          <div><span class="block text-xs text-mute">成交量</span><span class="font-mono">{{ displayVolume(detail.current.volume) }}</span></div>
          <div><span class="block text-xs text-mute">模型方向</span><span>{{ detail.current.side === 'long' ? '多方榜' : '空方榜' }}</span></div>
        </div>
        <p v-else class="mt-3 rounded border border-gold/30 bg-gold/10 px-3 py-2 text-xs text-gold">目前掃描結果沒有這檔股票的最新行情，只能先顯示歷史回測統計。</p>

        <div class="mt-4 grid gap-2 sm:grid-cols-2">
          <div v-for="strategy in Object.values(detail.strategies)" :key="strategy.label" class="rounded border border-hairline bg-ink p-3">
            <h4 class="m-0 text-sm font-bold text-paper">{{ strategy.label }}</h4>
            <p class="m-0 mt-2 font-mono text-xs leading-relaxed text-mute">
              勝率：<span class="text-paper">{{ displayPercent(strategy.winRatePercent) }}</span><br>
              勝場：{{ strategy.wins }}／{{ strategy.trades }}<br>
              平均淨報酬：<span :class="strategy.avgNetReturnPercent != null && strategy.avgNetReturnPercent >= 0 ? 'text-surge' : 'text-ebb'">{{ displayPercent(strategy.avgNetReturnPercent) }}</span>
            </p>
          </div>
        </div>
        <p class="m-0 mt-3 text-[0.72rem] text-mute">{{ detail.disclaimer }} 最近交易日期：{{ detail.lastSeenDate || '尚無回測資料' }}。</p>
      </template>
    </section>

    <p v-if="audit.length" class="m-0 border-t border-hairline px-4 py-2 text-[0.7rem] text-mute">已保留最近 {{ audit.length }} 筆共用清單操作紀錄。</p>
  </section>
</template>
