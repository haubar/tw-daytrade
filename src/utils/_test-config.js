// src/utils/_test-config.js
// 執行方式：node src/utils/_test-config.js

import { buildStockViewUrl, STOCK_VIEW_BASE_URL } from '../config.js';

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  const ok = actual === expected;
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

assertEqual(
  buildStockViewUrl('2330'),
  `${STOCK_VIEW_BASE_URL}/?code=2330`,
  '一般股票代碼應該正確組成網址'
);
assertEqual(
  buildStockViewUrl('8112A'),
  `${STOCK_VIEW_BASE_URL}/?code=8112A`,
  '含英文字母的特別股代碼（例如甲特股）應該正確組成網址'
);
assertEqual(
  buildStockViewUrl('A&B'),
  `${STOCK_VIEW_BASE_URL}/?code=A%26B`,
  '代碼含有網址特殊字元時應該正確編碼（防呆，理論上股票代碼不會有這種字元，但函式本身要正確）'
);

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
