// netlify/functions/_test-integration-scan.mjs
// 執行方式：npm run test:integration
//
// QA 整合測試：之前每個模組（normalize/history/factors/screen/institutional/storage）
// 都是各自獨立測試，從沒有人真的完整跑過一次 scan.mjs 的實際 handler，
// 驗證「這些模組接在一起真的能動」。這支測試用假的 global.fetch 攔截所有對外請求，
// 直接呼叫 scan.mjs 的 default export（跟 Netlify 實際呼叫它的方式一樣），
// 確認整條流程從頭到尾產出正確、結構完整的結果。

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
  // 兩檔股票：一檔明顯強勢、一檔明顯弱勢，方便驗證多空觀察榜排序正確
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

function historyCsvFixture(callIndex) {
  // 每次呼叫回傳不同的假日期（民國年格式），確保 history.mjs 的「去重」邏輯可以順利蒐集到 5 個不同交易日
  const fakeRocDate = `115070${callIndex}`; // 1150701, 1150702, ...
  const header = '日期,證券代號,證券名稱,成交股數,成交金額,開盤價,最高價,最低價,收盤價,漲跌價差,成交筆數';
  const row1101 = `"${fakeRocDate}","2408","南亞科","10000000","4000000000","440.0","445.0","435.0","440.0","0.0","8000"`;
  const row3661 = `"${fakeRocDate}","3661","世芯-KY","2000000","5000000000","2440.0","2450.0","2400.0","2440.0","0.0","4000"`;
  return `${header}\n${row1101}\n${row3661}`;
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

let historyCallCount = 0;

globalThis.fetch = async (url) => {
  const urlStr = String(url);

  if (urlStr.includes('openapi.twse.com.tw')) {
    return { ok: true, json: async () => twseJsonFixture() };
  }
  if (urlStr.includes('tpex.org.tw')) {
    return { ok: true, json: async () => tpexJsonFixture() };
  }
  if (urlStr.includes('rwd/zh/afterTrading/STOCK_DAY_ALL')) {
    historyCallCount++;
    return { ok: true, text: async () => historyCsvFixture(historyCallCount) };
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
check(Array.isArray(body.longWatchlist), '回應應包含 longWatchlist 陣列');
check(Array.isArray(body.shortWatchlist), '回應應包含 shortWatchlist 陣列');
check(body.longWatchlist.length > 0, '多方觀察榜應該有資料（不是空的）', `實際筆數: ${body.longWatchlist?.length}`);
check(
  body.longWatchlist[0]?.code === '2408',
  '南亞科（大漲+爆量+法人買超）應該是多方觀察榜第一名',
  `實際第一名: ${body.longWatchlist[0]?.code}`
);
check(
  body.shortWatchlist[0]?.code === '3661',
  '世芯-KY（大跌+法人賣超）應該是空方觀察榜第一名',
  `實際第一名: ${body.shortWatchlist[0]?.code}`
);
check(body.historicalDatesUsed?.length === 5, '應該蒐集到 5 個歷史交易日', `實際: ${body.historicalDatesUsed?.length}`);
check(
  typeof body.dataSourceStatus?.twse === 'string' && body.dataSourceStatus.twse.includes('ok'),
  'TWSE 資料來源狀態應顯示 ok'
);
check(
  typeof body.dataSourceStatus?.tpex === 'string' && body.dataSourceStatus.tpex.includes('ok'),
  'TPEx 資料來源狀態應顯示 ok'
);
check(
  typeof body.dataSourceStatus?.institutional === 'string' && body.dataSourceStatus.institutional.includes('ok'),
  '法人資料來源狀態應顯示 ok（日期有對上，不該出現警告）',
  `實際: ${body.dataSourceStatus?.institutional}`
);
check(typeof body.disclaimer === 'string' && body.disclaimer.length > 0, '應包含免責聲明文字');

// storageWarning 應該要出現——因為這個測試環境沒有真的 Netlify Blobs 環境可以寫入，
// 這裡驗證的重點是「這個必然會失敗的狀況，有沒有被優雅處理掉，而不是讓整個 function 掛掉」
check(
  typeof body.storageWarning === 'string',
  '在沒有真實 Netlify Blobs 環境的情況下，應該要有 storageWarning 欄位（代表存檔失敗有被優雅捕捉，而不是讓整個請求失敗）',
  `實際 storageWarning: ${body.storageWarning}`
);
check(
  response.status === 200,
  '即使 Blobs 寫入失敗，整個請求仍應回傳 200（不因為次要功能失敗就讓主要功能一起掛掉）'
);

// 每一筆觀察榜資料都要有完整的四因子貢獻度欄位，前端 ScoreBar 才不會畫出 NaN
const allFieldsPresent = [...body.longWatchlist, ...body.shortWatchlist].every(
  (item) =>
    typeof item.volumeContribution === 'number' &&
    typeof item.gapContribution === 'number' &&
    typeof item.relativeStrengthContribution === 'number' &&
    typeof item.institutionalContribution === 'number' &&
    typeof item.score === 'number'
);
check(allFieldsPresent, '多空觀察榜每一筆都應該有完整的四因子貢獻度欄位（前端因子解剖條會用到）');

globalThis.fetch = originalFetch;

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
