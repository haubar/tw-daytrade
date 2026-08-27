<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import StatusBar from './components/StatusBar.vue';
import WatchlistPanel from './components/WatchlistPanel.vue';
import FilterPanel from './components/FilterPanel.vue';
import HistoryPanel from './components/HistoryPanel.vue';
import BackfillControlPage from './components/BackfillControlPage.vue';
import { sampleScanResult } from './sampleData.js';
import { filterWatchlist, isFilterActive, DEFAULT_MIN_VOLUME_LOTS } from './utils/filterWatchlist.js';
import { formatPercent } from './utils/format.js';

const historyPanelRef = ref(null);
// 目前沒有引入 vue-router（整個專案刻意保持輕量，只有兩個畫面切換，不值得為此加一個路由套件），
// 用最單純的狀態切換即可：'dashboard' 是平常的觀察榜畫面，'backfill-control' 是回填控制頁。
const currentView = ref('dashboard');

const result = ref(null);
const isSample = ref(false);
const loadError = ref(null);
const isLoading = ref(true);

// 篩選條件：股價區間、最小成交量、最小漲跌幅度。null 代表該條件不限制。
// 這是純前端的顯示篩選，不會重新觸發後端計算，也不會影響分數本身
// （分數的「相對強弱」「百分位排名」都是用全市場候選池算出來的，篩選只是決定要不要顯示這一列）。
//
// minVolume 預設不是 null，而是 DEFAULT_MIN_VOLUME_LOTS（100 張）：一開始就給使用者一個
// 合理的流動性門檻，避免預設就看到成交量小到隔天可能買不到/賣不掉的股票；使用者仍可以自行
// 調整或按「清除篩選」拿掉這個限制。
const filters = reactive({ minPrice: null, maxPrice: null, minVolume: DEFAULT_MIN_VOLUME_LOTS * 1000, minGainPercent: null, hideDayTradeIneligible: false });

const filteredLongWatchlist = computed(() =>
  result.value ? filterWatchlist(result.value.longWatchlist, filters) : []
);
const filteredShortWatchlist = computed(() =>
  result.value ? filterWatchlist(result.value.shortWatchlist, filters) : []
);
const filterActive = computed(() => isFilterActive(filters));

// netReturnPercent 可能是 null（今天完全沒有成交時，不是「報酬率剛好是0」）。
// null >= 0 在 JS 裡會被當成 0 >= 0 判斷成 true，如果直接拿這個條件式決定顏色，
// 沒有交易的情況會被誤標成綠色（賺錢），這是會誤導使用者的顯示錯誤，
// 所以要先明確排除 null／undefined 的情況，給一個中性色，不能讓它落入紅或綠。
function netReturnColorClass(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'text-mute';
  return value >= 0 ? 'text-surge' : 'text-ebb';
}

// executedCount 是 0 時，給使用者一個看得懂的原因摘要，而不是只留一句「沒有交易」讓人猜。
// 如果 skipped 裡的原因全部一樣（最常見的情況：當天某個市場資料源整個失敗，見 backtest.mjs
// 的 unavailableMarkets 說明），就直接把那句原因秀出來；原因不只一種時，退回顯示筆數，
// 避免把好幾種不同原因硬擠成一句可能誤導的話。
const backtestSkipSummary = computed(() => {
  const skipped = result.value?.backtest?.skipped;
  if (!skipped || skipped.length === 0) return '';
  const reasons = new Set(skipped.map((s) => s.reason));
  if (reasons.size === 1) return `原因：${[...reasons][0]}`;
  return `共 ${skipped.length} 檔被跳過，原因不只一種，詳見 API 回應的 skipped 欄位。`;
});

async function loadData() {
  isLoading.value = true;
  loadError.value = null;

  try {
    const res = await fetch('/.netlify/functions/latest');

    if (res.status === 404) {
      // 部署成功但排程還沒執行過第一次，這不是錯誤，是正常的「還沒有資料」狀態
      result.value = sampleScanResult;
      isSample.value = true;
      return;
    }

    if (!res.ok) {
      throw new Error(`伺服器回應錯誤: HTTP ${res.status}`);
    }

    result.value = await res.json();
    isSample.value = false;
  } catch (e) {
    // 本機開發（沒跑 netlify dev）或網路問題都會落到這裡，先用範例資料讓畫面看得到東西，
    // 不要整頁空白或卡在載入中——空畫面對使用者沒有任何幫助。
    result.value = sampleScanResult;
    isSample.value = true;
    loadError.value = e.message;
  } finally {
    isLoading.value = false;
  }
}

onMounted(loadData);

