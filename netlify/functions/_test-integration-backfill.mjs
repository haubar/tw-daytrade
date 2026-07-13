// netlify/functions/_test-integration-backfill.mjs
// 執行方式：npm run test:integration-backfill
//
// 整合測試：直接呼叫 backfill-history.mjs 的 default export，驗證兩種情境：
// (1) 歷史資料抓取成功，但這個測試環境沒有真實 Blobs 可以寫入 → 應該優雅回傳 500 + 清楚錯誤訊息，
//     而不是讓整個 function 未捕捉例外爆掉
// (2) 連歷史資料都抓不到 → 應該回傳 500 + 明確指出「沒有抓到任何歷史交易日資料」

const originalFetch = globalThis.fetch;
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

function historyCsvFixture(callIndex) {
  const fakeRocDate = `115070${callIndex}`;
  const header = '日期,證券代號,證券名稱,成交股數,成交金額,開盤價,最高價,最低價,收盤價,漲跌價差,成交筆數';
  const row = `"${fakeRocDate}","1101","台泥","10000000","4000000000","23.0","23.5","22.5","23.0","0.0","8000"`;
  return `${header}\n${row}`;
}

// ---- 情境 1：歷史資料抓得到，但 Blobs 寫入一定會失敗（這個環境沒有真實 Blobs） ----

let historyCallCount = 0;
globalThis.fetch = async (url) => {
  const urlStr = String(url);
  if (urlStr.includes('rwd/zh/afterTrading/STOCK_DAY_ALL')) {
    const callIndex = ++historyCallCount; // 呼叫當下就快照，避免閉包陷阱（見階段 13 的教訓）
    return { ok: true, text: async () => historyCsvFixture(callIndex) };
  }
  throw new Error(`情境 1 沒有預期到這個 URL: ${urlStr}`);
};

const backfillHandler = (await import('./backfill-history.mjs')).default;

let response1, body1;
try {
  response1 = await backfillHandler(new Request('http://localhost/backfill-history'));
  body1 = await response1.json();
} catch (e) {
  console.log('❌ backfill-history.mjs 執行時拋出未被捕捉的例外，這是嚴重問題（應該要優雅降級）');
  console.log('   錯誤內容:', e.message);
  process.exit(1);
}

check(
  response1.status === 500,
  '情境1：沒有真實 Blobs 環境時，應該回傳 500（不是讓整個 function 崩潰、也不是假裝成功）',
  `實際: ${response1.status}`
);
check(
  typeof body1.error === 'string' && body1.error.length > 0,
  '情境1：錯誤回應應包含清楚的 error 訊息',
  `實際: ${JSON.stringify(body1)}`
);

// ---- 情境 2：連歷史資料都抓不到 ----

globalThis.fetch = async () => ({ ok: false, status: 503 });

let response2, body2;
try {
  response2 = await backfillHandler(new Request('http://localhost/backfill-history'));
  body2 = await response2.json();
} catch (e) {
  console.log('❌ 情境2：backfill-history.mjs 執行時拋出未被捕捉的例外');
  console.log('   錯誤內容:', e.message);
  process.exit(1);
}

check(response2.status === 500, '情境2：TWSE 歷史資料端點全部失敗時，應該回傳 500', `實際: ${response2.status}`);
check(
  typeof body2.error === 'string',
  '情境2：應該有清楚的 error 訊息，而不是空結果'
);

globalThis.fetch = originalFetch;

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
