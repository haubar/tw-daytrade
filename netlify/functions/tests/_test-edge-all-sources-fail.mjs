// 邊界案例：全市場資料都抓取失敗時，scan.mjs 應該要清楚回報錯誤，而不是回傳一個看起來正常但其實是空的結果
let passed = 0, failed = 0;
function check(cond, label, detail='') {
  if (cond) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label} ${detail}`); }
}

globalThis.fetch = async (url) => {
  const s = String(url);
  if (s.includes('openapi.twse.com.tw')) return { ok: false, status: 503 };
  if (s.includes('tpex.org.tw')) return { ok: false, status: 503 };
  if (s.includes('fund/T86')) return { ok: false, status: 503 };
  throw new Error('未預期的 URL: ' + s);
};

const scanHandler = (await import('../scan.mjs')).default;
const response = await scanHandler(new Request('http://localhost/scan'));
const body = await response.json();

check(response.status === 500, 'TWSE 與 TPEx 都失敗時，應回傳 HTTP 500', `實際: ${response.status}`);
check(typeof body.error === 'string' && body.error.length > 0, '應該有清楚的錯誤訊息，而不是空結果', `實際: ${JSON.stringify(body)}`);
check(body.longWatchlist === undefined, '失敗時不應該回傳看起來正常但其實是空的 longWatchlist（避免誤導使用者以為今天真的沒有任何強勢股）');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
