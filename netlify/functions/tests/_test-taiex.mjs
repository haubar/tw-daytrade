// netlify/functions/_test-taiex.mjs
// 執行方式：npm run test:taiex

import { parseTaiexChangePercent } from '../lib/taiex.mjs';

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

// 真實樣本（來自 openapi.twse.com.tw/v1/exchangeReport/MI_INDEX，節錄）
const realSample = [
  { '指數': '寶島股價指數', '收盤指數': '15234.12', '漲跌': '+', '漲跌點數': '12.34', '漲跌百分比': '0.08' },
  { '指數': '發行量加權股價指數', '收盤指數': '46744.16', '漲跌': '-', '漲跌點數': '274.83', '漲跌百分比': '-0.58' },
  { '指數': '臺灣中型100指數', '收盤指數': '37450.59', '漲跌': '+', '漲跌點數': '292.22', '漲跌百分比': '0.79' },
];

assertEqual(parseTaiexChangePercent(realSample), -0.58, '應該正確解析出發行量加權股價指數（TAIEX）的漲跌百分比（負值）');

const positiveSample = [
  { '指數': '發行量加權股價指數', '收盤指數': '46744.16', '漲跌': '+', '漲跌點數': '100.00', '漲跌百分比': '0.35' },
];
assertEqual(parseTaiexChangePercent(positiveSample), 0.35, '正值也應該正確解析（不需要額外處理正負號，欄位本身就帶符號）');

// ---- 邊界情況 ----
assertEqual(parseTaiexChangePercent([]), null, '空陣列時應回傳 null，而不是拋出例外');
assertEqual(parseTaiexChangePercent(null), null, '傳入 null 時應回傳 null，而不是拋出例外');
assertEqual(parseTaiexChangePercent(undefined), null, '傳入 undefined 時應回傳 null，而不是拋出例外');
assertEqual(
  parseTaiexChangePercent([{ '指數': '某個不相關的指數', '漲跌百分比': '5.00' }]),
  null,
  '清單裡沒有「發行量加權股價指數」這筆時應回傳 null'
);
assertEqual(
  parseTaiexChangePercent([{ '指數': '發行量加權股價指數', '漲跌百分比': '不是數字' }]),
  null,
  '漲跌百分比欄位無法解析成數字時應回傳 null，而不是回傳 NaN'
);

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
