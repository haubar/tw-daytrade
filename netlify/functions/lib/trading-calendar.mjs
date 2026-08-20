// netlify/functions/lib/trading-calendar.mjs
//
// 自動抓取 TWSE 官方公告的交易日曆，取代 trading-day.mjs 裡手動維護、每年要記得更新的
// EXCHANGE_HOLIDAYS_BY_YEAR 清單。對應《後續修改清單》P4「交易日曆自動化」。
//
// 端點：TWSE OpenAPI /holidaySchedule/holidaySchedule（已實際呼叫過確認過真實回傳格式）。
//
// 重要：這份清單「不是只有休市日」——它同時包含休市日，跟一些純資訊性質的公告
// （例如「農曆春節前最後交易日」「國曆新年開始交易日」，這些其實是「有交易」的日子，
// 只是要提醒使用者這天是特殊日期，不能把它們當成休市日排除掉）。判斷規則：
//   - Description 包含「放假」或「補假」→ 真正的休市日（例如「依規定放假1日」「於2月27日
//     （星期五）補假」）
//   - Name 包含「無交易」→ 也是休市日（例如「市場無交易，僅辦理結算交割作業」，
//     這種 Description 是空字串，要看 Name 才看得出來）
//   - 其他（例如「XX開始交易日」「XX最後交易日」）→ 不是休市日，不排除

const HOLIDAY_SCHEDULE_URL = 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule';

/**
 * 把 TWSE 的民國日期字串（例如 "1150101" 代表民國115年01月01日）轉成西元 'YYYY-MM-DD'。
 * 用「後4碼是 MMDD、前面全部是民國年」的方式解析，而不是假設固定3碼年份，
 * 這樣未來民國年變成4碼（民國289年，西元2200年）也不會直接解析錯誤。
 * @param {string|number} rocDateStr
 * @returns {string|null} 'YYYY-MM-DD'，格式不合法時回傳 null
 */
export function rocDateToIso(rocDateStr) {
  const str = String(rocDateStr ?? '').trim();
  if (!/^\d{5,}$/.test(str)) return null;

  const mmdd = str.slice(-4);
  const month = mmdd.slice(0, 2);
  const day = mmdd.slice(2, 4);
  const rocYear = Number(str.slice(0, -4));
  if (!Number.isInteger(rocYear) || rocYear <= 0) return null;
  if (Number(month) < 1 || Number(month) > 12) return null;
  if (Number(day) < 1 || Number(day) > 31) return null;

  const gregorianYear = rocYear + 1911;
  return `${gregorianYear}-${month}-${day}`;
}

/**
 * 判斷一筆 holidaySchedule 資料是不是「真正的休市日」，而不是「開始交易日」這種
 * 有交易、只是想特別提醒使用者的資訊性公告。
 * @param {{Name?: string, Description?: string}} entry
 * @returns {boolean}
 */
export function isActualHoliday(entry) {
  const description = String(entry?.Description ?? '');
  const name = String(entry?.Name ?? '');
  // 「放假」涵蓋一般休市日；「補假」涵蓋補假日（例如國定假日剛好遇到週六，改到下一個工作日
  // 放假的情況——說明文字通常寫「於2月27日（星期五）補假」，不會出現「放假」兩個字）。
  if (description.includes('放假') || description.includes('補假')) return true;
  if (name.includes('無交易')) return true;
  return false;
}

/**
 * 把 TWSE holidaySchedule 端點回傳的原始資料，整理成 Set<'YYYY-MM-DD'>（真正的休市日）。
 * 拆成獨立函式（不直接綁在 fetch 裡）方便用固定樣本資料測試解析邏輯，不用真的連網路。
 * @param {Array<{Name?:string, Date?:string, Description?:string}>} rows
 * @returns {Set<string>}
 */
export function parseHolidayScheduleRows(rows) {
  const holidays = new Set();
  if (!Array.isArray(rows)) return holidays;

  for (const entry of rows) {
    if (!isActualHoliday(entry)) continue;
    const iso = rocDateToIso(entry?.Date);
    if (iso) holidays.add(iso);
  }
  return holidays;
}

/**
 * 抓取 TWSE 官方公告的交易日曆，回傳「真正的休市日」集合（西元 'YYYY-MM-DD' 格式）。
 * @returns {Promise<Set<string>>}
 */
export async function fetchExchangeHolidays() {
  const res = await fetch(HOLIDAY_SCHEDULE_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    throw new Error(`交易日曆端點回應錯誤: HTTP ${res.status}`);
  }
  const rows = await res.json();
  return parseHolidayScheduleRows(rows);
}
