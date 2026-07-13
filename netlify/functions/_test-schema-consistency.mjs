// netlify/functions/_test-schema-consistency.mjs
// 執行方式：npm run test:schema
//
// QA 交叉驗證：src/sampleData.js 是前端開發時手動編造的範例資料，
// 跟 scan.mjs 的真實輸出是兩份「各自維護」的東西，很容易在後端改欄位時忘記同步更新前端範例，
// 導致前端在本機開發時看起來正常（因為用的是範例資料），部署後接上真實資料卻爆炸。
// 這支測試用跟整合測試一樣的假資料跑一次 scan.mjs，拿真實輸出的欄位結構跟 sampleData.js 比對。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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

// ---- 用跟整合測試一樣的假資料，跑一次真實的 scan.mjs ----
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
  if (urlStr.includes('rwd/zh/afterTrading/STOCK_DAY_ALL')) {
    const callIndex = (globalThis.__historyCallCount = (globalThis.__historyCallCount || 0) + 1);
    const fakeRocDate = `115070${callIndex}`;
    const header = '日期,證券代號,證券名稱,成交股數,成交金額,開盤價,最高價,最低價,收盤價,漲跌價差,成交筆數';
    const row = `"${fakeRocDate}","2408","南亞科","10000000","4000000000","440.0","445.0","435.0","440.0","0.0","8000"`;
    return { ok: true, text: async () => `${header}\n${row}` };
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

// ---- 讀取 sampleData.js 的原始檔案內容，用簡單的方式取出物件（避免直接 import 帶入 Vue 專案的解析複雜度）----
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleDataPath = path.join(__dirname, '..', '..', 'src', 'sampleData.js');
const sampleDataModule = await import(sampleDataPath);
const sampleData = sampleDataModule.sampleScanResult;

// ---- 比對頂層欄位 ----
const realTopLevelKeys = sortedKeys(realOutput).filter((k) => k !== 'storageWarning' && k !== 'elapsedMs');
const sampleTopLevelKeys = sortedKeys(sampleData);
check(
  JSON.stringify(realTopLevelKeys) === JSON.stringify(sampleTopLevelKeys.filter((k) => k !== 'elapsedMs')),
  '頂層欄位結構應該一致（sampleData.js 是不是漏放或多放了某個欄位）',
  `\n   真實輸出: ${JSON.stringify(realTopLevelKeys)}\n   範例資料: ${JSON.stringify(sampleTopLevelKeys)}`
);

// ---- 比對 dataSourceStatus 子物件的欄位 ----
check(
  JSON.stringify(sortedKeys(realOutput.dataSourceStatus)) === JSON.stringify(sortedKeys(sampleData.dataSourceStatus)),
  'dataSourceStatus 的子欄位應該一致',
  `\n   真實輸出: ${JSON.stringify(sortedKeys(realOutput.dataSourceStatus))}\n   範例資料: ${JSON.stringify(sortedKeys(sampleData.dataSourceStatus))}`
);

// ---- 比對 longWatchlist / shortWatchlist 裡每一筆股票物件的欄位 ----
const realItemKeys = sortedKeys(realOutput.longWatchlist[0]);
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
