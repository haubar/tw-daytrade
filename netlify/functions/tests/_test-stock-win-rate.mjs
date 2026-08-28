// netlify/functions/tests/_test-stock-win-rate.mjs
// 執行方式：node netlify/functions/tests/_test-stock-win-rate.mjs

import { buildStockStats, rankStocksByWinRate } from '../lib/stock-win-rate.mjs';

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

// ---- buildStockStats ----

// 2330 出現三天：多方基準策略兩天贏、一天輸；多方高級策略只在其中一天真的進場（有 adv.trades）且贏。
// 2330 空方基準策略只出現一天且輸（跟多方同一天，同一支股票，多空同時被回測是正常情況）；
// 空方高級策略完全沒有交易紀錄（模擬「一直沒跌破觸發價，從未真的放空進場」的情況）。
// 2317 只出現一天，多方基準策略輸，沒有任何空方資料（模擬升級前的舊回測結果，result.short 是 undefined）。
const results = [
  {
    signalDate: '2026-08-18',
    executionDate: '2026-08-19',
    trades: [
      { code: '2330', name: '台積電', netReturnPercent: 1.5 },
      { code: '2317', name: '鴻海', netReturnPercent: -0.8 },
    ],
    adv: {
      trades: [{ code: '2330', name: '台積電', netReturnPercent: 2.1 }],
    },
    short: {
      trades: [{ code: '2330', name: '台積電', netReturnPercent: -1.5 }], // 多方贏的那天，空方對應虧錢，符合鏡像邏輯
      adv: { trades: [] }, // 空方高級策略這天沒跌破觸發價，沒有任何交易
    },
  },
  {
    signalDate: '2026-08-19',
    executionDate: '2026-08-20',
    trades: [{ code: '2330', name: '台積電', netReturnPercent: 0.9 }],
    adv: { trades: [] }, // 這天多方高級策略沒突破觸發價，沒有任何交易
    // 這天沒有 short 欄位，模擬升級前寫入的舊回測結果混在新資料裡
  },
  {
    signalDate: '2026-08-20',
    executionDate: '2026-08-21',
    trades: [{ code: '2330', name: '台積電', netReturnPercent: -0.3 }],
  },
  null, // 某天回測結果讀取失敗（例如 Blobs 暫時掛掉），應該被安全忽略
];

const stats = buildStockStats(results);

assertEqual(stats.size, 2, '應該彙總出兩支不重複的股票（2330、2317）');
assertEqual(stats.get('2330').name, '台積電', '應該從交易明細帶出股票名稱');
assertEqual(stats.get('2330').base, { trades: 3, wins: 2, sumNetReturn: 1.5 + 0.9 - 0.3 }, '2330 多方基準策略應該累積三筆交易、兩勝一敗');
assertEqual(stats.get('2330').adv, { trades: 1, wins: 1, sumNetReturn: 2.1 }, '2330 多方高級策略應該只累積「真的有進場」的那 1 筆交易，沒進場的天數不算');
assertEqual(stats.get('2330').shortBase, { trades: 1, wins: 0, sumNetReturn: -1.5 }, '2330 空方基準策略應該只累積「有 short 欄位」的那一天，升級前的舊資料那天要被安全跳過');
assertEqual(stats.get('2330').shortAdv, { trades: 0, wins: 0, sumNetReturn: 0 }, '2330 空方高級策略完全沒有實際交易，應該是空統計而不是缺欄位');
assertEqual(stats.get('2330').lastSeenDate, '2026-08-21', '應該取最新一次出現的執行日');
assertEqual(stats.get('2317').base, { trades: 1, wins: 0, sumNetReturn: -0.8 }, '2317 只出現一次且是輸的交易');
assertEqual(stats.get('2317').adv, { trades: 0, wins: 0, sumNetReturn: 0 }, '2317 從未在高級策略裡進場過，應該是空統計而不是缺欄位');
assertEqual(stats.get('2317').shortBase, { trades: 0, wins: 0, sumNetReturn: 0 }, '2317 完全沒有空方資料（result.short 是 undefined），應該安全回傳空統計');

assertEqual(buildStockStats([]).size, 0, '空陣列應該回傳空 Map');
assertEqual(buildStockStats(null).size, 0, '傳入 null 應該安全回傳空 Map，不拋出例外');
assertEqual(buildStockStats([{ trades: [{ code: 'X', netReturnPercent: NaN }] }]).size, 0, '非有限數字的 netReturnPercent（NaN／缺值）應該被跳過，不污染統計');

