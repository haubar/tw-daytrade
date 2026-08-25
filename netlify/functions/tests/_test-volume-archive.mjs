// netlify/functions/_test-volume-archive.mjs
// 執行方式：npm run test:volume-archive

import { appendDailySnapshot, getRecentVolumeHistory, getArchivedDates, getRecentChangeHistory, getRecentMarketChangeHistory, DEFAULT_HISTORY_WINDOW_DAYS } from '../lib/volume-archive.mjs';

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

// ---- 測試 8：DEFAULT_HISTORY_WINDOW_DAYS 常數與 getRecentVolumeHistory 搭配使用 ----
// 對應《後續修改清單》P1「量能異常因子的計算窗口太短」：原本 3 天拉長到 5 天，後續我們進一步拉長到 10 天，
// 降低單一天異常量能對均量基準的干擾。這裡驗證常數值本身，以及 scan.mjs 實際會用到的
// 天數搭配 getRecentVolumeHistory 時，確實能抓到對應天數的歷史資料。
assertEqual(DEFAULT_HISTORY_WINDOW_DAYS, 10, 'DEFAULT_HISTORY_WINDOW_DAYS 應為 10（擴大以降低單日雜訊干擾）');

const store8 = createFakeStore();
for (let i = 1; i <= 11; i++) {
  const date = `2026-07-${String(i).padStart(2, '0')}`;
  const volume = 1000 + i * 100;
  await appendDailySnapshot(date, [{ code: '1101', volume }], store8);
}
const result8 = await getRecentVolumeHistory(DEFAULT_HISTORY_WINDOW_DAYS, null, store8);
assertEqual(result8.datesUsed.length, 10, '窗口設為 DEFAULT_HISTORY_WINDOW_DAYS 時，應讀到 10 天資料');
assertEqual(result8.volumeHistory.get('1101').length, 10, '單一股票的歷史成交量陣列長度應為 10');

// ---- 測試 9：多日相對強弱功能——changePercent 與 marketChangePercent 的存取 ----
// 對應《後續修改清單》P1「相對強弱因子只用單日資料」

// 9a：新格式（帶 changePercent + marketChangePercent）應該能正確存取
const store9 = createFakeStore();
await appendDailySnapshot('2026-07-10', [{ code: '1101', volume: 1000, changePercent: 2.5 }], store9, { marketChangePercent: 0.8 });
await appendDailySnapshot('2026-07-11', [{ code: '1101', volume: 1100, changePercent: -1.2 }], store9, { marketChangePercent: -0.3 });
const changeHistory9 = await getRecentChangeHistory(5, null, store9);
assertEqual(changeHistory9.get('1101'), [-1.2, 2.5], 'getRecentChangeHistory：應讀到兩天的 changePercent，新到舊排序');
const marketHistory9 = await getRecentMarketChangeHistory(5, null, store9);
assertEqual(marketHistory9, [-0.3, 0.8], 'getRecentMarketChangeHistory：應讀到兩天的大盤漲跌幅，新到舊排序');
// 就算存了 changePercent，volumeHistory 的既有行為也不能被破壞
const volumeHistory9 = await getRecentVolumeHistory(5, null, store9);
assertEqual(volumeHistory9.volumeHistory.get('1101'), [1100, 1000], '存了 changePercent 之後，getRecentVolumeHistory 仍應正常運作，不受影響');

// 9b：沒有帶 changePercent／marketChangePercent 的呼叫（舊呼叫端還沒升級）應該優雅處理
const store10 = createFakeStore();
await appendDailySnapshot('2026-07-12', [{ code: '2330', volume: 5000 }], store10); // 沒有第 4 個參數
const changeHistory10 = await getRecentChangeHistory(5, null, store10);
assertEqual(changeHistory10.has('2330'), false, '沒有提供 changePercent 時，getRecentChangeHistory 不應該把這檔股票這一天算進去');
const marketHistory10 = await getRecentMarketChangeHistory(5, null, store10);
assertEqual(marketHistory10, [], '沒有提供 marketChangePercent 時，getRecentMarketChangeHistory 應該跳過這一天');
// volumeHistory 應該完全不受影響
const volumeHistory10 = await getRecentVolumeHistory(5, null, store10);
assertEqual(volumeHistory10.volumeHistory.get('2330'), [5000], '沒有 changePercent 時，volume 的讀取仍應正常');

// 9c：真正的舊格式資料（部署前既有的 Blobs 資料，快照本身是「code -> 純數字」而不是物件）
// 讀取端應該要能相容，不能因為升級後開始要求物件格式，就讓舊資料整批讀不到
const store11 = createFakeStore();
await store11.setJSON('snapshot:2026-07-13', { '1101': 800, '2330': 3000 }); // 手動模擬舊格式快照
await store11.setJSON('index', ['2026-07-13']);
const volumeHistory11 = await getRecentVolumeHistory(5, null, store11);
assertEqual(volumeHistory11.volumeHistory.get('1101'), [800], '舊格式（純數字）快照的 volume 仍應正常讀取，不因升級後格式改變而讀不到');
const changeHistory11 = await getRecentChangeHistory(5, null, store11);
assertEqual(changeHistory11.has('1101'), false, '舊格式快照沒有 changePercent 可用，getRecentChangeHistory 應該跳過，而不是拋出例外');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
