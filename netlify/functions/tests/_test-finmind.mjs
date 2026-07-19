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
  throw new Error(`測試沒有預期到這個 URL: ${urlStr}`);
};

const mixedResult = await fetchFinMindInstitutionalNetBuy(['5347', '9999', '8888'], '2026-07-14');
assertEqual(mapToObj(mixedResult.netBuyByCode), { '5347': 300000 }, '部分股票查詢失敗時，成功的那幾檔仍應正確回傳');
assertEqual(
  mixedResult.failedStockIds.sort(),
  ['8888', '9999'],
  '查詢失敗（HTTP 錯誤或業務邏輯錯誤）的股票代碼應該被記錄下來，方便回報有幾檔沒查到'
);

globalThis.fetch = originalFetch;

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
