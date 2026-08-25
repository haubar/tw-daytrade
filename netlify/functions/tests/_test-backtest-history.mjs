import { buildHistoricalBacktestWindows, parseBacktestDays, parseCursorDate, computeNextEndDate } from '../lib/backtest-history.mjs';
import { getPastTradingDayCandidates, getNextTradingDay, formatIsoDate } from '../lib/trading-day.mjs';

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

// ---- computeNextEndDate：真實踩過的 bug——0 個窗口時 nextEndDate 不該卡在 null ----
const windowsFormed = buildHistoricalBacktestWindows(dates, 5); // 上面已驗證過會形成 1 個窗口
assertEqual(
  computeNextEndDate(windowsFormed, [new Date(2026, 7, 10)]),
  '2026-08-07',
  '有湊出窗口時，nextEndDate 應該是最舊那個窗口的訊號日（讓下一批從這裡繼續往前）'
);
assertEqual(
  computeNextEndDate([], [new Date(2026, 7, 18), new Date(2026, 7, 17), new Date(2026, 7, 6)]),
  '2026-08-06',
  '真實踩過的 bug 案例：一個窗口都沒湊出來時（例如 TWSE 逾時導致成功天數不夠），' +
    'nextEndDate 不應該是 null，而應該退回「這批候選裡最舊的一天」，讓下次呼叫還能往前推進'
);
assertEqual(
  computeNextEndDate([], []),
  null,
  'candidates 也是空的時候（理論上不該發生，防呆處理），應該回傳 null 而不是拋出例外'
);

// ---- 回填控制頁的「精準指定訊號日」targeting 邏輯：getNextTradingDay 呼叫兩次算出 cursorDate，
// 搭配 getPastTradingDayCandidates + buildHistoricalBacktestWindows，驗證最終窗口的訊號日
// 真的等於使用者指定的那一天，不是猜的、是端到端驗證過的（見 backfill-backtest.mjs 的說明）----
function assertSignalDateTargeting(signalDateStr, expectedExecutionDateStr, label) {
  const [y, m, d] = signalDateStr.split('-').map(Number);
  const signalDate = new Date(y, m - 1, d);
  const executionDate = getNextTradingDay(signalDate);
  const cursorDate = getNextTradingDay(executionDate);
  const candidates = getPastTradingDayCandidates(cursorDate, 7);
  const snapshots = candidates.map((c) => ({ date: formatIsoDate(c), quotes: [] }));
  const windows = buildHistoricalBacktestWindows(snapshots, 5);
  assertEqual(windows[0]?.signal?.date, signalDateStr, `${label}：窗口的訊號日應該精準等於指定的日期`);
  assertEqual(windows[0]?.execution?.date, expectedExecutionDateStr, `${label}：窗口的執行日應該是訊號日的下一個交易日`);
}

assertSignalDateTargeting('2026-08-14', '2026-08-17', '一般平日（週五訊號，隔週一執行）');
assertSignalDateTargeting('2026-08-17', '2026-08-18', '一般平日（週一訊號，週二執行）');
assertSignalDateTargeting('2025-12-31', '2026-01-02', '跨年邊界，隔天是元旦國定假日，執行日應該再往後跳到真正的交易日');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
