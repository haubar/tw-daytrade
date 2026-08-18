// src/utils/_test-filterWatchlist.js
// 執行方式：npm run test:filter-watchlist

import { filterWatchlist, getPriceBand, getPriceMoveForTicks, isFilterActive, isPriceLimitLocked, DEFAULT_MIN_VOLUME_LOTS } from './filterWatchlist.js';

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

// ---- 漲停/跌停鎖死股票：固定排除，不受「清除篩選」影響 ----
assertEqual(isPriceLimitLocked(9.9), true, '9.9% 應判定為鎖漲停');
assertEqual(isPriceLimitLocked(-9.9), true, '-9.9% 應判定為鎖跌停');
assertEqual(isPriceLimitLocked(9.5), true, '剛好 9.5%（門檻值）應判定為鎖死');
assertEqual(isPriceLimitLocked(9.4), false, '9.4% 尚未到門檻，不應判定為鎖死');
assertEqual(isPriceLimitLocked(8.5), false, '8.5% 只是強勢，不算鎖死');
const limitLockedItems = [
  { code: 'E', close: 50, volume: 1000000, changePercent: 9.87 }, // 鎖漲停
  { code: 'F', close: 30, volume: 800000, changePercent: -9.91 }, // 鎖跌停
  { code: 'G', close: 60, volume: 500000, changePercent: 9.2 }, // 強勢但未鎖死
];
assertEqual(
  filterWatchlist(limitLockedItems, {}).map((i) => i.code),
  ['G'],
  '鎖漲停(E)、鎖跌停(F) 應固定被排除，即使沒有設定任何篩選條件；未鎖死的強勢股(G)應保留'
);

// ---- 最低流動性門檻（App.vue 預設帶入 DEFAULT_MIN_VOLUME_LOTS，這裡驗證常數本身跟 filterWatchlist 的搭配行為）----
assertEqual(DEFAULT_MIN_VOLUME_LOTS, 100, 'DEFAULT_MIN_VOLUME_LOTS 預設應為 100 張');
const liquidityItems = [
  { code: 'H', close: 50, volume: 150000, changePercent: 2 }, // 150 張，符合 100 張門檻
  { code: 'I', close: 50, volume: 50000, changePercent: 2 }, // 50 張，低於 100 張門檻
];
assertEqual(
  filterWatchlist(liquidityItems, { minVolume: DEFAULT_MIN_VOLUME_LOTS * 1000 }).map((i) => i.code),
  ['H'],
  '套用預設最低流動性門檻（100張）時，成交量不足的股票(I)應被過濾掉'
);

// ---- 價格帶操作參考 ----
assertEqual(getPriceBand(445.5), { min: 370, max: 500, profitTicks: 3 }, '445.5 元應套用 370~500 元、獲利參考 3 檔');
assertEqual(getPriceBand(74.5), { min: 50, max: 74, profitTicks: 2 }, '74.5 元應按正常跳動價格歸入 50~74 元價格帶');
assertEqual(getPriceBand(3.6), { min: 0, max: 3.6, profitTicks: 1 }, '3.6 元應套用最低價格帶、獲利參考 1 檔');
assertEqual(getPriceBand(512), { min: 500, max: 999, profitTicks: null }, '500~999 元應有獨立的篩選選項，但不臆測獲利跳檔數');
assertEqual(getPriceBand(1200), null, '千金股沒有價格帶，且會在篩選時排除');
assertEqual(getPriceMoveForTicks(445.5, 3), 1.5, '445.5 元往上 3 檔，價差應為 1.5 元');
assertEqual(getPriceMoveForTicks(499.5, 3), 2.5, '跨過 500 元後，應依新的 1 元檔距計算價差');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
