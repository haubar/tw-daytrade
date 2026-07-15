// netlify/functions/_test-history.mjs
// 執行方式：npm run test:history

import { formatDateParam, getPastTradingDayCandidates, fetchVolumeHistory, parseMiIndexResponse } from './lib/history.mjs';

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
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

// ---- formatDateParam ----
assertEqual(formatDateParam(new Date(2026, 6, 7)), '20260707', 'formatDateParam：2026-07-07 應格式化為 20260707');
assertEqual(formatDateParam(new Date(2026, 0, 5)), '20260105', 'formatDateParam：月/日需補零');

// ---- getPastTradingDayCandidates ----
// 2026-07-07 是星期二，往回推應該跳過週末（07-05 週日、07-04 週六）
const tuesday = new Date(2026, 6, 7);
const candidates = getPastTradingDayCandidates(tuesday, 5);
const candidateStrs = candidates.map((d) => formatDateParam(d));
assertEqual(
  candidateStrs,
  ['20260706', '20260703', '20260702', '20260701', '20260630'],
  'getPastTradingDayCandidates：應跳過週末，只取平日'
);

// ---- parseMiIndexResponse（用真實抓到的欄位結構重建樣本資料）----
const MI_INDEX_FIELDS = [
  '證券代號', '證券名稱', '成交股數', '成交筆數', '成交金額',
  '開盤價', '最高價', '最低價', '收盤價', '漲跌(+/-)', '漲跌價差',
  '最後揭示買價', '最後揭示買量', '最後揭示賣價', '最後揭示賣量', '本益比',
];

function buildMiIndexJson(rocDateLabel, rows) {
  return JSON.stringify({
    tables: [
      {}, // MI_INDEX 回應裡真實會有好幾個空表格（其他報表類型用的），驗證解析邏輯有正確跳過它們
      { title: '某個不相關的表格', fields: ['其他欄位'], data: [] },
      {
        title: `${rocDateLabel} 每日收盤行情(全部單元)`,
        fields: MI_INDEX_FIELDS,
        data: rows,
      },
    ],
  });
}

// 真實樣本（來自 MI_INDEX，2026-07-08 台泥：跌 0.30，紅綠色標記在「漲跌(+/-)」欄位，不是「漲跌價差」）
const realSample = buildMiIndexJson('115年07月08日', [
  ['1101', '台泥', '18,652,409', '6,635', '432,888,677', '23.40', '23.55', '23.10', '23.10', '<p style= color:green>-</p>', '0.30', '23.10', '963', '23.15', '78', ''],
  ['1216', '統一', '5,000,000', '3,000', '250,000,000', '65.00', '66.00', '64.50', '65.60', '<p style= color:red>+</p>', '0.60', '65.55', '100', '65.60', '200', ''],
]);

const parsed = parseMiIndexResponse(realSample);
assertEqual(parsed.actualDate, '2026-07-08', 'parseMiIndexResponse：應正確解析報表標題裡的民國年日期');
assertEqual(parsed.quotes.length, 2, 'parseMiIndexResponse：應解析出 2 檔股票');
assertEqual(
  parsed.quotes[0],
  { market: 'TWSE', code: '1101', name: '台泥', open: 23.4, high: 23.55, low: 23.1, close: 23.1, volume: 18652409, change: -0.3 },
  'parseMiIndexResponse：台泥（下跌，綠色標記）應正確解析成負的漲跌'
);
assertEqual(
  parsed.quotes[1],
  { market: 'TWSE', code: '1216', name: '統一', open: 65, high: 66, low: 64.5, close: 65.6, volume: 5000000, change: 0.6 },
  'parseMiIndexResponse：統一（上漲，紅色標記）應正確解析成正的漲跌'
);

// 邊界情況：找不到「證券代號」欄位的表格（回應格式跟預期不同）時，應安全回傳空結果
const noMatchingTable = JSON.stringify({ tables: [{}, { title: 'x', fields: ['其他'], data: [] }] });
assertEqual(parseMiIndexResponse(noMatchingTable), { actualDate: null, quotes: [] }, 'parseMiIndexResponse：找不到對應表格時應安全回傳空結果');

// 邊界情況：整個回應不是合法 JSON 時，不應該拋出例外
assertEqual(parseMiIndexResponse('這不是 JSON'), { actualDate: null, quotes: [] }, 'parseMiIndexResponse：回應不是合法 JSON 時應安全回傳空結果，不拋出例外');

// ---- fetchVolumeHistory（用假的 fetch 模擬網路請求，不連真實網路）----
// 模擬情境：前兩次請求都回傳同一天的資料（重現真實測試中發現的「date 參數不生效」問題），
// 之後才開始回傳不同天的資料。驗證重複日期會被正確跳過，不會被誤算兩次。
let callCount = 0;
const mockDatesReturned = ['115年07月07日', '115年07月07日', '115年07月06日', '115年07月03日', '115年07月02日', '115年07月01日']; // 前兩次重複

globalThis.fetch = async () => {
  const rocDateLabel = mockDatesReturned[callCount] ?? '115年06月30日';
  const volume = String(1000 * (callCount + 1)); // 每次回傳不同量，方便驗證有沒有正確累積
  callCount++;
  return {
    ok: true,
    text: async () =>
      buildMiIndexJson(rocDateLabel, [
        ['1101', '測試股', volume, '100', '1000000', '10.00', '10.50', '9.80', '10.20', '<p style= color:red>+</p>', '0.20', '', '', '', '', ''],
      ]),
  };
};

const { volumeHistory, datesUsed } = await fetchVolumeHistory(5, new Date(2026, 6, 8), 6);

assertEqual(datesUsed.length, 5, 'fetchVolumeHistory：應蒐集到 5 個「獨立」交易日（重複日期不計入）');
assertEqual(
  new Set(datesUsed).size,
  datesUsed.length,
  'fetchVolumeHistory：datesUsed 內不應有重複日期'
);
assertEqual(
  volumeHistory.get('1101').length,
  5,
  'fetchVolumeHistory：1101 的成交量歷史應有 5 筆（重複請求的那一筆不重複計入）'
);

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
