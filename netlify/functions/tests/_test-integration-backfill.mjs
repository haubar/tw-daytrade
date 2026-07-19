// netlify/functions/_test-integration-backfill.mjs
// 執行方式：npm run test:integration-backfill
//
// 整合測試：直接呼叫 backfill-history.mjs 的 default export。
//
// 老實說明這支測試能驗證到什麼、不能驗證到什麼：
// backfill-history.mjs 一開始就會呼叫 getArchivedDates() 讀 Blobs，這個測試環境沒有真實
// Blobs 可用，所以不管後面 TWSE mock 回傳什麼，一定會在這一步就失敗。這裡驗證的重點是
// 「這個必然會發生的失敗有沒有被優雅處理掉」（清楚的 500 錯誤，而不是未捕捉例外崩潰）。
//
// 「候選日期裡哪些該跳過、該挑哪幾天」這個核心邏輯，已經用不需要網路/Blobs 的純函式測試
// （_test-backfill-pick.mjs）完整驗證過了，不需要在這裡重複測。

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

const backfillHandler = (await import('../backfill-history.mjs')).default;

let response, body;
try {
  response = await backfillHandler(new Request('http://localhost/backfill-history'));
  body = await response.json();
} catch (e) {
  console.log('❌ backfill-history.mjs 執行時拋出未被捕捉的例外，這是嚴重問題（應該要優雅降級）');
  console.log('   錯誤內容:', e.message);
  process.exit(1);
}

check(
  response.status === 500,
  '沒有真實 Blobs 環境時，應該回傳 500（不是讓整個 function 崩潰、也不是假裝成功）',
  `實際: ${response.status}`
);
check(
  typeof body.error === 'string' && body.error.length > 0,
  '錯誤回應應包含清楚的 error 訊息',
  `實際: ${JSON.stringify(body)}`
);

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
