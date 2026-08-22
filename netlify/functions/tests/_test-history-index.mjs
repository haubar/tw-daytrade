// netlify/functions/tests/_test-history-index.mjs
// 執行方式：node netlify/functions/tests/_test-history-index.mjs

import { mergeDateLists, summarizeBacktest, buildHistoryItems, buildBackfillStatusItems } from '../lib/history-index.mjs';

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`✅ ${label}`);
  } else {
    failed++;
    console.log(`❌ ${label}`);
    console.log('   期望:', JSON.stringify(expected));
    console.log('   實際:', JSON.stringify(actual));
  }
}

// ---- mergeDateLists ----
assertEqual(
  mergeDateLists(['2026-08-19', '2026-08-18'], ['2026-08-18', '2026-08-10']),
  ['2026-08-19', '2026-08-18', '2026-08-10'],
  '應該合併兩份清單、去重、新到舊排序'
);
assertEqual(
  mergeDateLists([], ['2026-08-10']),
  ['2026-08-10'],
  '其中一份是空陣列時，應該直接用另一份'
);
assertEqual(mergeDateLists([], []), [], '兩份都是空陣列時應該回傳空陣列');
assertEqual(mergeDateLists(null, undefined), [], '傳入 null/undefined 應該安全回傳空陣列，不拋出例外');
assertEqual(
  mergeDateLists(['2026-08-10'], ['2026-08-19', '2026-08-15', '2026-08-01']),
  ['2026-08-19', '2026-08-15', '2026-08-10', '2026-08-01'],
  '回測資料範圍比每日快照更廣時（實際情況：backtest-storage 留 260 天，volume-archive 只留15天），應該完整涵蓋聯集'
);

// ---- summarizeBacktest ----
assertEqual(summarizeBacktest(null), null, '沒有回測結果時應該回傳 null');
assertEqual(
  summarizeBacktest({
    signalDate: '2026-08-18',
    executionDate: '2026-08-19',
    executedCount: 8,
    selectedCount: 10,
    netReturnPercent: 1.23,
    winRatePercent: 62.5,
    trades: [{ code: 'A' }, { code: 'B' }], // 完整明細不應該出現在摘要裡
  }),
  { executionDate: '2026-08-19', executedCount: 8, selectedCount: 10, netReturnPercent: 1.23, winRatePercent: 62.5 },
  '應該只挑出摘要欄位，trades 等明細不應該出現在摘要裡（列表可能有上百筆，減少不必要的資料量）'
);
assertEqual(
  summarizeBacktest({ signalDate: '2026-08-18' }),
  { executionDate: null, executedCount: 0, selectedCount: 0, netReturnPercent: null, winRatePercent: null },
  '缺少的欄位應該有合理的預設值，不是 undefined'
);

// ---- buildHistoryItems ----
const items = buildHistoryItems(
  ['2026-08-19', '2026-08-18', '2026-08-10'],
  ['2026-08-19', '2026-08-18'], // 只有這兩天有每日快照
  new Map([
    ['2026-08-19', { executedCount: 5, netReturnPercent: 1.1 }],
    ['2026-08-10', { executedCount: 0, netReturnPercent: null }],
  ])
);
assertEqual(items.length, 3, '應該產生跟輸入日期數量一致的項目');
assertEqual(items[0], { date: '2026-08-19', hasDailySnapshot: true, backtest: { executedCount: 5, netReturnPercent: 1.1 } }, '有每日快照又有回測結果的日期，兩個欄位都應該正確帶出');
assertEqual(items[1], { date: '2026-08-18', hasDailySnapshot: true, backtest: null }, '有每日快照但沒有回測結果的日期，backtest 應該是 null');
assertEqual(items[2], { date: '2026-08-10', hasDailySnapshot: false, backtest: { executedCount: 0, netReturnPercent: null } }, '沒有每日快照（可能已經被15天上限淘汰）但仍有回測結果的日期，應該正確標示 hasDailySnapshot=false');

// ---- buildBackfillStatusItems：給回填控制頁用 ----
const statusItems = buildBackfillStatusItems(
  ['2026-08-19', '2026-08-18', '2026-08-17'],
  ['2026-08-19', '2026-08-17'] // 08-18 缺回測資料
);
assertEqual(
  statusItems,
  [
    { date: '2026-08-19', hasBacktest: true },
    { date: '2026-08-18', hasBacktest: false },
    { date: '2026-08-17', hasBacktest: true },
  ],
  '應該正確標示每一天有沒有回測資料，順序跟著 tradingDayDates 走（不重新排序）'
);
assertEqual(buildBackfillStatusItems([], ['2026-08-19']), [], 'tradingDayDates 是空陣列時應該回傳空陣列');
assertEqual(
  buildBackfillStatusItems(['2026-08-19'], []),
  [{ date: '2026-08-19', hasBacktest: false }],
  'backtestDates 是空陣列時，全部應該標示為沒有回測資料'
);
assertEqual(buildBackfillStatusItems(null, null), [], '傳入 null 應該安全回傳空陣列，不拋出例外');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
