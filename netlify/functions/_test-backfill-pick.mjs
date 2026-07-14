// netlify/functions/_test-backfill-pick.mjs
// 執行方式：npm run test:backfill-pick

import { pickNewTradingDays } from './backfill-history.mjs';

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

// ---- 案例 1：全部都是新的交易日，應該挑最前面 3 天 ----
const allNew = [
  { actualDate: '2026-07-07', quotes: [{ code: '1101', volume: 100 }] },
  { actualDate: '2026-07-06', quotes: [{ code: '1101', volume: 200 }] },
  { actualDate: '2026-07-03', quotes: [{ code: '1101', volume: 300 }] },
  { actualDate: '2026-07-02', quotes: [{ code: '1101', volume: 400 }] },
];
const result1 = pickNewTradingDays(allNew, [], 3);
assertEqual(
  result1.map((d) => d.date),
  ['2026-07-07', '2026-07-06', '2026-07-03'],
  '全部都是新交易日時，應該挑最前面（最近）的 3 天'
);

// ---- 案例 2：已存在的日期要跳過，自動往前找 ----
const result2 = pickNewTradingDays(allNew, ['2026-07-07', '2026-07-06'], 3);
assertEqual(
  result2.map((d) => d.date),
  ['2026-07-03', '2026-07-02'],
  '已存在的日期應該跳過，往前找新的（這個案例候選只夠湊到 2 天，不夠 3 天也應該照樣回傳）'
);

// ---- 案例 3：抓取失敗（result 是 null）或無法辨識日期（actualDate 是 null）的候選應該跳過 ----
const withFailures = [
  { actualDate: '2026-07-07', quotes: [{ code: '1101', volume: 100 }] },
  null, // 這個候選日期整個請求失敗
  { actualDate: null, quotes: [] }, // 這個候選日期抓到了，但無法辨識實際日期
  { actualDate: '2026-07-03', quotes: [{ code: '1101', volume: 300 }] },
  { actualDate: '2026-07-02', quotes: [{ code: '1101', volume: 400 }] },
];
const result3 = pickNewTradingDays(withFailures, [], 3);
assertEqual(
  result3.map((d) => d.date),
  ['2026-07-07', '2026-07-03', '2026-07-02'],
  '抓取失敗或日期無法辨識的候選應該跳過，不影響後面的天數蒐集'
);

// ---- 案例 4：同一批候選結果裡出現重複日期（例如 TWSE date 參數不可靠導致），應該去重 ----
const withDuplicates = [
  { actualDate: '2026-07-07', quotes: [{ code: '1101', volume: 100 }] },
  { actualDate: '2026-07-07', quotes: [{ code: '1101', volume: 999 }] }, // 重複日期，應該被忽略
  { actualDate: '2026-07-03', quotes: [{ code: '1101', volume: 300 }] },
];
const result4 = pickNewTradingDays(withDuplicates, [], 3);
assertEqual(
  result4.map((d) => d.date),
  ['2026-07-07', '2026-07-03'],
  '同一批結果裡的重複日期應該去重，不會被當成兩筆不同的天'
);

// ---- 案例 5：目標天數是 0 或候選清單是空的，應該回傳空陣列，不出錯 ----
assertEqual(pickNewTradingDays(allNew, [], 0), [], '目標天數為 0 時應回傳空陣列');
assertEqual(pickNewTradingDays([], [], 3), [], '候選清單是空的時應回傳空陣列，不拋出例外');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
