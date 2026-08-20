// netlify/functions/tests/_test-trading-calendar.mjs
// 執行方式：node netlify/functions/tests/_test-trading-calendar.mjs

import { rocDateToIso, isActualHoliday, parseHolidayScheduleRows } from '../lib/trading-calendar.mjs';

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

function assertSetEqual(actualSet, expectedArray, label) {
  assertEqual([...actualSet].sort(), [...expectedArray].sort(), label);
}

// ---- rocDateToIso ----
assertEqual(rocDateToIso('1150101'), '2026-01-01', '民國115年01月01日應轉為西元2026-01-01');
assertEqual(rocDateToIso('1151225'), '2026-12-25', '民國115年12月25日應轉為西元2026-12-25');
assertEqual(rocDateToIso(1150101), '2026-01-01', '傳入數字型別也應正確轉換');
assertEqual(rocDateToIso(''), null, '空字串應回傳 null');
assertEqual(rocDateToIso(null), null, '傳入 null 應回傳 null，不拋出例外');
assertEqual(rocDateToIso(undefined), null, '傳入 undefined 應回傳 null，不拋出例外');
assertEqual(rocDateToIso('abc'), null, '非數字字串應回傳 null');
assertEqual(rocDateToIso('1151399'), null, '月份超出範圍(13月)應回傳 null');

// ---- isActualHoliday：用 TWSE holidaySchedule 端點的真實回傳格式驗證判斷規則 ----
// （這些樣本是實際呼叫 https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule 拿到的真實資料，
// 不是憑空編的，確保判斷規則跟真實資料格式對得上）
assertEqual(
  isActualHoliday({ Name: '中華民國開國紀念日', Date: '1150101', Description: '依規定放假1日。' }),
  true,
  '元旦：Description 有「放假」，應判定為休市日'
);
assertEqual(
  isActualHoliday({ Name: '國曆新年開始交易日', Date: '1150102', Description: '國曆新年開始交易。' }),
  false,
  '「開始交易日」：雖然是特殊公告，但這天實際上有交易，不應判定為休市日'
);
assertEqual(
  isActualHoliday({ Name: '農曆春節前最後交易日', Date: '1150211', Description: '農曆春節前最後交易。<br>' }),
  false,
  '「最後交易日」：這天實際上有交易，不應判定為休市日'
);
assertEqual(
  isActualHoliday({ Name: '市場無交易，僅辦理結算交割作業', Date: '1150212', Description: '' }),
  true,
  '「市場無交易」：Description 是空字串，但 Name 有「無交易」，應判定為休市日'
);
assertEqual(
  isActualHoliday({ Name: '農曆除夕及春節', Date: '1150215', Description: '依規定於2月15日至2月19日放假5日。2月15日適逢星期日，於2月20日（星期五）補假。' }),
  true,
  '農曆春節：Description 有「放假」，應判定為休市日'
);
assertEqual(
  isActualHoliday({ Name: '和平紀念日', Date: '1150227', Description: '和平紀念日為2月28日適逢星期六，於2月27日（星期五）補假。' }),
  true,
  '補假日：Description 有「補假」（不是「放假」），也應判定為休市日——這是實際踩到的解析漏洞，補假說明文字不會出現「放假」兩字'
);
assertEqual(
  isActualHoliday({}),
  false,
  '缺少 Name/Description 欄位時，應安全回傳 false，不拋出例外'
);

// ---- parseHolidayScheduleRows：整批真實樣本資料的端到端解析 ----
// 這份樣本節錄自實際 API 回傳（2026年整年公告，25筆），用來驗證整批解析的正確性，
// 特別是「開始交易日」「最後交易日」這幾筆有沒有被正確排除在外。
const realSampleRows = [
  { Name: '中華民國開國紀念日', Date: '1150101', Weekday: '四', Description: '依規定放假1日。' },
  { Name: '國曆新年開始交易日', Date: '1150102', Weekday: '五', Description: '國曆新年開始交易。' },
  { Name: '農曆春節前最後交易日', Date: '1150211', Weekday: '三', Description: '農曆春節前最後交易。<br>' },
  { Name: '市場無交易，僅辦理結算交割作業', Date: '1150212', Weekday: '四', Description: '' },
  { Name: '市場無交易，僅辦理結算交割作業', Date: '1150213', Weekday: '五', Description: '' },
  { Name: '農曆除夕及春節', Date: '1150215', Weekday: '日', Description: '依規定於2月15日至2月19日放假5日。' },
  { Name: '農曆除夕及春節', Date: '1150216', Weekday: '一', Description: '依規定於2月15日至2月19日放假5日。' },
  { Name: '農曆春節後開始交易日', Date: '1150223', Weekday: '一', Description: '農曆春節後開始交易。' },
  { Name: '和平紀念日', Date: '1150227', Weekday: '五', Description: '和平紀念日為2月28日適逢星期六，於2月27日（星期五）補假。' },
  { Name: '和平紀念日', Date: '1150228', Weekday: '六', Description: '依規定放假1日。' },
  { Name: '勞動節', Date: '1150501', Weekday: '五', Description: '依規定放假1日。' },
];
const parsed = parseHolidayScheduleRows(realSampleRows);
assertSetEqual(
  parsed,
  ['2026-01-01', '2026-02-12', '2026-02-13', '2026-02-15', '2026-02-16', '2026-02-27', '2026-02-28', '2026-05-01'],
  '整批真實樣本解析後，休市日集合應正確排除「開始交易日」「最後交易日」這幾筆'
);
assertEqual(parsed.has('2026-01-02'), false, '「國曆新年開始交易日」(01-02) 不應該出現在休市日集合裡');
assertEqual(parsed.has('2026-02-11'), false, '「農曆春節前最後交易日」(02-11) 不應該出現在休市日集合裡');
assertEqual(parsed.has('2026-02-23'), false, '「農曆春節後開始交易日」(02-23) 不應該出現在休市日集合裡');

// ---- 邊界情況 ----
assertEqual(parseHolidayScheduleRows([]).size, 0, '空陣列應回傳空集合');
assertEqual(parseHolidayScheduleRows(null).size, 0, '傳入 null 應安全回傳空集合，不拋出例外');
assertEqual(parseHolidayScheduleRows(undefined).size, 0, '傳入 undefined 應安全回傳空集合，不拋出例外');
assertEqual(parseHolidayScheduleRows('not an array').size, 0, '傳入非陣列應安全回傳空集合，不拋出例外');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
