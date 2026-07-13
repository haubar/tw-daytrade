// netlify/functions/_test-integration-scan.mjs
// 執行方式：npm run test:integration
//
// QA 整合測試：直接呼叫 scan.mjs 的 default export（跟 Netlify 實際呼叫它的方式一樣），
// 用假的 global.fetch 攔截 TWSE/TPEx/法人資料等外部請求，驗證整條流程從頭到尾的行為。
//
// 重要說明：scan.mjs 的歷史資料現在是讀 Netlify Blobs（見 volume-archive.mjs），
// 這個測試環境沒有真實的 Blobs 可用，所以歷史資料讀取一定會失敗——這裡驗證的重點是
// 「這個必然會發生的降級狀況有沒有被優雅處理掉」（空觀察榜 + 清楚的狀態訊息，而不是整個
// function 掛掉）。「排名邏輯本身對不對」這件事，已經由 _test-screen.mjs 用直接建構的
// volumeHistory 驗證過了，不需要在這裡重複測。

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

// ---- 建立假資料 ----

function twseJsonFixture() {
  return [
    {
      Code: '2408', Name: '南亞科', TradeVolume: '50000000', TradeValue: '20000000000',
      OpeningPrice: '440.0', HighestPrice: '450.0', LowestPrice: '435.0', ClosingPrice: '445.5',
      Change: '40.5', Transaction: '30000',
    },
    {
      Code: '3661', Name: '世芯-KY', TradeVolume: '8000000', TradeValue: '20000000000',
      OpeningPrice: '2450.0', HighestPrice: '2460.0', LowestPrice: '2400.0', ClosingPrice: '2410.0',
      Change: '-230.0', Transaction: '15000',
    },
  ];
}

function tpexJsonFixture() {
  return [
    {
      SecuritiesCompanyCode: '5347', CompanyName: '世界', Open: '155.0', High: '160.0', Low: '154.0',
      Close: '158.5', TradingShares: '3000000', Change: '3.0',
    },
  ];
}

function t86HtmlFixture(todayRocDateLabel) {
  return `
<html><body>
<h3>${todayRocDateLabel} 三大法人買賣超日報</h3>
<table>
  <tr>
    <th>證券代號</th><th>證券名稱</th><th>三大法人買賣超股數</th>
  </tr>
  <tr><td>2408</td><td>南亞科</td><td>6,200,000</td></tr>
  <tr><td>3661</td><td>世芯-KY</td><td>-950,000</td></tr>
</table>
</body></html>`;
}

function todayAsRocDateLabel() {
  const now = new Date();
  const rocYear = now.getFullYear() - 1911;
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${rocYear}年${m}月${d}日`;
}

// ---- 安裝假的 fetch，依 URL 分流到對應的假資料 ----
// 注意：不再需要處理 rwd/zh/afterTrading/STOCK_DAY_ALL 這個 URL，因為 scan.mjs 已經不會
// 現場抓多天歷史資料了（改讀 Blobs）。如果這個測試意外打到那個 URL，代表 scan.mjs 又
// 回頭在用舊的抓取方式，下面的 throw 會讓測試明確失敗，提醒要檢查架構是不是跑掉了。

globalThis.fetch = async (url) => {
  const urlStr = String(url);

  if (urlStr.includes('openapi.twse.com.tw')) {
    return { ok: true, json: async () => twseJsonFixture() };
  }
  if (urlStr.includes('tpex.org.tw')) {
    return { ok: true, json: async () => tpexJsonFixture() };
  }
  if (urlStr.includes('fund/T86')) {
    return { ok: true, text: async () => t86HtmlFixture(todayAsRocDateLabel()) };
  }

  throw new Error(`整合測試沒有預期到這個 URL 會被呼叫: ${urlStr}`);
};

// ---- 執行測試 ----

const scanHandler = (await import('./scan.mjs')).default;

let response;
let body;
try {
  response = await scanHandler(new Request('http://localhost/scan'));
  body = await response.json();
} catch (e) {
  console.log('❌ scan.mjs 執行時拋出未被捕捉的例外，這是嚴重問題（應該要優雅降級，不該直接爆炸）');
  console.log('   錯誤內容:', e.message);
  console.log(e.stack);
  process.exit(1);
}

check(response.status === 200, 'scan.mjs 應回傳 HTTP 200', `實際: ${response.status}`);
check(Array.isArray(body.longWatchlist), '回應應包含 longWatchlist 陣列（即使是空的，型別也要是陣列）');
check(Array.isArray(body.shortWatchlist), '回應應包含 shortWatchlist 陣列（即使是空的，型別也要是陣列）');

// 這個測試環境沒有真實 Blobs，讀取歷史資料一定會失敗 → 所有股票都因為「沒有歷史資料」被排除 →
// 觀察榜會是空的。這是預期中的優雅降級行為，不是 bug。
check(
  body.longWatchlist.length === 0 && body.shortWatchlist.length === 0,
  '沒有真實 Blobs 環境時，觀察榜應該優雅降級成空陣列（因為沒有歷史資料可用），而不是報錯或回傳假資料',
  `實際: long=${body.longWatchlist?.length}, short=${body.shortWatchlist?.length}`
);
check(
  typeof body.dataSourceStatus?.historyArchive === 'string' && body.dataSourceStatus.historyArchive.includes('失敗'),
  'dataSourceStatus.historyArchive 應該清楚標示歷史資料讀取失敗',
  `實際: ${body.dataSourceStatus?.historyArchive}`
);
check(
  typeof body.dataSourceStatus?.twse === 'string' && body.dataSourceStatus.twse.includes('ok'),
  'TWSE 資料來源狀態應顯示 ok（不受歷史資料失敗影響）'
);
check(
  typeof body.dataSourceStatus?.tpex === 'string' && body.dataSourceStatus.tpex.includes('ok'),
  'TPEx 資料來源狀態應顯示 ok（不受歷史資料失敗影響）'
);
check(
  typeof body.dataSourceStatus?.institutional === 'string' && body.dataSourceStatus.institutional.includes('ok'),
  '法人資料來源狀態應顯示 ok（不受歷史資料失敗影響，且日期有對上）',
  `實際: ${body.dataSourceStatus?.institutional}`
);
check(typeof body.disclaimer === 'string' && body.disclaimer.length > 0, '應包含免責聲明文字');

// storageWarning 應該要出現——因為這個測試環境沒有真的 Netlify Blobs 環境可以寫入，
// 這裡驗證的重點是「這個必然會失敗的狀況，有沒有被優雅處理掉，而不是讓整個 function 掛掉」
check(
  typeof body.storageWarning === 'string',
  '在沒有真實 Netlify Blobs 環境的情況下，應該要有 storageWarning 欄位（代表結果存檔失敗有被優雅捕捉）',
  `實際 storageWarning: ${body.storageWarning}`
);

globalThis.fetch = originalFetch;

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
