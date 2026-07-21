// netlify/functions/_test-finmind.mjs
// 執行方式：npm run test:finmind

import { parseFinMindInstitutionalRows, fetchFinMindInstitutionalNetBuy } from '../lib/finmind.mjs';

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

function mapToObj(map) {
  return Object.fromEntries(map.entries());
}

// ---- parseFinMindInstitutionalRows ----
// 樣本格式依官方文件描述重建（欄位：date, stock_id, buy, name, sell）——
// 這份格式尚未用真實請求驗證過，見 finmind.mjs 檔頭說明，部署後如果格式不對要回來修這裡的樣本。
const sampleRows = [
  { date: '2026-07-14', stock_id: '5347', buy: 500000, name: 'Foreign_Investor', sell: 200000 },
  { date: '2026-07-14', stock_id: '5347', buy: 100000, name: 'Investment_Trust', sell: 50000 },
  { date: '2026-07-14', stock_id: '5347', buy: 30000, name: 'Dealer_self', sell: 80000 },
];

const parsed = parseFinMindInstitutionalRows(sampleRows);
// 5347 淨買超 = (500000-200000) + (100000-50000) + (30000-80000) = 300000 + 50000 - 50000 = 300000
assertEqual(mapToObj(parsed), { '5347': 300000 }, '應該把外資+投信+自營商三筆資料加總成單一淨買超數字');

// ---- 多檔股票混在同一批結果裡 ----
const multiStockRows = [
  { date: '2026-07-14', stock_id: '5347', buy: 500000, name: 'Foreign_Investor', sell: 200000 },
  { date: '2026-07-14', stock_id: '6488', buy: 100000, name: 'Foreign_Investor', sell: 300000 },
];
const multiParsed = parseFinMindInstitutionalRows(multiStockRows);
assertEqual(
  mapToObj(multiParsed),
  { '5347': 300000, '6488': -200000 },
  '多檔股票應該分別加總，6488 賣超應為負值'
);

// ---- 邊界情況 ----
assertEqual(mapToObj(parseFinMindInstitutionalRows([])), {}, '空陣列應回傳空 map，不拋出例外');
assertEqual(mapToObj(parseFinMindInstitutionalRows(null)), {}, '傳入 null 應回傳空 map，不拋出例外');
assertEqual(
  mapToObj(parseFinMindInstitutionalRows([{ stock_id: '5347', buy: 'abc', sell: 100 }])),
  {},
  'buy/sell 欄位無法解析成數字時，該筆應被忽略，不產生 NaN'
);
assertEqual(
  mapToObj(parseFinMindInstitutionalRows([{ buy: 100, sell: 50 }])), // 缺 stock_id
  {},
  '缺少 stock_id 欄位的資料列應被忽略'
);

// ---- fetchFinMindInstitutionalNetBuy：邊界情況（不連真實網路）----
const emptyResult = await fetchFinMindInstitutionalNetBuy([], '2026-07-14');
assertEqual(mapToObj(emptyResult.netBuyByCode), {}, '空的股票代碼清單應直接回傳空結果，不發送任何請求');
assertEqual(emptyResult.failedStockIds, [], '空的股票代碼清單不應有任何失敗紀錄');
assertEqual(emptyResult.emptyStockIds, [], '空的股票代碼清單不應有任何「空資料」紀錄');
assertEqual(emptyResult.debugInfo, [], '空的股票代碼清單 debugInfo 應為空陣列');

// ---- fetchFinMindInstitutionalNetBuy：用假的 fetch 驗證平行請求＋部分失敗的處理 ----
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const urlStr = String(url);
  if (urlStr.includes('data_id=5347')) {
    return {
      ok: true,
      json: async () => ({
        status: 200,
        data: [{ date: '2026-07-14', stock_id: '5347', buy: 500000, name: 'Foreign_Investor', sell: 200000 }],
      }),
    };
  }
  if (urlStr.includes('data_id=9999')) {
    // 模擬其中一檔股票查詢失敗，驗證不會拖累其他檔的結果
    return { ok: false, status: 500 };
  }
  if (urlStr.includes('data_id=8888')) {
    // 模擬 FinMind 用 HTTP 200 + body.status 表達額度用完等業務邏輯錯誤
    return { ok: true, json: async () => ({ status: 400, msg: 'Your level is free. Please update your user level.' }) };
  }
  if (urlStr.includes('data_id=7777')) {
    // 模擬「技術上成功，但 data 是空陣列」——這是真實部署第一次遇到的情境：
    // 查了 20 檔全部回傳空陣列，原本的程式碼會讓這些股票「既不算成功也不算失敗」憑空消失，
    // 這裡驗證修正後的行為：應該被計入 emptyStockIds，而不是被吞掉。
    return { ok: true, json: async () => ({ status: 200, data: [] }) };
  }
  throw new Error(`測試沒有預期到這個 URL: ${urlStr}`);
};

const mixedResult = await fetchFinMindInstitutionalNetBuy(['5347', '9999', '8888', '7777'], '2026-07-14');
assertEqual(mapToObj(mixedResult.netBuyByCode), { '5347': 300000 }, '部分股票查詢失敗時，成功的那幾檔仍應正確回傳');
assertEqual(
  mixedResult.failedStockIds.sort(),
  ['8888', '9999'],
  '查詢失敗（HTTP 錯誤或業務邏輯錯誤）的股票代碼應該被記錄下來，方便回報有幾檔沒查到'
);
assertEqual(
  mixedResult.emptyStockIds,
  ['7777'],
  '技術上成功但 data 是空陣列的股票，應該被記錄在 emptyStockIds，不能既不算成功也不算失敗地憑空消失'
);
assertEqual(mixedResult.debugInfo.length, 4, 'debugInfo 應該涵蓋全部 4 檔股票（不管成功/失敗/空資料）');
const debug5347 = mixedResult.debugInfo.find((d) => d.stockId === '5347');
assertEqual(debug5347.rowCount, 1, '5347 的 debugInfo 應該正確記錄回傳的資料筆數');
const debug7777 = mixedResult.debugInfo.find((d) => d.stockId === '7777');
assertEqual(debug7777.rowCount, 0, '7777（空資料）的 debugInfo 應該記錄筆數為 0，而不是完全沒有紀錄');
const debug9999 = mixedResult.debugInfo.find((d) => d.stockId === '9999');
assertEqual(debug9999.rowCount, null, '9999（請求失敗）的 debugInfo 應該記錄 rowCount 為 null（不是 0，避免跟「空資料」混淆），並帶有 error 訊息');
assertEqual(typeof debug9999.error, 'string', '9999 的 debugInfo 應該帶有錯誤訊息字串');

// ---- 全部都是空資料的情況（重現真實部署遇到的「查20檔成功0檔」情境）----
globalThis.fetch = async () => ({ ok: true, json: async () => ({ status: 200, data: [] }) });
const allEmptyResult = await fetchFinMindInstitutionalNetBuy(['1111', '2222', '3333'], '2026-07-14');
assertEqual(mapToObj(allEmptyResult.netBuyByCode), {}, '全部都是空資料時，netBuyByCode 應為空');
assertEqual(allEmptyResult.failedStockIds, [], '全部都是空資料時，不應該有任何 failedStockIds（這些請求技術上都成功了）');
assertEqual(
  allEmptyResult.emptyStockIds.sort(),
  ['1111', '2222', '3333'],
  '全部都是空資料時，應該全部被記錄在 emptyStockIds，而不是「查了3檔、成功0檔、也沒有任何失敗紀錄」這種難以診斷的矛盾結果'
);

globalThis.fetch = originalFetch;

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
