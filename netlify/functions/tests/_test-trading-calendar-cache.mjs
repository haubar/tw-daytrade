// netlify/functions/tests/_test-trading-calendar-cache.mjs
// 執行方式：node netlify/functions/tests/_test-trading-calendar-cache.mjs

import { saveExchangeHolidays, getExchangeHolidays, getExchangeHolidaysForYears } from '../lib/trading-calendar-cache.mjs';

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

function createFakeStore() {
  const data = new Map();
  return {
    async setJSON(key, value) {
      data.set(key, value);
    },
    async get(key) {
      return data.has(key) ? data.get(key) : null;
    },
  };
}

// ---- 存一個年度、讀回來 ----
const store1 = createFakeStore();
await saveExchangeHolidays(2026, new Set(['2026-01-01', '2026-02-28']), store1);
const result1 = await getExchangeHolidays(2026, store1);
assertEqual([...result1].sort(), ['2026-01-01', '2026-02-28'], '存了2026年的休市日後，應該能讀回相同內容');

// ---- 沒存過的年度應該回傳 null（不是空集合）----
const store2 = createFakeStore();
const result2 = await getExchangeHolidays(2099, store2);
assertEqual(result2, null, '沒存過的年度應該回傳 null，讓呼叫端知道「沒查過」而不是誤判成「查過但沒有休市日」');

// ---- 支援傳入陣列（不只 Set）也能正確存取 ----
const store3 = createFakeStore();
await saveExchangeHolidays(2027, ['2027-01-01'], store3);
const result3 = await getExchangeHolidays(2027, store3);
assertEqual([...result3], ['2027-01-01'], '傳入陣列（不是 Set）也應該能正確存取');

// ---- 覆蓋既有年度資料 ----
const store4 = createFakeStore();
await saveExchangeHolidays(2026, new Set(['2026-01-01']), store4);
await saveExchangeHolidays(2026, new Set(['2026-01-01', '2026-05-01']), store4);
const result4 = await getExchangeHolidays(2026, store4);
assertEqual([...result4].sort(), ['2026-01-01', '2026-05-01'], '重複存同一年度應該覆蓋，不是疊加');

// ---- getExchangeHolidaysForYears：合併多個年度 ----
const store5 = createFakeStore();
await saveExchangeHolidays(2026, new Set(['2026-01-01', '2026-12-25']), store5);
await saveExchangeHolidays(2027, new Set(['2027-01-01']), store5);
const merged = await getExchangeHolidaysForYears([2026, 2027], store5);
assertEqual([...merged].sort(), ['2026-01-01', '2026-12-25', '2027-01-01'], '應該正確合併多個年度的休市日');

// ---- getExchangeHolidaysForYears：其中某個年度沒存過時，應該跳過那個年度，不影響其他年度 ----
const store6 = createFakeStore();
await saveExchangeHolidays(2026, new Set(['2026-01-01']), store6);
const mergedPartial = await getExchangeHolidaysForYears([2026, 2099], store6);
assertEqual([...mergedPartial], ['2026-01-01'], '其中一個年度沒存過時，應該跳過該年度，只回傳有資料的年度');

// ---- getExchangeHolidaysForYears：全部年度都沒存過時，應該回傳空集合，不拋出例外 ----
const store7 = createFakeStore();
const mergedEmpty = await getExchangeHolidaysForYears([2098, 2099], store7);
assertEqual([...mergedEmpty], [], '全部年度都沒存過時應該回傳空集合，不拋出例外');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
