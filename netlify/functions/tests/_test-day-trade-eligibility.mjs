// netlify/functions/tests/_test-day-trade-eligibility.mjs
// 執行方式：node netlify/functions/tests/_test-day-trade-eligibility.mjs

import { parseDayTradeEligibleRows } from '../lib/day-trade-eligibility.mjs';

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

function assertSetEqual(actualSet, expectedArray, label) {
  assertEqual([...actualSet].sort(), [...expectedArray].sort(), label);
}

// ---- 基本情況：沒有 Suspension 標記的都算可以當沖 ----
const rows1 = [
  { Date: '20260817', Code: '2330', Name: '台積電', Suspension: '' },
  { Date: '20260817', Code: '2317', Name: '鴻海', Suspension: '' },
];
assertSetEqual(parseDayTradeEligibleRows(rows1), ['2330', '2317'], '沒有 Suspension 標記的股票都應該視為可以當沖');

// ---- Suspension 有值代表今天被暫停當沖資格，應該排除 ----
const rows2 = [
  { Date: '20260817', Code: '2330', Name: '台積電', Suspension: '' },
  { Date: '20260817', Code: '3008', Name: '大立光', Suspension: '＊' }, // 暫停
];
assertSetEqual(parseDayTradeEligibleRows(rows2), ['2330'], 'Suspension 有值的股票應該被排除，不算今天可以當沖');

// ---- 沒有出現在清單裡的股票，呼叫端會用 .has() 判斷為 false，這裡只驗證清單本身不會誤包含 ----
assertEqual(parseDayTradeEligibleRows(rows2).has('9999'), false, '清單裡沒有的代碼，.has() 應該回傳 false');

// ---- 邊界情況：不是陣列、空陣列、缺少欄位，都應該安全處理，不拋出例外 ----
assertEqual(parseDayTradeEligibleRows([]).size, 0, '空陣列應該回傳空集合');
assertEqual(parseDayTradeEligibleRows(null).size, 0, '傳入 null 時應該安全回傳空集合，不拋出例外');
assertEqual(parseDayTradeEligibleRows(undefined).size, 0, '傳入 undefined 時應該安全回傳空集合，不拋出例外');
assertEqual(parseDayTradeEligibleRows('not an array').size, 0, '傳入非陣列時應該安全回傳空集合，不拋出例外');
assertSetEqual(
  parseDayTradeEligibleRows([{ Name: '缺少代碼欄位' }, { Code: '2330', Suspension: '' }]),
  ['2330'],
  '缺少 Code 欄位的列應該被跳過，不影響其他正常的列'
);
assertSetEqual(
  parseDayTradeEligibleRows([{ Code: '  2330  ', Suspension: '' }]),
  ['2330'],
  'Code 欄位前後有空白時應該自動 trim'
);

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
