// netlify/functions/tests/_test-history-index.mjs
// 執行方式：node netlify/functions/tests/_test-history-index.mjs

import { mergeDateLists, summarizeBacktest, buildHistoryItems, buildBackfillStatusItems, computeRollingStats } from '../lib/history-index.mjs';

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
    trades: [
      { code: 'A', netReturnPercent: 1.5 },
      { code: 'B', netReturnPercent: -0.5 },
    ], // 完整明細不應該出現在摘要裡，但 wonCount 要從這裡精確算出來
    adv: {
      executedCount: 3,
      selectedCount: 10,
      netReturnPercent: 2.4,
      winRatePercent: 100,
      trades: [
        { code: 'A', netReturnPercent: 2.0 },
        { code: 'C', netReturnPercent: 3.1 },
        { code: 'D', netReturnPercent: 2.1 },
      ],
    },
  }),
  {
    executionDate: '2026-08-19',
    executedCount: 8,
    selectedCount: 10,
    wonCount: 1,
    netReturnPercent: 1.23,
    winRatePercent: 62.5,
    adv: { executedCount: 3, selectedCount: 10, wonCount: 3, netReturnPercent: 2.4, winRatePercent: 100 },
  },
  '應該只挑出摘要欄位（含 adv），trades 等明細不應該出現在摘要裡，wonCount 要從 trades 精確算出'
);
assertEqual(
  summarizeBacktest({ signalDate: '2026-08-18' }),
  { executionDate: null, executedCount: 0, selectedCount: 0, wonCount: 0, netReturnPercent: null, winRatePercent: null, adv: null },
  '缺少的欄位應該有合理的預設值，不是 undefined；沒有 adv 資料時應該是 null'
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

// ---- computeRollingStats ----
// 三天資料：第一天基準 5/10 進場、4 勝；第二天基準 10/10 進場、5 勝；第三天沒有回測資料
// （backtest: null，例如當天資料源掛掉）。高級策略：第一天 2/10 進場都贏，第二天 0/10（都沒突破）。
const rollingItems = [
  {
    date: '2026-08-20',
    backtest: {
      executedCount: 5, selectedCount: 10, wonCount: 4, netReturnPercent: 2.0, winRatePercent: 80,
      adv: { executedCount: 2, selectedCount: 10, wonCount: 2, netReturnPercent: 3.0, winRatePercent: 100 },
    },
  },
  {
    date: '2026-08-19',
    backtest: {
      executedCount: 10, selectedCount: 10, wonCount: 5, netReturnPercent: -1.0, winRatePercent: 50,
      adv: { executedCount: 0, selectedCount: 10, wonCount: 0, netReturnPercent: null, winRatePercent: null },
    },
  },
  { date: '2026-08-18', backtest: null },
];

const rolling = computeRollingStats(rollingItems, [2, 20]);

assertEqual(rolling.base.window2.tradingDays, 2, 'window2 應該只取「有回測資料」的天數，08-18 那天 backtest 是 null 要被排除');
assertEqual(rolling.base.window2.daysWithTrades, 2, '兩天都有實際進場（executedCount > 0）');
assertEqual(rolling.base.window2.pooledWinRatePercent, ((4 + 5) / (5 + 10)) * 100, '併總勝率應該是「總勝場 ÷ 總進場場次」，不是兩天百分比的平均（(80+50)/2=65 是錯的）');
assertEqual(rolling.base.window2.executionCoveragePercent, ((5 + 10) / (10 + 10)) * 100, '進場覆蓋率應該是「總進場 ÷ 總選出」');
assertEqual(
  rolling.base.window2.compoundNetReturnPercent,
  ((1 + 2.0 / 100) * (1 - 1.0 / 100) - 1) * 100,
  '淨利應該用複利串接兩天的單日報酬率，不是直接相加'
);

assertEqual(rolling.adv.window2.daysWithTrades, 1, '高級策略第二天 executedCount 是 0（沒突破觸發價），不算「有進場的一天」');
assertEqual(rolling.adv.window2.pooledWinRatePercent, 100, '高級策略併總勝率應該只用有進場那 2 筆交易算，忽略沒進場的天');
assertEqual(rolling.adv.window2.executionCoveragePercent, (2 / 20) * 100, '高級策略進場覆蓋率很低（20 檔裡只有 2 檔真的進場），這正是勝率容易失真的地方');

assertEqual(rolling.base.window20.tradingDays, 2, 'window 大於實際可用天數時，應該用全部可用天數，不會因為不足 20 天就出錯');
assertEqual(computeRollingStats([]).base.window5, { tradingDays: 0, daysWithTrades: 0, executionCoveragePercent: null, pooledWinRatePercent: null, compoundNetReturnPercent: null }, '完全沒有資料時，每個欄位都應該是安全的 0 或 null，不拋出例外');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
