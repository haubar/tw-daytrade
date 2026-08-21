<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import StatusBar from './components/StatusBar.vue';
import WatchlistPanel from './components/WatchlistPanel.vue';
import FilterPanel from './components/FilterPanel.vue';
import { sampleScanResult } from './sampleData.js';
import { filterWatchlist, isFilterActive, DEFAULT_MIN_VOLUME_LOTS } from './utils/filterWatchlist.js';
import { formatPercent } from './utils/format.js';

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
</script>

<template>
  <div class="flex min-h-screen justify-center px-4 pb-8 pt-6">
    <main class="w-full max-w-[1080px]">
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
          <h2 class="m-0 text-sm font-bold text-paper">基準回測｜前一日多方 Top {{ result.backtest.configuredTopN }}，隔日開盤買・收盤賣</h2>
          <p class="mb-0 mt-2 font-mono text-[0.78rem] text-mute">
            訊號日 {{ result.backtest.signalDate }} · 執行日 {{ result.backtest.executionDate }} · 成交 {{ result.backtest.executedCount }}/{{ result.backtest.selectedCount }} 檔 ·
            毛報酬 {{ formatPercent(result.backtest.grossReturnPercent) }} · 淨報酬
            <span :class="netReturnColorClass(result.backtest.netReturnPercent)">{{ formatPercent(result.backtest.netReturnPercent) }}</span> ·
            勝率 {{ formatPercent(result.backtest.winRatePercent) }}
          </p>
          <p v-if="result.backtest.executedCount === 0" class="mb-0 mt-2 rounded-sm border border-gold/40 bg-gold/10 px-2 py-1.5 text-[0.75rem] text-gold">
            今天沒有任何一檔成交，報酬率暫時無法計算（不是 0%，是完全沒有資料）。
            {{ backtestSkipSummary }}
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
        </footer>
      </template>
    </main>
  </div>
</template>
