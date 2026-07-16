// netlify/functions/_test-market-index.mjs
// 執行方式：npm run test:market-index
//
// 測試大盤指數取得邏輯：fetchMarketIndex() 函式對真實 MI_INDEX 端點的解析，
// 以及 scan.mjs 中「優先真實值，失敗 fallback 到 proxy」的降級邏輯。

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

// ---- Mock MI_INDEX 回應 ----

function miIndexFixture() {
  return [
    {
      '指數': '加權指數',
      '開盤': '21000.00',
      '最高': '21050.00',
      '最低': '20950.00',
      '收盤': '21020.00',
      '漲跌': '15.00',
      '漲跌百分比': '0.07',
    },
    {
      '指數': '發行量加權股價指數',
      '開盤': '21000.00',
      '最高': '21050.00',
      '最低': '20950.00',
      '收盤': '21020.00',
      '漲跌': '15.00',
      '漲跌百分比': '0.07',
    },
    {
      '指數': '台灣50指數',
      '開盤': '20000.00',
      '最高': '20050.00',
      '最低': '19950.00',
      '收盤': '20020.00',
      '漲跌': '10.00',
      '漲跌百分比': '0.05',
    },
  ];
}

// ---- 測試 fetchMarketIndex 成功情況 ----

console.log('【大盤指數取得邏輯測試】\n');

globalThis.fetch = async (url) => {
  if (String(url).includes('MI_INDEX')) {
    return { ok: true, json: async () => miIndexFixture() };
  }
  throw new Error(`Unexpected URL in test: ${url}`);
};

const { fetchMarketIndex, computeMarketChangeProxy } = await import('./lib/factors.mjs');

try {
  const taiex = await fetchMarketIndex();
  check(
    Math.abs(taiex - 0.07) < 0.0001,
    'fetchMarketIndex 正常情況：應正確解析 TAIEX 漲跌百分比',
    `期望 0.07, 實際 ${taiex}`
  );
} catch (e) {
  failed++;
  console.log(`❌ fetchMarketIndex 正常情況：${e.message}`);
}

// ---- 測試 fetchMarketIndex 失敗情況 ----

globalThis.fetch = async (url) => {
  if (String(url).includes('MI_INDEX')) {
    return { ok: false, status: 500 };
  }
};

try {
  await fetchMarketIndex();
  failed++;
  console.log(`❌ fetchMarketIndex HTTP 錯誤情況：應該拋出錯誤`);
} catch (e) {
  check(e.message.includes('HTTP'), 'fetchMarketIndex HTTP 錯誤情況：應正確拋出 HTTP 錯誤', `錯誤: ${e.message}`);
}

// ---- 測試 MI_INDEX 回應格式不是陣列 ----

globalThis.fetch = async (url) => {
  if (String(url).includes('MI_INDEX')) {
    return { ok: true, json: async () => ({ data: [] }) }; // 應該回傳陣列，不是物件
  }
};

try {
  await fetchMarketIndex();
  failed++;
  console.log(`❌ MI_INDEX 格式異常（非陣列）：應該拋出錯誤`);
} catch (e) {
  check(e.message.includes('陣列'), 'MI_INDEX 格式異常（非陣列）：應正確偵測', `錯誤: ${e.message}`);
}

// ---- 測試 MI_INDEX 回應中沒有 TAIEX 資料 ----

globalThis.fetch = async (url) => {
  if (String(url).includes('MI_INDEX')) {
    return {
      ok: true,
      json: async () => [
        { '指數': '加權指數', '漲跌百分比': '0.07' },
        { '指數': '台灣50指數', '漲跌百分比': '0.05' },
      ],
    };
  }
};

try {
  await fetchMarketIndex();
  failed++;
  console.log(`❌ MI_INDEX 缺少 TAIEX 資料：應該拋出錯誤`);
} catch (e) {
  check(e.message.includes('找不到'), '缺少 TAIEX 資料：應正確偵測', `錯誤: ${e.message}`);
}

// ---- 測試 MI_INDEX 回應的漲跌百分比無法解析 ----

globalThis.fetch = async (url) => {
  if (String(url).includes('MI_INDEX')) {
    return {
      ok: true,
      json: async () => [
        { '指數': '發行量加權股價指數', '漲跌百分比': 'invalid' },
      ],
    };
  }
};

try {
  await fetchMarketIndex();
  failed++;
  console.log(`❌ MI_INDEX 漲跌百分比無效：應該拋出錯誤`);
} catch (e) {
  check(e.message.includes('無法解析'), '漲跌百分比無效：應正確偵測', `錯誤: ${e.message}`);
}

// ---- 測試 computeMarketChangeProxy 作為 fallback ----

console.log('\n【大盤近似值計算（Fallback）測試】\n');

const quotes = [
  { change: 10, close: 110, volume: 1000000 }, // prevClose=100, changePercent=10%, value≈1.1億
  { change: 5, close: 105, volume: 500000 },   // prevClose=100, changePercent=5%, value≈5250萬
];

