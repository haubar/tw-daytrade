// netlify/functions/_test-normalize-csv.mjs
// 執行方式：npm run test:normalize-csv

import { normalizeTwseCsvRow, extractDateFromCsvRow, isTradableRow } from '../lib/normalize.mjs';

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

// 真實樣本（來自歷史資料端點，2026-07-07 台泥）
const realSample = {
  '日期': '1150707',
  '證券代號': '1101',
  '證券名稱': '台泥',
  '成交股數': '33225864',
  '成交金額': '778330046',
  '開盤價': '23.65',
  '最高價': '23.70',
  '最低價': '23.25',
  '收盤價': '23.40',
  '漲跌價差': '-0.3000',
  '成交筆數': '8414',
};

assertEqual(
  normalizeTwseCsvRow(realSample),
  {
    market: 'TWSE',
    code: '1101',
    name: '台泥',
    open: 23.65,
    high: 23.7,
    low: 23.25,
    close: 23.4,
    volume: 33225864,
    change: -0.3,
  },
  'CSV 列正規化：台泥資料正確（含負漲跌價差）'
);

assertEqual(isTradableRow(normalizeTwseCsvRow(realSample)), true, 'CSV 正規化後的資料應通過 isTradableRow');

// 民國年日期轉換：1150707 → 2026-07-07
assertEqual(extractDateFromCsvRow(realSample), '2026-07-07', '日期轉換：民國 1150707 應轉為西元 2026-07-07');

// 邊界：日期欄位缺失或格式不對時應回傳 null，而不是拋出例外或算出錯誤日期
assertEqual(extractDateFromCsvRow({}), null, '日期轉換：缺少日期欄位時回傳 null');
assertEqual(extractDateFromCsvRow({ '日期': '2026' }), null, '日期轉換：日期欄位長度不對時回傳 null');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