// 按任一方向鍵叫出「歷史資料列表」面板（見 HistoryPanel.vue）。用全域監聽器而不是綁在
// 某個特定元件上，是因為使用者不需要先點擊任何東西、隨時按方向鍵都應該有反應——
// 這是刻意設計成不明顯的隱藏功能，不放進一般可見的 UI 按鈕。
function handleGlobalKeydown(e) {
  historyPanelRef.value?.handleKeydown(e);
}
onMounted(() => window.addEventListener('keydown', handleGlobalKeydown));
onUnmounted(() => window.removeEventListener('keydown', handleGlobalKeydown));
</script>

<template>
  <div class="flex min-h-screen justify-center px-4 pb-8 pt-6">
    <HistoryPanel ref="historyPanelRef" />

    <BackfillControlPage v-if="currentView === 'backfill-control'" @close="currentView = 'dashboard'" />

    <main v-else class="w-full max-w-[1080px]">
      <template v-if="isLoading">
        <p class="py-8 text-center font-mono text-mute">正在讀取今日觀察榜…</p>
      </template>

      <template v-else-if="result">
        <StatusBar
          :generated-at="result.generatedAt"
          :market-change-percent="result.marketChangePercent"
          :market-change-percent-is-estimate="result.marketChangePercentIsEstimate ?? true"
          :total-candidates="result.totalCandidates"
          :data-source-status="result.dataSourceStatus"
          :is-sample="isSample"
        />

        <div class="mb-4">
          <FilterPanel v-model="filters" />
        </div>

        <p v-if="filterActive" class="mb-3 font-mono text-[0.78rem] text-mute">
          已套用篩選：多方 {{ filteredLongWatchlist.length }}/{{ result.longWatchlist.length }} 檔 ·
          空方 {{ filteredShortWatchlist.length }}/{{ result.shortWatchlist.length }} 檔
        </p>

        <section v-if="result.backtest" class="mb-4 rounded-md border border-hairline bg-panel p-4">
          <h2 class="m-0 mb-3 text-sm font-bold text-paper">隔日當沖回測比對</h2>

          <!-- ===== 📈 多方 ===== -->
          <div class="mb-4">
            <h3 class="m-0 mb-2 text-[0.78rem] font-bold text-surge">📈 多方 (Top {{ result.backtest.configuredTopN }})</h3>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div class="rounded border border-hairline/40 bg-black/10 p-3">
                <h4 class="m-0 text-[0.72rem] font-bold text-mute uppercase tracking-wider">基準策略</h4>
                <p class="m-0 mt-0.5 text-[0.65rem] text-mute/70">開盤價買入 → 收盤價賣出</p>
                <p class="mb-0 mt-2 font-mono text-[0.78rem] text-mute leading-relaxed">
                  成交: {{ result.backtest.executedCount }}/{{ result.backtest.selectedCount }} 檔<br>
                  淨報酬: <span :class="netReturnColorClass(result.backtest.netReturnPercent)">{{ formatPercent(result.backtest.netReturnPercent) }}</span><br>
                  勝率: <span class="text-paper">{{ formatPercent(result.backtest.winRatePercent) }}</span>
                </p>
              </div>
              <div class="rounded border border-surge/30 bg-surge/5 p-3">
                <h4 class="m-0 text-[0.72rem] font-bold text-surge uppercase tracking-wider">★ 高級當沖策略</h4>
                <p class="m-0 mt-0.5 text-[0.65rem] text-surge/70">開盤+1.5%突破買入 · 止損−1% · 漲3.5%→保本+2%出 · 收盤平倉</p>
                <p class="mb-0 mt-2 font-mono text-[0.78rem] text-mute leading-relaxed" v-if="result.backtest.adv">
                  成交: {{ result.backtest.adv.executedCount }}/{{ result.backtest.adv.selectedCount }} 檔 (未觸發: {{ result.backtest.adv.skippedCount }} 檔)<br>
                  淨報酬: <span :class="netReturnColorClass(result.backtest.adv.netReturnPercent)">{{ formatPercent(result.backtest.adv.netReturnPercent) }}</span><br>
                  勝率: <span class="text-surge font-bold">{{ formatPercent(result.backtest.adv.winRatePercent) }}</span>
                </p>
                <p class="mb-0 mt-2 text-[0.75rem] text-mute" v-else>尚無高級策略回測資料</p>
              </div>
            </div>
            <p v-if="result.backtest.executedCount === 0" class="mb-0 mt-2 rounded-sm border border-gold/40 bg-gold/10 px-2 py-1.5 text-[0.75rem] text-gold">
              今天多方基準策略沒有任何一檔成交，報酬率暫時無法計算。
              {{ backtestSkipSummary }}
            </p>
          </div>

          <!-- ===== 📉 空方 ===== -->
          <div v-if="result.backtest.short" class="mb-3">
            <h3 class="m-0 mb-2 text-[0.78rem] font-bold text-ebb">📉 空方 (Top {{ result.backtest.short.configuredTopN }})</h3>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div class="rounded border border-hairline/40 bg-black/10 p-3">
                <h4 class="m-0 text-[0.72rem] font-bold text-mute uppercase tracking-wider">基準策略</h4>
                <p class="m-0 mt-0.5 text-[0.65rem] text-mute/70">開盤價放空 → 收盤價回補</p>
                <p class="mb-0 mt-2 font-mono text-[0.78rem] text-mute leading-relaxed">
                  成交: {{ result.backtest.short.executedCount }}/{{ result.backtest.short.selectedCount }} 檔<br>
                  淨報酬: <span :class="netReturnColorClass(result.backtest.short.netReturnPercent)">{{ formatPercent(result.backtest.short.netReturnPercent) }}</span><br>
                  勝率: <span class="text-paper">{{ formatPercent(result.backtest.short.winRatePercent) }}</span>
                </p>
              </div>
              <div class="rounded border border-ebb/30 bg-ebb/5 p-3">
                <h4 class="m-0 text-[0.72rem] font-bold text-ebb uppercase tracking-wider">★ 高級當沖策略</h4>
                <p class="m-0 mt-0.5 text-[0.65rem] text-ebb/70">開盤−1.5%跌破放空 · 止損+1% · 跌3.5%→保本−2%出 · 收盤平倉</p>
                <p class="mb-0 mt-2 font-mono text-[0.78rem] text-mute leading-relaxed" v-if="result.backtest.short.adv">
                  成交: {{ result.backtest.short.adv.executedCount }}/{{ result.backtest.short.adv.selectedCount }} 檔 (未觸發: {{ result.backtest.short.adv.skippedCount }} 檔)<br>
                  淨報酬: <span :class="netReturnColorClass(result.backtest.short.adv.netReturnPercent)">{{ formatPercent(result.backtest.short.adv.netReturnPercent) }}</span><br>
                  勝率: <span class="text-ebb font-bold">{{ formatPercent(result.backtest.short.adv.winRatePercent) }}</span>
                </p>
                <p class="mb-0 mt-2 text-[0.75rem] text-mute" v-else>尚無高級策略回測資料</p>
              </div>
            </div>
            <p v-if="result.backtest.short.executedCount === 0" class="mb-0 mt-2 rounded-sm border border-gold/40 bg-gold/10 px-2 py-1.5 text-[0.75rem] text-gold">
              今天空方基準策略沒有任何一檔成交，報酬率暫時無法計算。
            </p>
          </div>

          <p class="mb-0 mt-3 font-mono text-[0.72rem] text-mute">
            訊號日 {{ result.backtest.signalDate }} · 執行日 {{ result.backtest.executionDate }}
          </p>
        </section>

        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <WatchlistPanel
            title="多方觀察榜"
            :items="filteredLongWatchlist"
            tone="surge"
            :empty-message="filterActive ? '沒有符合篩選條件的股票，試著放寬篩選範圍。' : '今日沒有符合多方條件的股票。'"
          />
          <WatchlistPanel
            title="空方觀察榜"
            :items="filteredShortWatchlist"
            tone="ebb"
            :empty-message="filterActive ? '沒有符合篩選條件的股票，試著放寬篩選範圍。' : '今日沒有符合空方條件的股票。'"
          />
        </div>

        <footer class="mt-6 flex flex-col gap-1 border-t border-hairline pt-4 text-[0.78rem] text-mute">
          <p class="m-0">{{ result.disclaimer }}</p>
          <p class="m-0 font-mono">
            資料來源：TWSE {{ result.dataSourceStatus.twse }} · TPEx {{ result.dataSourceStatus.tpex }} · 三大法人(上市) {{ result.dataSourceStatus.institutional }}
          </p>
          <p class="m-0 font-mono">
            上櫃法人(FinMind) {{ result.dataSourceStatus.finmindTpexInstitutional ?? '（本次結果尚無此資料，可能是舊版快取）' }}
          </p>
          <p class="m-0 mt-2">
            <button type="button" class="text-mute underline hover:text-paper" @click="currentView = 'backfill-control'">
              回填控制頁
            </button>
          </p>
        </footer>
      </template>
    </main>
  </div>
</template>
