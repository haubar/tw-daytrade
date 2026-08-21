// src/utils/_test-format.js
// 執行方式：node src/utils/_test-format.js

import { formatPercent, formatPrice, formatVolume } from './format.js';

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

// ---- formatPercent ----
assertEqual(formatPercent(5.678), '+5.68%', '正數應該有 + 號、四捨五入到小數點後2位');
assertEqual(formatPercent(-3.2), '-3.20%', '負數應該保留負號');
assertEqual(formatPercent(0), '0.00%', '0 不應該有 + 號（既不是正也不是負），但仍顯示到小數點後2位');

// ---- formatPercent：真實踩過的 bug——回測當天完全沒成交時，這幾個欄位是 null，
// 不是「報酬率剛好是0」。原本直接呼叫 value.toFixed() 會整個畫面壞掉（TypeError:
// Cannot read properties of null (reading 'toFixed')），這裡要能優雅顯示，不能拋出例外 ----
assertEqual(formatPercent(null), '—', 'null（今天完全沒有成交）應該顯示為 —，不是拋出例外或誤顯示成0%');
assertEqual(formatPercent(undefined), '—', 'undefined 應該顯示為 —，不拋出例外');
assertEqual(formatPercent(NaN), '—', 'NaN 應該顯示為 —，不拋出例外');

// ---- formatPrice ----
assertEqual(formatPrice(1234.5), '1235', '千元以上股票應該無條件捨去到整數（實際上是四捨五入，這裡驗證千元價位不顯示小數）');
assertEqual(formatPrice(45.678), '45.68', '千元以下應該顯示到小數點後2位');

// ---- formatVolume ----
assertEqual(formatVolume(1000000), '1,000 張', '100萬股應該顯示為1,000張，並加上千分位');
assertEqual(formatVolume(500), '1 張', '不滿一張的成交股數應該四捨五入');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
