// netlify/functions/_test-trading-day.mjs
// 執行方式：npm run test:trading-day

import { isWeekend, formatDateParam, getPastTradingDayCandidates, isMarketDataReady, isExchangeHoliday } from '../lib/trading-day.mjs';

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

// ---- isWeekend ----
assertEqual(isWeekend(new Date(2026, 6, 4)), true, 'isWeekend：2026-07-04 是星期六，應為 true');
assertEqual(isWeekend(new Date(2026, 6, 5)), true, 'isWeekend：2026-07-05 是星期日，應為 true');
assertEqual(isWeekend(new Date(2026, 6, 6)), false, 'isWeekend：2026-07-06 是星期一，應為 false');
assertEqual(isWeekend(new Date(2026, 6, 7)), false, 'isWeekend：2026-07-07 是星期二，應為 false');

// ---- formatDateParam ----
assertEqual(formatDateParam(new Date(2026, 6, 7)), '20260707', 'formatDateParam：2026-07-07 應格式化為 20260707');

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

// ---- isMarketDataReady ----
// 台灣時間 = UTC + 8。台灣 13:59 = UTC 05:59（還沒到下午2點）
assertEqual(isMarketDataReady(new Date(Date.UTC(2026, 6, 7, 5, 59))), false, 'isMarketDataReady：台灣時間 13:59 應為 false（還沒到下午2點）');
// 台灣 14:00 = UTC 06:00（剛好到下午2點）
assertEqual(isMarketDataReady(new Date(Date.UTC(2026, 6, 7, 6, 0))), true, 'isMarketDataReady：台灣時間 14:00 應為 true（剛好到下午2點）');
// 台灣 20:00 = UTC 12:00（晚上，早就過了下午2點）
assertEqual(isMarketDataReady(new Date(Date.UTC(2026, 6, 7, 12, 0))), true, 'isMarketDataReady：台灣時間 20:00 應為 true');
// 台灣 08:00 = UTC 00:00（早上，還沒到下午2點）
assertEqual(isMarketDataReady(new Date(Date.UTC(2026, 6, 7, 0, 0))), false, 'isMarketDataReady：台灣時間 08:00 應為 false');
// 跨日邊界：台灣時間凌晨 2:00 = UTC 前一天 18:00（隔天凌晨，還沒到下午2點）
assertEqual(isMarketDataReady(new Date(Date.UTC(2026, 6, 6, 18, 0))), false, 'isMarketDataReady：跨日邊界（台灣時間隔天凌晨 02:00）應為 false');

// ---- isExchangeHoliday ----
assertEqual(isExchangeHoliday(new Date(2026, 0, 1)), true, 'isExchangeHoliday：2026-01-01 元旦應為 true');
assertEqual(isExchangeHoliday(new Date(2026, 1, 17)), true, 'isExchangeHoliday：2026-02-17 春節期間應為 true');
assertEqual(isExchangeHoliday(new Date(2026, 3, 4)), true, 'isExchangeHoliday：2026-04-04 兒童節應為 true');
assertEqual(isExchangeHoliday(new Date(2026, 6, 7)), false, 'isExchangeHoliday：2026-07-07 是普通交易日，應為 false');
assertEqual(isExchangeHoliday(new Date(2026, 0, 2)), false, 'isExchangeHoliday：2026-01-02 元旦隔天（普通交易日）應為 false');
// 清單裡沒有資料的年度（例如 2027），應該安全回傳 false，而不是拋出例外或誤判成假日
assertEqual(isExchangeHoliday(new Date(2027, 0, 1)), false, 'isExchangeHoliday：清單裡沒有的年度應安全回傳 false，不拋出例外');

// ---- getPastTradingDayCandidates 應該同時跳過週末跟已知的國定假日 ----
// 2026-01-06（星期二）往回推：01-05（一）候選 → 01-04(日)/01-03(六) 跳過週末
// → 01-02（五）候選 → 01-01（四，元旦，國定假日）跳過 → 2025-12-31（三）候選...
const jan6 = new Date(2026, 0, 6);
const holidayAwareCandidates = getPastTradingDayCandidates(jan6, 5).map((d) => formatDateParam(d));
assertEqual(
  holidayAwareCandidates,
  ['20260105', '20260102', '20251231', '20251230', '20251229'],
  'getPastTradingDayCandidates：應該同時跳過週末（01-03/01-04）跟元旦（01-01）'
);

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
