<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import StatusBar from './components/StatusBar.vue';
import WatchlistPanel from './components/WatchlistPanel.vue';
import FilterPanel from './components/FilterPanel.vue';
import { sampleScanResult } from './sampleData.js';
import { filterWatchlist, isFilterActive } from './utils/filterWatchlist.js';

const result = ref(null);
const isSample = ref(false);
const loadError = ref(null);
const isLoading = ref(true);

// 篩選條件：股價區間、最小成交量、最小漲跌幅度。null 代表該條件不限制。
// 這是純前端的顯示篩選，不會重新觸發後端計算，也不會影響分數本身
// （分數的「相對強弱」「百分位排名」都是用全市場候選池算出來的，篩選只是決定要不要顯示這一列）。
const filters = reactive({ minPrice: null, maxPrice: null, minVolume: null, minGainPercent: null });

const filteredLongWatchlist = computed(() =>
  result.value ? filterWatchlist(result.value.longWatchlist, filters) : []
);
const filteredShortWatchlist = computed(() =>
  result.value ? filterWatchlist(result.value.shortWatchlist, filters) : []
);
const filterActive = computed(() => isFilterActive(filters));

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
