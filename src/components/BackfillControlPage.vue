<script setup>
// BackfillControlPage.vue — 回填控制頁。列出過去 N 個交易日，標示每一天有沒有回測資料，
// 缺資料的天數提供「回填此日」按鈕，讓使用者可以精準控制要補哪一天，
// 不用像原本那樣猜 endDate/days 參數、或整批盲目往前補。
//
// UI/UX 設計原則：
// 1. 狀態要一眼可辨：已回填（灰階、無動作）／缺資料待處理（強調色、有按鈕）／
//    處理中（disabled + 文字變化，避免使用者以為沒反應而重複點擊）／
//    成功（明確的成功視覺，按鈕消失）／失敗（清楚的錯誤訊息＋可重試按鈕，不是直接消失或吞掉錯誤）
// 2. 每一列的操作互相獨立：點其中一天的回填按鈕，不影響其他列的狀態或可操作性
// 3. 初次載入要有明確的載入中狀態；讀取失敗要有明確的錯誤訊息，不能整頁空白
// 4. 全部都補齊時要有正面回饋（不是只留一個空表格讓使用者自己猜「是不是都做完了」）

import { ref, onMounted, computed } from 'vue';

const emit = defineEmits(['close']);

const isLoading = ref(true);
const loadError = ref(null);
const items = ref([]); // [{ date, hasBacktest }]

// 每一列各自獨立的操作狀態，用 date 當 key，跟 items 本身的初始狀態分開存，
// 這樣「這天原本就有資料」跟「這天剛剛回填成功」可以用同一種視覺呈現，
// 又不會混淆「初始狀態」跟「操作結果」這兩種不同來源的資訊。
const rowState = ref({}); // { [date]: 'idle' | 'loading' | 'success' | 'error' }
const rowError = ref({}); // { [date]: string }

const pendingCount = computed(() => items.value.filter((i) => !i.hasBacktest && rowState.value[i.date] !== 'success').length);

async function loadStatus() {
  isLoading.value = true;
  loadError.value = null;
  try {
    const res = await fetch('/.netlify/functions/backfill-status?days=10');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    items.value = data.items ?? [];
  } catch (e) {
    loadError.value = e.message;
  } finally {
    isLoading.value = false;
  }
}

async function backfillDay(date) {
  rowState.value = { ...rowState.value, [date]: 'loading' };
  rowError.value = { ...rowError.value, [date]: '' };

  try {
    const res = await fetch(`/.netlify/functions/backfill-backtest?signalDate=${date}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    if (data.targetSignalDateSucceeded) {
      rowState.value = { ...rowState.value, [date]: 'success' };
    } else {
      // API 有正常回應，但這一天實際上沒有補成功（常見原因：TWSE 逾時、資料源不穩，
      // 見 data.debugInfo）。這不是網路層級的錯誤，是「試過了但沒成功」，
      // 訊息要跟網路錯誤分開表達，讓使用者知道可以直接重試，不是設定有問題。
      throw new Error(data.message || '這一天沒有成功補到資料，可能是資料源逾時，可以再試一次');
    }
  } catch (e) {
    rowState.value = { ...rowState.value, [date]: 'error' };
    rowError.value = { ...rowError.value, [date]: e.message };
  }
}

onMounted(loadStatus);
</script>

<template>
  <div class="w-full max-w-[720px]">
    <div class="mb-4 flex items-center justify-between">
      <h1 class="m-0 text-base font-bold text-paper">回填控制頁</h1>
      <button type="button" class="rounded-sm border border-hairline px-3 py-1.5 text-xs text-mute hover:bg-panel" @click="emit('close')">
        ← 返回觀察榜
      </button>
    </div>

    <p class="m-0 mb-4 text-[0.78rem] text-mute">
      列出過去 10 個交易日，標示哪幾天已經有回測資料。缺資料的天數可以按「回填此日」單獨補，
      不用像手動操作 API 那樣猜日期參數。
    </p>

    <p v-if="isLoading" class="py-8 text-center font-mono text-sm text-mute">正在讀取回填狀態…</p>

    <p v-else-if="loadError" class="rounded-md border border-ebb/40 bg-ebb/10 px-4 py-3 text-sm text-ebb">
      讀取失敗：{{ loadError }}
      <button type="button" class="ml-2 underline" @click="loadStatus">重試</button>
    </p>

    <template v-else>
      <p v-if="pendingCount === 0" class="rounded-md border border-surge/40 bg-surge/10 px-4 py-3 text-sm text-surge">
        ✓ 過去 10 個交易日的回測資料都已經補齊了。
      </p>

      <ul v-else class="m-0 list-none p-0">
        <li
          v-for="item in items"
          :key="item.date"
          class="flex items-center justify-between border-b border-hairline py-3 last:border-b-0"
        >
          <div class="flex flex-col gap-1">
            <span class="font-mono text-sm text-paper">{{ item.date }}</span>
            <span v-if="rowState[item.date] === 'error'" class="text-[0.72rem] text-ebb">{{ rowError[item.date] }}</span>
          </div>

          <div>
            <!-- 已經有資料（不管是原本就有、還是剛剛回填成功），顯示一致的成功狀態，不再顯示按鈕 -->
            <span v-if="item.hasBacktest || rowState[item.date] === 'success'" class="text-sm text-surge">✓ 已回填</span>

            <button
              v-else-if="rowState[item.date] === 'loading'"
              type="button"
              disabled
              class="cursor-not-allowed rounded-sm border border-hairline px-3 py-1.5 text-xs text-mute"
            >
              回填中…
            </button>

            <button
              v-else
              type="button"
              class="rounded-sm border px-3 py-1.5 text-xs"
              :class="rowState[item.date] === 'error' ? 'border-ebb/40 text-ebb hover:bg-ebb/10' : 'border-gold/40 text-gold hover:bg-gold/10'"
              @click="backfillDay(item.date)"
            >
              {{ rowState[item.date] === 'error' ? '重試' : '回填此日' }}
            </button>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>
