<script setup>
import { ref, onMounted } from 'vue';
import StatusBar from './components/StatusBar.vue';
import WatchlistPanel from './components/WatchlistPanel.vue';
import { sampleScanResult } from './sampleData.js';

const result = ref(null);
const isSample = ref(false);
const loadError = ref(null);
const isLoading = ref(true);

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
          :total-candidates="result.totalCandidates"
          :data-source-status="result.dataSourceStatus"
          :is-sample="isSample"
        />

        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <WatchlistPanel
            title="多方觀察榜"
            :items="result.longWatchlist"
            tone="surge"
            empty-message="今日沒有符合多方條件的股票。"
          />
          <WatchlistPanel
            title="空方觀察榜"
            :items="result.shortWatchlist"
            tone="ebb"
            empty-message="今日沒有符合空方條件的股票。"
          />
        </div>

        <footer class="mt-6 flex flex-col gap-1 border-t border-hairline pt-4 text-[0.78rem] text-mute">
          <p class="m-0">{{ result.disclaimer }}</p>
          <p class="m-0 font-mono">
            資料來源：TWSE {{ result.dataSourceStatus.twse }} · TPEx {{ result.dataSourceStatus.tpex }} · 三大法人 {{ result.dataSourceStatus.institutional }}
          </p>
        </footer>
      </template>
    </main>
  </div>
</template>
