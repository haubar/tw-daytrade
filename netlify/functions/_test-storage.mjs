// netlify/functions/_test-storage.mjs
// 執行方式：npm run test:storage
//
// 用假的 store 物件（in-memory Map）模擬 Netlify Blobs，不需要真的連到 Netlify 環境。

import { saveLatestScan, getLatestScan, getScanByDate } from './lib/storage.mjs';

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
    _raw: data, // 方便測試直接檢查內部狀態
  };
}

const sampleResult = {
  generatedAt: '2026-07-07T06:10:00.000Z',
  longWatchlist: [{ code: '1101', score: 88.5 }],
  shortWatchlist: [{ code: '2330', score: 12.1 }],
};

// ---- 測試 1：儲存後可以讀到最新結果 ----
const store1 = createFakeStore();
await saveLatestScan(sampleResult, store1);
const latest = await getLatestScan(store1);
assertEqual(latest, sampleResult, '儲存後應能讀到與存入時相同的最新結果');

// ---- 測試 2：同時應存一份「依日期」的備份 ----
const byDate = await getScanByDate('2026-07-07', store1);
assertEqual(byDate, sampleResult, '應能依日期讀到對應的備份（從 generatedAt 取出日期）');

// ---- 測試 3：從未存過資料時，讀取應回傳 null，而不是拋出例外 ----
const emptyStore = createFakeStore();
const nothing = await getLatestScan(emptyStore);
assertEqual(nothing, null, '從未儲存過任何結果時，getLatestScan 應回傳 null');

// ---- 測試 4：新結果覆蓋舊結果時，「最新」要更新，但「依日期」的舊備份不會被覆蓋掉（因為日期不同）----
const store2 = createFakeStore();
const oldResult = { generatedAt: '2026-07-06T06:10:00.000Z', longWatchlist: [{ code: 'OLD' }] };
const newResult = { generatedAt: '2026-07-07T06:10:00.000Z', longWatchlist: [{ code: 'NEW' }] };
await saveLatestScan(oldResult, store2);
await saveLatestScan(newResult, store2);
assertEqual((await getLatestScan(store2)).longWatchlist[0].code, 'NEW', '存入新結果後，最新結果應該是新的那筆');
assertEqual((await getScanByDate('2026-07-06', store2)).longWatchlist[0].code, 'OLD', '舊日期的歷史備份不應被新結果覆蓋');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
