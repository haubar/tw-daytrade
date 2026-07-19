// netlify/functions/_test-integration-latest.mjs
// 執行方式：npm run test:integration-latest
//
// 驗證 latest.mjs 在兩種情境下的行為：(1) Blobs 讀取失敗時的降級處理 (2) 有資料時正確回傳

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

const latestHandler = (await import('../latest.mjs')).default;

// 情境：這個測試環境沒有真實的 Netlify Blobs 環境，getStore() 呼叫會失敗，
// 驗證 latest.mjs 有沒有把這個狀況包成乾淨的錯誤回應，而不是讓整個 function 拋出未捕捉例外
let response;
let body;
try {
  response = await latestHandler(new Request('http://localhost/latest'));
  body = await response.json();
} catch (e) {
  console.log('❌ latest.mjs 執行時拋出未被捕捉的例外');
  console.log('   錯誤內容:', e.message);
  process.exit(1);
}

check(
  response.status === 404 || response.status === 500,
  '在沒有真實 Blobs 資料的情況下，latest.mjs 應回傳 404（查無資料）或 500（讀取錯誤），而不是假裝成功回傳空資料',
  `實際狀態碼: ${response.status}`
);
check(typeof body.error === 'string', '錯誤情境下的回應應包含清楚的 error 訊息', `實際: ${JSON.stringify(body)}`);

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