// ---- rankStocksByWinRate ----

// 三支股票：A 勝率 100%（樣本 2），B 勝率 100%（樣本 1，樣本太小），C 勝率 66.7%（樣本 3，平均報酬較低）
const rankStatsMap = new Map([
  ['A', { code: 'A', name: 'A公司', lastSeenDate: '2026-08-20', base: { trades: 2, wins: 2, sumNetReturn: 4.0 }, adv: { trades: 0, wins: 0, sumNetReturn: 0 }, shortBase: { trades: 0, wins: 0, sumNetReturn: 0 }, shortAdv: { trades: 0, wins: 0, sumNetReturn: 0 } }],
  ['B', { code: 'B', name: 'B公司', lastSeenDate: '2026-08-19', base: { trades: 1, wins: 1, sumNetReturn: 5.0 }, adv: { trades: 0, wins: 0, sumNetReturn: 0 }, shortBase: { trades: 4, wins: 3, sumNetReturn: 6.0 }, shortAdv: { trades: 0, wins: 0, sumNetReturn: 0 } }],
  ['C', { code: 'C', name: 'C公司', lastSeenDate: '2026-08-21', base: { trades: 3, wins: 2, sumNetReturn: 1.5 }, adv: { trades: 0, wins: 0, sumNetReturn: 0 }, shortBase: { trades: 0, wins: 0, sumNetReturn: 0 }, shortAdv: { trades: 0, wins: 0, sumNetReturn: 0 } }],
]);

const ranked = rankStocksByWinRate(rankStatsMap, { strategy: 'base', minTrades: 2 });
assertEqual(ranked.length, 2, 'minTrades=2 應該濾掉 B（只有 1 筆樣本），只剩 A、C');
assertEqual(ranked[0].code, 'A', '併總勝率 100% 且樣本數 2 的 A 應該排第一');
assertEqual(ranked[0].winRatePercent, 100, 'A 的勝率應該是 100%');
assertEqual(ranked[0].avgNetReturnPercent, 2.0, 'A 的平均報酬應該是 sumNetReturn ÷ trades = 4.0 ÷ 2');
assertEqual(ranked[1].code, 'C', 'C 勝率較低（66.7%）應該排在 A 後面');

const rankedNoFilter = rankStocksByWinRate(rankStatsMap, { strategy: 'base', minTrades: 1 });
assertEqual(rankedNoFilter.length, 3, 'minTrades=1 時三支股票都應該入榜');
assertEqual(rankedNoFilter[0].code, 'A', '勝率同為 100% 時，樣本數較多的 A（2筆）應該排在樣本數較少的 B（1筆）前面');
assertEqual(rankedNoFilter[1].code, 'B', 'B 樣本數雖少但勝率仍是 100%，排在 A 後面、C 前面');

assertEqual(rankStocksByWinRate(rankStatsMap, { strategy: 'base', minTrades: 1, limit: 1 }).length, 1, 'limit 應該正確截斷回傳筆數');
assertEqual(rankStocksByWinRate(new Map(), { strategy: 'base' }), [], '空 Map 應該回傳空陣列，不拋出例外');
assertEqual(
  rankStocksByWinRate(rankStatsMap, { strategy: 'adv', minTrades: 1 }),
  [],
  '指定 adv 策略但這批股票在 adv 都沒有任何交易時，應該全部被 minTrades 濾掉，回傳空陣列'
);

// ---- rankStocksByWinRate：空方策略（strategy: 'shortBase'/'shortAdv'）----
const shortRanked = rankStocksByWinRate(rankStatsMap, { strategy: 'shortBase', minTrades: 1 });
assertEqual(shortRanked.length, 1, '指定 shortBase 時，只有 B 有空方交易紀錄，A、C 應該被 minTrades 濾掉');
assertEqual(shortRanked[0].code, 'B', '空方基準排行應該只看 shortBase 這個桶，不是多方的 base');
assertEqual(shortRanked[0].winRatePercent, 75, 'B 的空方基準勝率應該是 3/4=75%，不是多方的 100%');
assertEqual(
  rankStocksByWinRate(rankStatsMap, { strategy: 'shortAdv', minTrades: 1 }),
  [],
  '三支股票的空方高級策略都完全沒有交易，指定 shortAdv 應該回傳空陣列'
);

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
