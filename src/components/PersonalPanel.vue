<script setup>
import { onMounted, ref } from 'vue';
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
const detail = ref(null);
const detailLoading = ref(false);
const detailError = ref('');

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

const searchStockOptions = async () => {
  selectedStock.value = null;
  searchError.value = '';
  searchResults.value = [];
  const query = searchInput.value.trim();
  if (!query) return;
  if (query.length < 2 && !/^\d{4,6}$/.test(query)) {
    searchError.value = '請至少輸入 2 個字，或輸入完整 4～6 碼股號。';
    return;
  }

  searchLoading.value = true;
  try {
    const body = await searchStocks(query);
    searchResults.value = body.items ?? [];
    if (searchResults.value.length === 0) {
      searchError.value = body.sourceErrors?.length
        ? `部分行情來源無法讀取：${body.sourceErrors.join('；')}`
        : '找不到符合的股票，請改用股號或完整／部分名稱搜尋。';
    }
  } catch (error) {
    searchError.value = error.message;
  } finally {
    searchLoading.value = false;
  }
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

const displayScore = (value) => {
  return value == null ? '—' : Number(value).toFixed(1);
}

const factorItems = (signals) => [
  { label: '量能異常', value: signals?.volumeContribution, tone: 'gold' },
  { label: '跳空幅度', value: signals?.gapContribution, tone: 'surge' },
  { label: '相對大盤', value: signals?.relativeStrengthContribution, tone: 'signal' },
  { label: '法人買賣超', value: signals?.institutionalContribution, tone: 'crest' },
].filter((item) => item.value != null);

const factorBarWidth = (value) => {
  if (value == null) return '0%';
  return `${Math.max(0, Math.min(100, Number(value) * 4))}%`;
}

const stockPointRecords = () => detail.value?.stockPoint?.records ?? [];

const stockPointValue = (value, suffix = '%') => {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(1)}${suffix}`;
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
  <section class="mb-4 overflow-hidden rounded-xl border border-hairline bg-panel shadow-[0_14px_36px_rgba(0,0,0,0.12)]">
    <header class="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline px-4 pb-4 pt-5 sm:px-5">
      <div>
        <h2 class="m-0 font-display text-[1.15rem] font-bold text-gold">我的自選（共用）</h2>
        <p class="m-0 mt-1 max-w-2xl text-[0.72rem] leading-relaxed text-mute">先確認股票，再加入清單；加入後可查看勝率、歷史交易樣本與目前行情，最後由你自行判斷。</p>
      </div>
      <span class="rounded-full border border-gold/30 bg-gold/10 px-2.5 py-1 font-mono text-[0.75rem] text-gold">{{ items.length }} 檔</span>
    </header>

    <div class="border-b border-hairline bg-ink/20 p-4 sm:p-5">
      <label class="flex flex-col gap-1.5 text-[0.72rem] text-mute">
        <span class="font-bold text-paper">新增自選股</span>
        <span>搜尋名稱或股號，選取正確資料後再加入。</span>
        <div class="flex gap-2">
          <input v-model="searchInput" aria-label="搜尋股票名稱或股號" class="min-w-0 flex-1 rounded-lg border border-hairline bg-ink px-3 py-2.5 text-paper placeholder:text-mute/70" placeholder="例如 2330、台積電" autocomplete="off" @keyup.enter="searchStockOptions">
          <button type="button" class="rounded-lg border border-gold px-3 py-2 text-sm font-medium text-gold transition hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-50" :disabled="searchLoading" @click="searchStockOptions">
            {{ searchLoading ? '搜尋中…' : '搜尋' }}
          </button>
        </div>
      </label>

      <p v-if="searchLoading" class="m-0 mt-2 text-xs text-mute">正在查詢 TWSE／TPEx 最新行情…</p>
      <p v-if="searchError" class="m-0 mt-2 text-xs text-ebb">{{ searchError }}</p>

      <ul v-if="searchResults.length" class="m-0 mt-3 list-none overflow-hidden rounded-lg border border-hairline bg-ink p-0" aria-label="股票搜尋結果">
        <li v-for="stock in searchResults" :key="`${stock.market}-${stock.code}`">
          <button type="button" class="flex w-full items-center justify-between gap-3 border-b border-hairline px-3 py-2.5 text-left text-sm transition last:border-b-0 hover:bg-panel-raised" @click="selectStock(stock)">
            <span><span class="font-mono text-mute">{{ stock.code }}</span> <span class="text-paper">{{ stock.name }}</span></span>
            <span class="text-xs text-mute">{{ stock.market === 'TPEx' ? '上櫃' : '上市' }}</span>
          </button>
        </li>
      </ul>

      <div v-if="selectedStock" class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gold/30 bg-gold/10 px-3 py-2.5 text-sm">
        <span>已選擇：<strong>{{ selectedStock.name }}</strong> <span class="font-mono text-mute">{{ selectedStock.code }}</span></span>
        <button type="button" class="rounded-lg bg-gold px-3 py-2 text-sm font-bold text-ink transition hover:bg-gold/90 disabled:cursor-not-allowed disabled:opacity-50" :disabled="isSaving" @click="addItem">
        {{ isSaving ? '處理中…' : '加入自選' }}
        </button>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 pt-4 sm:px-5">
      <span class="text-[0.7rem] text-mute">共用清單中的股票會顯示在下方</span>
      <button type="button" class="text-sm text-mute underline hover:text-paper" :disabled="isLoading || isSaving" @click="loadWatchlist">重新整理</button>
    </div>

    <p v-if="errorMessage" class="mx-4 mb-3 rounded border border-ebb/40 bg-ebb/10 px-3 py-2 text-sm text-paper">{{ errorMessage }}</p>
    <p v-if="isLoading" class="px-4 py-6 text-center text-mute">正在讀取共用自選股…</p>
    <div v-else-if="items.length === 0" class="mx-4 mb-4 rounded-lg border border-dashed border-hairline px-4 py-8 text-center sm:mx-5">
      <p class="m-0 text-sm text-paper">目前還沒有自選股</p>
      <p class="m-0 mt-1 text-xs text-mute">搜尋一檔股票，確認名稱與股號後即可加入。</p>
    </div>

    <ul v-else class="m-0 grid list-none gap-2 px-4 pb-4 sm:grid-cols-2 sm:px-5">
      <li v-for="item in items" :key="item.code" class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-hairline bg-ink/30 px-3 py-3 transition hover:border-gold/40 hover:bg-panel-raised">
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

    <section v-if="detail || detailLoading || detailError" class="border-t border-hairline bg-panel-raised p-4 sm:p-5">
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

        <div v-if="detail.current" class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <div><span class="block text-xs text-mute">收盤價</span><span class="font-mono">{{ displayPrice(detail.current.close) }}</span></div>
          <div><span class="block text-xs text-mute">漲跌幅</span><span class="font-mono">{{ displayPercent(detail.current.changePercent) }}</span></div>
          <div><span class="block text-xs text-mute">成交量</span><span class="font-mono">{{ displayVolume(detail.current.volume) }}</span></div>
          <div><span class="block text-xs text-mute">綜合分數</span><span class="font-mono text-gold">{{ displayScore(detail.current.score) }}</span></div>
          <div><span class="block text-xs text-mute">模型方向</span><span>{{ detail.current.side === 'long' ? '多方榜' : '空方榜' }}</span></div>
        </div>
        <p v-else class="mt-3 rounded border border-gold/30 bg-gold/10 px-3 py-2 text-xs text-gold">目前掃描結果沒有這檔股票的最新行情，只能先顯示歷史回測統計。</p>

        <div v-if="factorItems(detail.current?.signals).length" class="mt-4 rounded-lg border border-hairline bg-ink/40 p-3">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h4 class="m-0 text-sm font-bold text-paper">訊號構成</h4>
            <span class="text-[0.68rem] text-mute">數值越高代表對本次模型分數貢獻越大</span>
          </div>
          <div class="mt-3 grid gap-2 sm:grid-cols-2">
            <div v-for="factor in factorItems(detail.current.signals)" :key="factor.label" class="grid grid-cols-[5.5rem_1fr_3rem] items-center gap-2 text-xs">
              <span class="text-mute">{{ factor.label }}</span>
              <span class="h-1.5 overflow-hidden rounded-full bg-panel-raised"><span class="block h-full rounded-full" :class="`bg-${factor.tone}`" :style="{ width: factorBarWidth(factor.value) }" /></span>
              <span class="text-right font-mono text-paper">{{ displayScore(factor.value) }}</span>
            </div>
          </div>
        </div>

        <div v-if="detail.stockPoint?.records?.length" class="mt-4 rounded-lg border border-hairline bg-ink/40 p-3">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h4 class="m-0 text-sm font-bold text-paper">STOCK POINT 技術分析</h4>
            <span class="text-[0.68rem] text-mute">最近 {{ detail.stockPoint.records.length }} 筆掃描資料</span>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div><span class="block text-[0.65rem] text-mute">波動率</span><span class="font-mono text-xs">{{ stockPointValue(detail.stockPoint.records[0].volatilityPercent) }}</span></div>
            <div><span class="block text-[0.65rem] text-mute">布林帶寬</span><span class="font-mono text-xs">{{ stockPointValue(detail.stockPoint.records[0].bollingerWidthPercent) }}</span></div>
            <div><span class="block text-[0.65rem] text-mute">乖離 MA60</span><span class="font-mono text-xs" :class="detail.stockPoint.records[0].priceToMa60Percent >= 0 ? 'text-surge' : 'text-ebb'">{{ stockPointValue(detail.stockPoint.records[0].priceToMa60Percent) }}</span></div>
            <div><span class="block text-[0.65rem] text-mute">10 日 ROC</span><span class="font-mono text-xs" :class="detail.stockPoint.records[0].roc10Percent >= 0 ? 'text-surge' : 'text-ebb'">{{ stockPointValue(detail.stockPoint.records[0].roc10Percent) }}</span></div>
            <div><span class="block text-[0.65rem] text-mute">POINT 分數</span><span class="font-mono text-xs text-gold">{{ displayScore(detail.stockPoint.records[0].score) }}</span></div>
          </div>
          <div class="mt-3 overflow-x-auto">
            <table class="w-full min-w-[520px] border-collapse text-xs">
              <thead class="border-b border-hairline text-left text-mute">
                <tr><th class="py-2 font-normal">日期</th><th class="py-2 text-right font-normal">收盤</th><th class="py-2 text-right font-normal">MA60 乖離</th><th class="py-2 text-right font-normal">10 日 ROC</th><th class="py-2 text-right font-normal">分數</th></tr>
              </thead>
              <tbody class="divide-y divide-hairline">
                <tr v-for="record in detail.stockPoint.records" :key="record.date">
                  <td class="py-2 font-mono text-mute">{{ record.date }}</td>
                  <td class="py-2 text-right font-mono">{{ displayPrice(record.close) }}</td>
                  <td class="py-2 text-right font-mono" :class="record.priceToMa60Percent >= 0 ? 'text-surge' : 'text-ebb'">{{ stockPointValue(record.priceToMa60Percent) }}</td>
                  <td class="py-2 text-right font-mono" :class="record.roc10Percent >= 0 ? 'text-surge' : 'text-ebb'">{{ stockPointValue(record.roc10Percent) }}</td>
                  <td class="py-2 text-right font-mono text-gold">{{ displayScore(record.score) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <p v-else-if="detail.stockPoint?.reason" class="mt-4 rounded-lg border border-hairline bg-ink/30 px-3 py-2 text-xs text-mute">STOCK POINT 技術分析目前無法取得：{{ detail.stockPoint.reason }}</p>

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
