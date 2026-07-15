// src/utils/_test-filterWatchlist.js
// 執行方式：npm run test:filter-watchlist

import { filterWatchlist, getPriceBand, isFilterActive } from './filterWatchlist.js';

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

const items = [
  { code: 'A', close: 50, volume: 1000000, changePercent: 8.5 },
  { code: 'B', close: 500, volume: 200000, changePercent: 2.0 },
  { code: 'C', close: 15, volume: 5000000, changePercent: -6.2 },
  { code: 'D', close: 1200, volume: 800000, changePercent: 9.9 },
];

// ---- 沒有任何篩選條件時，應該回傳全部 ----
assertEqual(filterWatchlist(items, {}).map((i) => i.code), ['A', 'B', 'C'], '沒有篩選條件時仍應固定排除千金股');
assertEqual(filterWatchlist(items, { minPrice: null, maxPrice: null, minVolume: null, minGainPercent: null }).map((i) => i.code), ['A', 'B', 'C'], '篩選條件全部是 null 時仍應固定排除千金股');

// ---- 股價範圍 ----
assertEqual(
  filterWatchlist(items, { minPrice: 100 }).map((i) => i.code),
  ['B'],
  '最低股價 100：應該只剩股價 >= 100 且非千金股的（B）'
);
assertEqual(
  filterWatchlist(items, { maxPrice: 100 }).map((i) => i.code),
  ['A', 'C'],
  '最高股價 100：應該只剩股價 <= 100 的（A, C）'
);
assertEqual(
  filterWatchlist(items, { minPrice: 20, maxPrice: 600 }).map((i) => i.code),
  ['A', 'B'],
  '股價區間 20~600：應該只剩 A, B'
);

// ---- 成交量 ----
assertEqual(
  filterWatchlist(items, { minVolume: 1000000 }).map((i) => i.code),
  ['A', 'C'],
  '最小成交量 100 萬股：應該只剩 A, C'
);

// ---- 漲跌幅度（取絕對值，多空共用）----
assertEqual(
  filterWatchlist(items, { minGainPercent: 8 }).map((i) => i.code),
  ['A'],
  '最小漲跌幅度 8%：A 符合；D 雖符合幅度但為千金股，固定排除'
);
assertEqual(
  filterWatchlist(items, { minGainPercent: 6 }).map((i) => i.code),
  ['A', 'C'],
  '最小漲跌幅度 6%：C 是跌 6.2%，取絕對值後符合；千金股 D 固定排除'
);

// ---- 多條件同時套用 ----
assertEqual(
  filterWatchlist(items, { minPrice: 10, maxPrice: 600, minVolume: 500000, minGainPercent: 5 }).map((i) => i.code),
  ['A', 'C'],
  '多條件同時套用：A、C 都同時符合股價區間、成交量、漲跌幅度三個條件（B股價超出範圍、D成交量門檻雖過但股價超出範圍）'
);

// ---- isFilterActive ----
assertEqual(isFilterActive({}), false, 'isFilterActive：空物件應該回傳 false');
assertEqual(isFilterActive({ minPrice: null, maxPrice: null, minVolume: null, minGainPercent: null }), false, 'isFilterActive：全部是 null 應該回傳 false');
assertEqual(isFilterActive({ minPrice: 10 }), true, 'isFilterActive：有設定任一條件應該回傳 true');
assertEqual(isFilterActive(null), false, 'isFilterActive：傳入 null 不應該拋出例外，應該回傳 false');

// ---- 價格帶操作參考 ----
assertEqual(getPriceBand(445.5), { min: 370, max: 500, skipCount: 3 }, '445.5 元應套用 370~500 元、略過 3 檔');
assertEqual(getPriceBand(74.5), { min: 50, max: 74, skipCount: 2 }, '74.5 元應按正常跳動價格歸入 50~74 元價格帶');
assertEqual(getPriceBand(3.6), { min: 0, max: 3.6, skipCount: 1 }, '3.6 元應套用最低價格帶、略過 1 檔');
assertEqual(getPriceBand(512), null, '500~999 元未提供略過規則，不應臆測套用');
assertEqual(getPriceBand(1200), null, '千金股沒有價格帶，且會在篩選時排除');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
