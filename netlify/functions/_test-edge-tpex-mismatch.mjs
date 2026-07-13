// 邊界案例：TPEx 欄位跟預期不符時（目前這個環境沒辦法驗證的真實風險），
// 整個掃描應該還是能用 TWSE 資料繼續跑完，只是 TPEx 那部分標示失敗，而不是讓整個請求掛掉
let passed = 0, failed = 0;
function check(cond, label, detail='') {
  if (cond) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label} ${detail}`); }
}

let historyCallCount = 0;
globalThis.fetch = async (url) => {
  const s = String(url);
  if (s.includes('openapi.twse.com.tw')) {
    return { ok: true, json: async () => [
      { Code: '2408', Name: '南亞科', TradeVolume: '50000000', TradeValue: '1', OpeningPrice: '440', HighestPrice: '450', LowestPrice: '435', ClosingPrice: '445.5', Change: '40.5', Transaction: '1' },
    ]};
  }
  if (s.includes('tpex.org.tw')) {
    // 故意回傳跟 TPEX_FIELD_CANDIDATES 完全對不上的欄位名稱，模擬「猜錯欄位」的真實風險情境
    return { ok: true, json: async () => [{ weird_field_1: 'x', weird_field_2: 'y' }] };
  }
  if (s.includes('rwd/zh/afterTrading')) {
    historyCallCount++;
    const d = `115070${historyCallCount}`;
    return { ok: true, text: async () => `日期,證券代號,證券名稱,成交股數,成交金額,開盤價,最高價,最低價,收盤價,漲跌價差,成交筆數\n"${d}","2408","南亞科","10000000","1","440","445","435","440","0","1"` };
  }
  if (s.includes('fund/T86')) {
    return { ok: true, text: async () => `<table><tr><th>證券代號</th><th>三大法人買賣超股數</th></tr></table>` };
  }
  throw new Error('未預期的 URL: ' + s);
};

const scanHandler = (await import('./scan.mjs')).default;
const response = await scanHandler(new Request('http://localhost/scan'));
const body = await response.json();

check(response.status === 200, 'TPEx 欄位對不上，但 TWSE 正常時，整體仍應回傳 200', `實際: ${response.status}`);
check(body.dataSourceStatus.tpex.includes('失敗'), 'TPEx 應清楚標示失敗，且錯誤訊息應該要有用（不是籠統帶過）', `實際: ${body.dataSourceStatus.tpex}`);
check(body.dataSourceStatus.tpex.includes('缺少欄位') || body.dataSourceStatus.tpex.includes('weird_field'), 'TPEx 錯誤訊息應該要包含實際欄位名稱，方便之後除錯修正 TPEX_FIELD_CANDIDATES', `實際: ${body.dataSourceStatus.tpex}`);
check(body.dataSourceStatus.twse.includes('ok'), 'TWSE 應該不受 TPEx 失敗影響，正常顯示 ok');
check(body.longWatchlist.length > 0, '即使少了 TPEx 資料，多方觀察榜仍應該用 TWSE 資料正常產出結果');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
