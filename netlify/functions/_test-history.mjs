// netlify/functions/_test-history.mjs
// 執行方式：npm run test:history

import { formatDateParam, getPastTradingDayCandidates, fetchVolumeHistory } from './lib/history.mjs';

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

// ---- fetchVolumeHistory（用假的 fetch 模擬網路請求，不連真實網路）----
// 模擬情境：前兩次請求都回傳同一天的資料（重現真實測試中發現的「date 參數不生效」問題），
// 之後才開始回傳不同天的資料。驗證重複日期會被正確跳過，不會被誤算兩次。
function buildCsv(dateRoc, code, volume) {
  return `日期,證券代號,證券名稱,成交股數,成交金額,開盤價,最高價,最低價,收盤價,漲跌價差,成交筆數\n"${dateRoc}","${code}","測試股","${volume}","1000000","10.00","10.50","9.80","10.20","0.2000","100"`;
}

let callCount = 0;
const mockDatesReturned = ['1150707', '1150707', '1150706', '1150703', '1150702', '1150701']; // 前兩次重複

globalThis.fetch = async () => {
  const dateRoc = mockDatesReturned[callCount] ?? '1150630';
  const volume = 1000 * (callCount + 1); // 每次回傳不同量，方便驗證有沒有正確累積
  callCount++;
  return {
    ok: true,
    text: async () => buildCsv(dateRoc, '1101', volume),
  };
};

const { volumeHistory, datesUsed } = await fetchVolumeHistory(5, new Date(2026, 6, 8));

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
