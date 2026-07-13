// netlify/functions/_test-fetch-daily-quotes.mjs
//
// 本地測試腳本：不連網路，用「真實 API 回傳過的樣本資料」驗證 normalize.mjs 的邏輯。
// 執行方式：npm run test:fetch

import { normalizeTwseRow, normalizeTpexRow, isTradableRow } from './lib/normalize.mjs';

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

// ---- 測試 1：TWSE 正常股票（真實樣本：台泥 1101，2026-07-03）----
const twseSample = {
  Date: '1150703',
  Code: '1101',
  Name: '台泥',
  TradeVolume: '28112178',
  TradeValue: '665352110',
  OpeningPrice: '23.10',
  HighestPrice: '23.90',
  LowestPrice: '23.10',
  ClosingPrice: '23.65',
  Change: '0.5500',
  Transaction: '8655',
};

assertEqual(
  normalizeTwseRow(twseSample),
  {
    market: 'TWSE',
    code: '1101',
    name: '台泥',
    open: 23.1,
    high: 23.9,
    low: 23.1,
    close: 23.65,
    volume: 28112178,
    change: 0.55,
  },
  'TWSE 正常股票（台泥）正規化正確'
);

// ---- 測試 2：TWSE 當日無交易的標的（真實樣本：00625K，成交量為 0）----
const twseZeroVolume = {
  Date: '1150703',
  Code: '00625K',
  Name: '富邦上証+R',
  TradeVolume: '0',
  TradeValue: '0',
  OpeningPrice: '0.00',
  HighestPrice: '0.00',
  LowestPrice: '0.00',
  ClosingPrice: '0.00',
  Change: '0.0000',
  Transaction: '0',
};
const normalizedZero = normalizeTwseRow(twseZeroVolume);
assertEqual(isTradableRow(normalizedZero), false, 'TWSE 當日無交易標的應被 isTradableRow 過濾掉');
assertEqual(isTradableRow(normalizedTwseSample()), true, 'TWSE 正常有交易標的應通過 isTradableRow');

function normalizedTwseSample() {
  return normalizeTwseRow(twseSample);
}

// ---- 測試 3：TWSE 負漲跌價差（真實樣本：中福 1435，跌停且欄位有負號）----
const twseNegativeChange = {
  Date: '1150703',
  Code: '1435',
  Name: '中福',
  TradeVolume: '79586',
  TradeValue: '2367782',
  OpeningPrice: '29.75',
  HighestPrice: '29.75',
  LowestPrice: '29.75',
  ClosingPrice: '29.75',
  Change: '-3.3000',
  Transaction: '105',
};
assertEqual(normalizeTwseRow(twseNegativeChange).change, -3.3, 'TWSE 負漲跌價差應正確轉為負數');

// ---- 測試 4：TPEx 欄位對應成功（用候選欄位名稱之一）----
const tpexSampleWithKnownFields = {
  SecuritiesCompanyCode: '6488',
  CompanyName: '環球晶',
  Open: '450.00',
  High: '460.00',
  Low: '448.00',
  Close: '458.00',
  TradingShares: '1200000',
  Change: '5.00',
};
assertEqual(
  normalizeTpexRow(tpexSampleWithKnownFields),
  {
    market: 'TPEx',
    code: '6488',
    name: '環球晶',
    open: 450,
    high: 460,
    low: 448,
    close: 458,
    volume: 1200000,
    change: 5,
  },
  'TPEx 欄位對應（候選欄位命中）正規化正確'
);

// ---- 測試 5：TPEx 欄位對不上時，應丟出清楚的錯誤訊息，而不是靜默算出錯誤數字 ----
const tpexSampleWithUnknownFields = {
  weird_code_field: '6488',
  weird_name_field: '環球晶',
};
try {
  normalizeTpexRow(tpexSampleWithUnknownFields);
  failed++;
  console.log('❌ TPEx 欄位對不上時應該要 throw，但沒有');
} catch (e) {
  const hasUsefulMessage = e.message.includes('weird_code_field') && e.message.includes('缺少欄位');
  if (hasUsefulMessage) {
    passed++;
    console.log('✅ TPEx 欄位對不上時，錯誤訊息包含原始欄位名稱（方便除錯）');
  } else {
    failed++;
    console.log('❌ TPEx 錯誤訊息內容不符預期:', e.message);
  }
}

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
