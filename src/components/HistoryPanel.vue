<script setup>
// HistoryPanel.vue — 隱藏的「歷史資料列表」面板。使用者按任一方向鍵（↑↓←→）才會叫出來，
// 平常不會出現在畫面上，避免干擾一般使用流程；主要給比較想了解資料累積現況的使用者，
// 或開發除錯時用。
//
// 顯示內容：合併「哪幾天有成功抓到每日行情快照」（volume-archive，只留最近15天）跟
// 「哪幾天有回測結果」（backtest-storage，留最近260天）——見後端 history-index.mjs 的說明，
// 這兩份資料保留天數不同，回測資料通常涵蓋更久。

import { ref, onUnmounted, watch } from 'vue';
import { formatPercent } from '../utils/format.js';

const isOpen = ref(false);
const isLoading = ref(false);
const loadError = ref(null);
const items = ref([]);
const hasLoadedOnce = ref(false);

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
  // 只有方向鍵才觸發，其他按鍵（例如使用者正在輸入文字時按到方向鍵切換游標）不受影響；
  // 如果焦點在輸入框/下拉選單裡，方向鍵應該保留原本的用途（移動游標、切選項），
  // 不應該被這個全域監聽器攔截去開歷史面板。
  const isArrowKey = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key);
  if (!isArrowKey) return;
  const target = e.target;
  const isEditableTarget = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable;
  if (isEditableTarget) return;

  isOpen.value = true;
  loadHistoryIndex();
}

function close() {
  isOpen.value = false;
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
        方向鍵（↑↓←→）叫出這個面板；顯示每一天「是否有成功抓到每日行情快照」跟「是否有回測結果」。
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
