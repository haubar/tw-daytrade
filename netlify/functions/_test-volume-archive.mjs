// netlify/functions/_test-volume-archive.mjs
// 執行方式：npm run test:volume-archive

import { appendDailySnapshot, getRecentVolumeHistory, getArchivedDates } from './lib/volume-archive.mjs';

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
    async delete(key) {
      data.delete(key);
    },
    _raw: data,
  };
}

// ---- 測試 1：存一天、讀一天 ----
const store1 = createFakeStore();
await appendDailySnapshot('2026-07-06', [{ code: '1101', volume: 1000 }, { code: '2330', volume: 5000 }], store1);
const result1 = await getRecentVolumeHistory(3, null, store1);
assertEqual(result1.datesUsed, ['2026-07-06'], '存一天後，讀取應該拿到那一天');
assertEqual(result1.volumeHistory.get('1101'), [1000], '1101 的成交量歷史應該正確');

// ---- 測試 2：累積存三天，讀取應該依日期新到舊排序 ----
const store2 = createFakeStore();
await appendDailySnapshot('2026-07-06', [{ code: '1101', volume: 1000 }], store2);
await appendDailySnapshot('2026-07-07', [{ code: '1101', volume: 2000 }], store2);
await appendDailySnapshot('2026-07-08', [{ code: '1101', volume: 3000 }], store2);
const result2 = await getRecentVolumeHistory(3, null, store2);
assertEqual(result2.datesUsed, ['2026-07-08', '2026-07-07', '2026-07-06'], '累積三天後應依新到舊排序');
assertEqual(result2.volumeHistory.get('1101'), [3000, 2000, 1000], '成交量歷史陣列順序應對應日期順序');

// ---- 測試 3：同一天重複執行不會產生重複天數（覆蓋而不是累加）----
const store3 = createFakeStore();
await appendDailySnapshot('2026-07-07', [{ code: '1101', volume: 1000 }], store3);
await appendDailySnapshot('2026-07-07', [{ code: '1101', volume: 9999 }], store3); // 同一天重跑，數字應該被覆蓋
const result3 = await getRecentVolumeHistory(5, null, store3);
assertEqual(result3.datesUsed, ['2026-07-07'], '同一天重複執行不應該產生兩筆日期');
assertEqual(result3.volumeHistory.get('1101'), [9999], '同一天重複執行應該覆蓋成最新的數字');

// ---- 測試 4：excludeDate 應該把指定日期排除在歷史之外 ----
const store4 = createFakeStore();
await appendDailySnapshot('2026-07-07', [{ code: '1101', volume: 2000 }], store4);
await appendDailySnapshot('2026-07-08', [{ code: '1101', volume: 3000 }], store4);
const result4 = await getRecentVolumeHistory(5, '2026-07-08', store4);
assertEqual(result4.datesUsed, ['2026-07-07'], 'excludeDate 應該把「今天」排除，避免把自己算進歷史裡');

// ---- 測試 5：超過保留天數上限時，最舊的資料應該被清掉 ----
const store5 = createFakeStore();
for (let i = 1; i <= 17; i++) {
  const d = `2026-06-${String(i).padStart(2, '0')}`;
  await appendDailySnapshot(d, [{ code: '1101', volume: i * 100 }], store5);
}
const index5 = await store5.get('index');
assertEqual(index5.length, 15, '超過保留上限（15 天）時，索引應該只留最新 15 天');
assertEqual(store5._raw.has('snapshot:2026-06-01'), false, '被淘汰的最舊快照資料應該被實際刪除，不留在 store 裡');

// ---- 測試 6：完全沒有歷史資料時，應該回傳空結果，而不是拋出例外 ----
const emptyStore = createFakeStore();
const result6 = await getRecentVolumeHistory(3, null, emptyStore);
assertEqual(result6.datesUsed, [], '完全沒有歷史資料時，datesUsed 應該是空陣列');
assertEqual(result6.volumeHistory.size, 0, '完全沒有歷史資料時，volumeHistory 應該是空 map');

// ---- 測試 7：getArchivedDates 應該回傳已存的日期清單（新到舊） ----
const store7 = createFakeStore();
await appendDailySnapshot('2026-07-06', [{ code: '1101', volume: 1000 }], store7);
await appendDailySnapshot('2026-07-07', [{ code: '1101', volume: 2000 }], store7);
const archivedDates7 = await getArchivedDates(store7);
assertEqual(archivedDates7, ['2026-07-07', '2026-07-06'], 'getArchivedDates：應回傳已存日期，新到舊排序');

const emptyArchivedDates = await getArchivedDates(emptyStore);
assertEqual(emptyArchivedDates, [], 'getArchivedDates：完全沒有資料時應回傳空陣列');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
