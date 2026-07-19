// netlify/functions/_test-screen.mjs
// 執行方式：npm run test:screen

import { screenWatchlists, getTpexCandidateCodes } from '../lib/screen.mjs';

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

// ---- marketChangePercent 覆蓋功能（真實 TAIEX 指數）----
// 沒有傳 marketChangePercent 時，應該用估計值（前面的測試已經驗證過是個數字）；
// 有明確傳入時，應該直接採用那個值，不會再去算估計值。
const resultWithRealTaiex = screenWatchlists(todayQuotes, volumeHistory, institutionalNetBuy, {
  topN: 3,
  marketChangePercent: -0.58,
});
check(
  resultWithRealTaiex.marketChangePercent === -0.58,
  '有提供 marketChangePercent 時，應該直接採用該值，不使用估計值',
  `實際: ${resultWithRealTaiex.marketChangePercent}`
);

// 傳入真實大盤值後，STRONG 相對大盤是 10% - (-0.58%) = 10.58%，比原本用估計值時的相對強弱更大，
// 用這個驗證「真的有拿去算相對強弱因子」，不是傳進去就沒作用的參數。
const strongInDefault = result.longWatchlist.find((c) => c.code === 'STRONG');
const strongInRealTaiex = resultWithRealTaiex.longWatchlist.find((c) => c.code === 'STRONG');
check(
  strongInRealTaiex.relativeStrength !== strongInDefault.relativeStrength,
  '傳入不同的 marketChangePercent，應該要讓 relativeStrength 因子的計算結果跟著變化（確認真的有被使用，不是參數傳假的）'
);

// ---- getTpexCandidateCodes：兩階段流程第一步，抽出上櫃候選代碼 ----
// 混合上市（TWSE）跟上櫃（TPEx）股票，驗證只有上櫃、且進了觀察榜（topN 範圍內）的代碼會被抽出
const mixedMarketQuotes = [
  { code: 'TWSE_STRONG', name: '上市強勢股', market: 'TWSE', open: 33, high: 34, low: 32, close: 33, volume: 50000, change: 3 },
  { code: 'TPEX_STRONG', name: '上櫃強勢股', market: 'TPEx', open: 33, high: 34, low: 32, close: 33, volume: 50000, change: 3 },
  { code: 'TPEX_WEAK', name: '上櫃弱勢股', market: 'TPEx', open: 27, high: 28, low: 26, close: 27, volume: 50000, change: -3 },
  { code: 'TPEX_FLAT', name: '上櫃平淡股（不該進榜）', market: 'TPEx', open: 30.1, high: 30.2, low: 29.9, close: 30, volume: 10000, change: 0 },
];
const mixedVolumeHistory = new Map([
  ['TWSE_STRONG', [10000, 10000, 10000, 10000, 10000]],
  ['TPEX_STRONG', [10000, 10000, 10000, 10000, 10000]],
  ['TPEX_WEAK', [10000, 10000, 10000, 10000, 10000]],
  ['TPEX_FLAT', [10000, 10000, 10000, 10000, 10000]],
]);
// topN=1：多方觀察榜只會取第一名（TWSE_STRONG 或 TPEX_STRONG，兩者條件相同，排序穩定性由既有邏輯決定），
// 空方觀察榜第一名應是 TPEX_WEAK（唯一有下跌的）；TPEX_FLAT 平淡無奇，topN=1 時應該進不了榜
const firstPassResult = screenWatchlists(mixedMarketQuotes, mixedVolumeHistory, new Map(), { topN: 1 });
const tpexCandidates = getTpexCandidateCodes(firstPassResult);

check(
  tpexCandidates.includes('TPEX_WEAK'),
  'getTpexCandidateCodes：空方觀察榜裡的上櫃股票（TPEX_WEAK）應該被抽出來',
  `實際: ${JSON.stringify(tpexCandidates)}`
);
check(
  !tpexCandidates.includes('TPEX_FLAT'),
  'getTpexCandidateCodes：topN 範圍外（沒進觀察榜）的上櫃股票不應該被抽出來',
  `實際: ${JSON.stringify(tpexCandidates)}`
);
check(
  tpexCandidates.every((code) => code.startsWith('TPEX_')),
  'getTpexCandidateCodes：不應該抽出任何上市（TWSE）股票的代碼',
  `實際: ${JSON.stringify(tpexCandidates)}`
);

// 邊界情況：空觀察榜、或缺少欄位時應安全回傳空陣列，不拋出例外
check(
  JSON.stringify(getTpexCandidateCodes({ longWatchlist: [], shortWatchlist: [] })) === '[]',
  'getTpexCandidateCodes：空觀察榜應回傳空陣列'
);
check(
  JSON.stringify(getTpexCandidateCodes({})) === '[]',
  'getTpexCandidateCodes：缺少 longWatchlist/shortWatchlist 欄位時應安全回傳空陣列，不拋出例外'
);
check(
  JSON.stringify(getTpexCandidateCodes(undefined)) === '[]',
  'getTpexCandidateCodes：傳入 undefined 時應安全回傳空陣列，不拋出例外'
);

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
