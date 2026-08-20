import { buildHistoricalBacktestWindows, parseBacktestDays, parseCursorDate } from '../lib/backtest-history.mjs';

let passed = 0;
let failed = 0;
function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   期望: ${JSON.stringify(expected)}\n   實際: ${JSON.stringify(actual)}`); }
}

const dates = ['2026-08-10', '2026-08-07', '2026-08-06', '2026-08-05', '2026-08-04', '2026-08-03', '2026-07-31'].map((date) => ({ date, quotes: [] }));
const windows = buildHistoricalBacktestWindows(dates, 5);
assertEqual(windows.length, 1, '7 個交易日可形成 1 個訊號日（執行日 + 訊號日 + 5 日歷史）');
assertEqual(windows[0].execution.date, '2026-08-10', '最新日期應作為隔日執行日');
assertEqual(windows[0].signal.date, '2026-08-07', '第二新日期應作為訊號日');
assertEqual(windows[0].history.map((day) => day.date), ['2026-08-06', '2026-08-05', '2026-08-04', '2026-08-03', '2026-07-31'], '歷史窗口應由近到遠取滿 5 日');
assertEqual(parseBacktestDays('2'), 2, '合法 days 應保留');
assertEqual(parseBacktestDays('9'), 3, '超過上限時應退回預設值');
assertEqual(parseCursorDate('2026-08-10') instanceof Date, true, '合法 cursor 日期應可解析');
assertEqual(parseCursorDate('2026/08/10'), null, '不合法 cursor 日期應拒絕');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
