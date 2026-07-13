// netlify/functions/_test-screen.mjs
// 執行方式：npm run test:screen

import { screenWatchlists } from './lib/screen.mjs';

let passed = 0;
let failed = 0;

function check(condition, label, detail = '') {
  if (condition) {
    passed++;
    console.log(`✅ ${label}`);
  } else {
    failed++;
    console.log(`❌ ${label} ${detail}`);
  }
}

// 合成 5 檔股票的今日行情：
// STRONG：大漲、爆量、跳空向上 → 應該是多方觀察榜第一名
// WEAK：大跌、爆量、跳空向下 → 應該是空方觀察榜第一名（score 最低）
// FLAT：平淡無奇的股票
// AVERAGE：中規中矩
// NEWSTOCK：沒有歷史成交量資料（新股），應被排除在評分之外
const todayQuotes = [
  { code: 'STRONG', name: '強勢股', market: 'TWSE', open: 33, high: 34, low: 32, close: 33, volume: 50000, change: 3 }, // prevClose=30, +10%
  { code: 'WEAK', name: '弱勢股', market: 'TWSE', open: 27, high: 28, low: 26, close: 27, volume: 50000, change: -3 }, // prevClose=30, -10%
  { code: 'FLAT', name: '平淡股', market: 'TWSE', open: 30.1, high: 30.2, low: 29.9, close: 30, volume: 10000, change: 0 },
  { code: 'AVERAGE', name: '普通股', market: 'TWSE', open: 31, high: 31.5, low: 30.5, close: 31, volume: 15000, change: 1 },
  { code: 'NEWSTOCK', name: '新股', market: 'TWSE', open: 20, high: 21, low: 19, close: 20, volume: 30000, change: 2 },
];

const volumeHistory = new Map([
  ['STRONG', [10000, 10000, 10000, 10000, 10000]], // 均量 1 萬，今日 5 萬 → 5 倍量能異常
  ['WEAK', [10000, 10000, 10000, 10000, 10000]],
  ['FLAT', [10000, 10000, 10000, 10000, 10000]],
  ['AVERAGE', [10000, 10000, 10000, 10000, 10000]],
  // NEWSTOCK 故意不放歷史資料，模擬新股情境
]);

// 法人買賣超資料：STRONG 有法人大買、WEAK 有法人大賣，FLAT 故意不給資料（模擬「這個資料源沒涵蓋到」的情境，
// 例如上櫃股票目前沒有法人資料），驗證缺資料時會預設成中性 0，而不是讓程式壞掉。
const institutionalNetBuy = new Map([
  ['STRONG', 20000], // 買超 2 萬股，佔成交量 5 萬股的 40%
  ['WEAK', -20000], // 賣超 2 萬股
  ['AVERAGE', 1000],
  // FLAT 故意不給資料
]);

const result = screenWatchlists(todayQuotes, volumeHistory, institutionalNetBuy, { topN: 3 });

check(result.excludedNoHistory === 1, '無歷史資料的新股應被排除（excludedNoHistory = 1）', `實際: ${result.excludedNoHistory}`);
check(result.totalCandidates === 4, '扣除新股後應剩 4 檔候選股', `實際: ${result.totalCandidates}`);
check(result.longWatchlist.length === 3, 'topN=3 時多方觀察榜應只有 3 檔', `實際: ${result.longWatchlist.length}`);
check(result.shortWatchlist.length === 3, 'topN=3 時空方觀察榜應只有 3 檔', `實際: ${result.shortWatchlist.length}`);
check(result.longWatchlist[0].code === 'STRONG', '多方觀察榜第一名應是 STRONG（大漲+爆量+跳空向上）', `實際: ${result.longWatchlist[0].code}`);
check(result.shortWatchlist[0].code === 'WEAK', '空方觀察榜第一名應是 WEAK（大跌+爆量+跳空向下）', `實際: ${result.shortWatchlist[0].code}`);
check(
  result.longWatchlist.every((c) => !['NEWSTOCK'].includes(c.code)),
  '多方觀察榜不應包含被排除的新股'
);
check(typeof result.marketChangePercent === 'number', '應回傳一個數字型態的大盤漲跌幅近似值');

// 缺法人資料的股票（FLAT）應該正常運作，不會壞掉，且 institutionalRatio 預設為 0（中性）
const flatInLong = result.longWatchlist.find((c) => c.code === 'FLAT') || result.shortWatchlist.find((c) => c.code === 'FLAT');
check(
  flatInLong === undefined || flatInLong.institutionalContribution !== undefined,
  '缺法人資料的股票仍應正常算出 institutionalContribution（預設中性 0），不會讓程式壞掉'
);
check(
  result.longWatchlist.every((c) => typeof c.institutionalContribution === 'number'),
  '多方觀察榜每一筆都應該有 institutionalContribution 欄位'
);

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