const proxy = computeMarketChangeProxy(quotes);
check(
  proxy > 0 && proxy < 10,
  'computeMarketChangeProxy 作為 fallback：應計算加權平均漲跌幅',
  `得到 ${proxy.toFixed(2)}%`
);

// ---- 測試 scan.mjs 中的降級邏輯（整合測試） ----

console.log('\n【scan.mjs 中市場數據來源降級邏輯】\n');

globalThis.fetch = async (url) => {
  const urlStr = String(url);
  
  // TAIEX 失敗
  if (urlStr.includes('MI_INDEX')) {
    return { ok: false, status: 500 };
  }
  
  // TWSE 成功
  if (urlStr.includes('openapi.twse.com.tw') && urlStr.includes('STOCK_DAY_ALL')) {
    return {
      ok: true,
      json: async () => [
        { Code: '2408', Name: '南亞科', TradeVolume: '1000000', OpeningPrice: '110', HighestPrice: '115', LowestPrice: '105', ClosingPrice: '112', Change: '2', Transaction: '1000' },
      ],
    };
  }
  
  // TPEx 返回空陣列（模擬無上櫃資料）
  if (urlStr.includes('tpex.org.tw')) {
    return { ok: true, json: async () => [] };
  }
  
  // 法人資料失敗（沒關係，不影響市場數據源測試）
  if (urlStr.includes('T86')) {
    throw new Error('法人資料失敗');
  }
  
  // Blobs 相關的請求都會失敗（這個測試環境沒有真實 Blobs）
  throw new Error('Blobs or unknown endpoint');
};

const scanModule = await import('./scan.mjs');
const scanHandler = scanModule.default;

try {
  const response = await scanHandler(new Request('http://localhost/scan'));
  const body = await response.json();
  
  check(
    response.status === 200,
    'scan.mjs 在 MI_INDEX 失敗時應回傳 HTTP 200（優雅降級）',
    `實際: ${response.status}`
  );
  
  check(
    body.marketDataSource === 'proxy',
    'marketDataSource 應記錄為 "proxy"（表示用近似值）',
    `實際: ${body.marketDataSource}`
  );
  
  check(
    typeof body.dataSourceStatus?.marketIndex === 'string' && body.dataSourceStatus.marketIndex.includes('改用'),
    'dataSourceStatus.marketIndex 應說明已 fallback 到近似法',
    `實際: ${body.dataSourceStatus?.marketIndex}`
  );
  
  check(
    typeof body.marketChangePercent === 'number',
    'marketChangePercent 應有值（透過近似法計算）',
    `實際: ${body.marketChangePercent}`
  );
} catch (e) {
  failed++;
  console.log(`❌ scan.mjs 整合測試失敗: ${e.message}`);
}

// ---- 測試 scan.mjs 中市場數據優先用真實值 ----

console.log('\n【scan.mjs 優先用真實 TAIEX】\n');

globalThis.fetch = async (url) => {
  const urlStr = String(url);
  
  // TAIEX 成功
  if (urlStr.includes('MI_INDEX')) {
    return {
      ok: true,
      json: async () => [
        { '指數': '發行量加權股價指數', '漲跌百分比': '1.23' },
      ],
    };
  }
  
  // TWSE 成功
  if (urlStr.includes('openapi.twse.com.tw') && urlStr.includes('STOCK_DAY_ALL')) {
    return {
      ok: true,
      json: async () => [
        { Code: '2408', Name: '南亞科', TradeVolume: '1000000', OpeningPrice: '110', HighestPrice: '115', LowestPrice: '105', ClosingPrice: '112', Change: '2', Transaction: '1000' },
      ],
    };
  }
  
  // TPEx 返回空陣列
  if (urlStr.includes('tpex.org.tw')) {
    return { ok: true, json: async () => [] };
  }
  
  // 法人資料失敗
  if (urlStr.includes('T86')) {
    throw new Error('法人資料失敗');
  }
  
  throw new Error('Blobs or unknown endpoint');
};

try {
  const response = await scanHandler(new Request('http://localhost/scan'));
  const body = await response.json();
  
  check(
    body.marketDataSource === 'taiex',
    'marketDataSource 應記錄為 "taiex"（表示用真實值）',
    `實際: ${body.marketDataSource}`
  );
  
  check(
    Math.abs(body.marketChangePercent - 1.23) < 0.01,
    'marketChangePercent 應使用 TAIEX 真實值',
    `期望約 1.23, 實際 ${body.marketChangePercent}`
  );
  
  check(
    typeof body.dataSourceStatus?.marketIndex === 'string' && body.dataSourceStatus.marketIndex.includes('真實'),
    'dataSourceStatus.marketIndex 應說明使用真實 TAIEX',
    `實際: ${body.dataSourceStatus?.marketIndex}`
  );
} catch (e) {
  failed++;
  console.log(`❌ scan.mjs 優先用真實 TAIEX 測試失敗: ${e.message}`);
}

globalThis.fetch = originalFetch;

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
