<script setup>
// HistoryPanel.vue — 隱藏的「歷史資料列表」面板。使用者依序按「上→下→左→右」（順序不能錯）
// 才會叫出來，平常不會出現在畫面上，避免干擾一般使用流程；主要給比較想了解資料累積現況的
// 使用者，或開發除錯時用。
//
// 顯示內容：合併「哪幾天有成功抓到每日行情快照」（volume-archive，只留最近15天）跟
// 「哪幾天有回測結果」（backtest-storage，留最近260天）——見後端 history-index.mjs 的說明，
// 這兩份資料保留天數不同，回測資料通常涵蓋更久。

import { ref, onUnmounted, watch } from 'vue';
import { formatPercent } from '../utils/format.js';
import { advanceSequence } from '../utils/keySequence.js';

const isOpen = ref(false);
const isLoading = ref(false);
const loadError = ref(null);
const items = ref([]);
const hasLoadedOnce = ref(false);

// 必須照這個順序（上→下→左→右）依序按對，面板才會出現，隨便按方向鍵沒有用。
// 這是刻意設計成不容易誤觸的隱藏功能，不是「按任一個方向鍵」那麼寬鬆。
const REQUIRED_SEQUENCE = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const sequenceProgress = ref(0); // 用 ref 而不是模組層級變數，避免元件被多次掛載時互相污染進度

async function loadHistoryIndex() {
  if (hasLoadedOnce.value) return; // 開過一次之後不重複打 API，除非使用者手動重新整理頁面
  isLoading.value = true;
  loadError.value = null;
  try {
    const res = await fetch('/.netlify/functions/history-index');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    items.value = data.items ?? [];
    hasLoadedOnce.value = true;
  } catch (e) {
    loadError.value = e.message;
  } finally {
    isLoading.value = false;
  }
}

function handleKeydown(e) {
  // 只有方向鍵才處理，其他按鍵完全忽略，不會打斷已經按對的序列進度
  // （例如中途不小心按到 Tab，不應該讓「已經按對上、下」的進度歸零）。
  const isArrowKey = REQUIRED_SEQUENCE.includes(e.key);
  if (!isArrowKey) return;

  // 如果焦點在輸入框/下拉選單裡（包含 FilterPanel.vue 的股價/成交量/漲跌幅滑桿，
  // 那些 <input type="range"> 原生就是用方向鍵調整數值），方向鍵應該保留原本的用途，
  // 不能被這個全域監聽器攔截去累計序列進度，也不能因此打斷使用者原本在做的操作。
  const target = e.target;
  const isEditableTarget = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable;
  if (isEditableTarget) return;

  const { progress, completed } = advanceSequence(e.key, sequenceProgress.value, REQUIRED_SEQUENCE);
  sequenceProgress.value = progress;
  if (completed) {
    isOpen.value = true;
    loadHistoryIndex();
  }
}

function close() {
  isOpen.value = false;
  sequenceProgress.value = 0;
}

// Esc 關閉面板。這是「面板開啟後」才需要的行為，跟「用方向鍵叫出面板」是分開的兩件事
// （見上面的 handleKeydown，那個是全域監聽、任何時候都在聽；這個只在面板開啟時才需要處理），
// 所以用 watch 動態掛載/卸載監聽器，面板關閉時就不佔用事件監聽器。
function handleEscape(e) {
  if (e.key === 'Escape') close();
}
watch(isOpen, (open) => {
  if (open) {
    window.addEventListener('keydown', handleEscape);
  } else {
    window.removeEventListener('keydown', handleEscape);
  }
});
onUnmounted(() => window.removeEventListener('keydown', handleEscape));

defineExpose({ handleKeydown });

const netReturnColorClass = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return 'text-mute';
  return value >= 0 ? 'text-surge' : 'text-ebb';
};
</script>

<template>
  <div v-if="isOpen" class="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-16" @click.self="close">
    <div class="w-full max-w-2xl rounded-md border border-hairline bg-panel-raised shadow-xl">
      <div class="flex items-center justify-between border-b border-hairline px-4 py-3">
        <h2 class="m-0 text-sm font-bold text-paper">歷史資料列表</h2>
        <button type="button" class="rounded-sm px-2 py-1 text-xs text-mute hover:bg-panel" @click="close">關閉（Esc 或點擊外部）</button>
      </div>

      <p class="m-0 border-b border-hairline px-4 py-2 text-[0.72rem] text-mute">
        依序按「上→下→左→右」叫出這個面板；顯示每一天「是否有成功抓到每日行情快照」跟「是否有回測結果」。
      </p>

      <div class="max-h-[60vh] overflow-y-auto">
        <p v-if="isLoading" class="px-4 py-6 text-center font-mono text-sm text-mute">正在讀取歷史資料索引…</p>
        <p v-else-if="loadError" class="px-4 py-6 text-center font-mono text-sm text-ebb">讀取失敗：{{ loadError }}</p>
        <p v-else-if="items.length === 0" class="px-4 py-6 text-center font-mono text-sm text-mute">目前還沒有任何累積資料。</p>

        <table v-else class="w-full border-collapse text-[0.78rem]">
          <thead>
            <tr class="border-b border-hairline text-left text-mute">
              <th class="px-4 py-2 font-normal">日期</th>
              <th class="px-2 py-2 font-normal">每日快照</th>
              <th class="px-2 py-2 font-normal">回測</th>
              <th class="px-2 py-2 font-normal">淨報酬</th>
              <th class="px-4 py-2 font-normal">勝率</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.date" class="border-b border-hairline/50">
              <td class="px-4 py-1.5 font-mono text-paper">{{ item.date }}</td>
              <td class="px-2 py-1.5 text-center">{{ item.hasDailySnapshot ? '✓' : '—' }}</td>
              <td class="px-2 py-1.5 text-center">
                <span v-if="!item.backtest" class="text-mute">—</span>
                <span v-else-if="item.backtest.executedCount === 0" class="text-mute" :title="'選出 ' + item.backtest.selectedCount + ' 檔，成交 0 檔'">無成交</span>
                <span v-else>{{ item.backtest.executedCount }}/{{ item.backtest.selectedCount }} 檔</span>
              </td>
              <td class="px-2 py-1.5 font-mono" :class="item.backtest ? netReturnColorClass(item.backtest.netReturnPercent) : 'text-mute'">
                {{ item.backtest ? formatPercent(item.backtest.netReturnPercent) : '—' }}
              </td>
              <td class="px-4 py-1.5 font-mono text-mute">
                {{ item.backtest ? formatPercent(item.backtest.winRatePercent) : '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
