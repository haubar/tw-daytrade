// netlify/functions/_test-schema-consistency.mjs
// 執行方式：npm run test:schema
//
// QA 交叉驗證：src/sampleData.js 是前端開發時手動編造的範例資料，
// 跟後端的真實輸出是兩份「各自維護」的東西，很容易在後端改欄位時忘記同步更新前端範例，
// 導致前端在本機開發時看起來正常（因為用的是範例資料），部署後接上真實資料卻爆炸。
//
// 做法：
// - 頂層欄位／dataSourceStatus 子欄位：跑一次真實的 scan.mjs（用假 fetch 攔截外部請求）取得真實輸出比對
// - 觀察榜裡每一筆股票物件的欄位：因為這個測試環境沒有真實 Blobs，scan.mjs 的觀察榜會是空的
//   （這是預期行為，見 _test-integration-scan.mjs），所以改成直接呼叫 screenWatchlists 建構
//   一筆真實的候選股物件來比對欄位，不依賴 scan.mjs 是否能拿到非空觀察榜

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { screenWatchlists } from './lib/screen.mjs';

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

function sortedKeys(obj) {
  return Object.keys(obj).sort();
}

// ---- 用假資料跑一次真實的 scan.mjs，取得頂層欄位結構 ----
globalThis.fetch = async (url) => {
  const urlStr = String(url);
  if (urlStr.includes('openapi.twse.com.tw')) {
    return {
      ok: true,
      json: async () => [
        {
          Code: '2408', Name: '南亞科', TradeVolume: '50000000', TradeValue: '20000000000',
          OpeningPrice: '440.0', HighestPrice: '450.0', LowestPrice: '435.0', ClosingPrice: '445.5',
          Change: '40.5', Transaction: '30000',
        },
      ],
    };
  }
  if (urlStr.includes('tpex.org.tw')) {
    return { ok: true, json: async () => [] };
  }
  if (urlStr.includes('fund/T86')) {
    return {
      ok: true,
      text: async () =>
        `<html><body><table><tr><th>證券代號</th><th>證券名稱</th><th>三大法人買賣超股數</th></tr><tr><td>2408</td><td>南亞科</td><td>6,200,000</td></tr></table></body></html>`,
    };
  }
  throw new Error(`schema 測試沒有預期到這個 URL: ${urlStr}`);
};

const scanHandler = (await import('./scan.mjs')).default;
const response = await scanHandler(new Request('http://localhost/scan'));
const realOutput = await response.json();

// ---- 讀取 sampleData.js ----
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleDataPath = path.join(__dirname, '..', '..', 'src', 'sampleData.js');
const sampleDataModule = await import(sampleDataPath);
const sampleData = sampleDataModule.sampleScanResult;

// ---- 比對頂層欄位 ----
const realTopLevelKeys = sortedKeys(realOutput).filter((k) => k !== 'storageWarning' && k !== 'elapsedMs');
const sampleTopLevelKeys = sortedKeys(sampleData).filter((k) => k !== 'elapsedMs');
check(
  JSON.stringify(realTopLevelKeys) === JSON.stringify(sampleTopLevelKeys),
  '頂層欄位結構應該一致（sampleData.js 是不是漏放或多放了某個欄位）',
  `\n   真實輸出: ${JSON.stringify(realTopLevelKeys)}\n   範例資料: ${JSON.stringify(sampleTopLevelKeys)}`
);

// ---- 比對 dataSourceStatus 子物件的欄位 ----
check(
  JSON.stringify(sortedKeys(realOutput.dataSourceStatus)) === JSON.stringify(sortedKeys(sampleData.dataSourceStatus)),
  'dataSourceStatus 的子欄位應該一致（含新增的 historyArchive 欄位）',
  `\n   真實輸出: ${JSON.stringify(sortedKeys(realOutput.dataSourceStatus))}\n   範例資料: ${JSON.stringify(sortedKeys(sampleData.dataSourceStatus))}`
);

// ---- 比對觀察榜股票物件的欄位：直接呼叫 screenWatchlists 建構一筆真實資料來比對 ----
const fakeQuotes = [
  { code: '2408', name: '南亞科', market: 'TWSE', open: 440, high: 450, low: 435, close: 445.5, volume: 50000000, change: 40.5 },
];
const fakeVolumeHistory = new Map([['2408', [10000000, 12000000, 9000000]]]);
const fakeInstitutionalNetBuy = new Map([['2408', 6200000]]);
const realScreenResult = screenWatchlists(fakeQuotes, fakeVolumeHistory, fakeInstitutionalNetBuy, { topN: 30 });

const realItemKeys = sortedKeys(realScreenResult.longWatchlist[0]);
const sampleLongItemKeys = sortedKeys(sampleData.longWatchlist[0]);
const sampleShortItemKeys = sortedKeys(sampleData.shortWatchlist[0]);

check(
  JSON.stringify(realItemKeys) === JSON.stringify(sampleLongItemKeys),
  'longWatchlist 股票物件的欄位結構應該一致',
  `\n   真實輸出: ${JSON.stringify(realItemKeys)}\n   範例資料: ${JSON.stringify(sampleLongItemKeys)}`
);
check(
  JSON.stringify(realItemKeys) === JSON.stringify(sampleShortItemKeys),
  'shortWatchlist 股票物件的欄位結構應該一致',
  `\n   真實輸出: ${JSON.stringify(realItemKeys)}\n   範例資料: ${JSON.stringify(sampleShortItemKeys)}`
);

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
