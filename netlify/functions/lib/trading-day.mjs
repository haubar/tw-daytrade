// netlify/functions/lib/trading-day.mjs
//
// 共用的「交易日」相關邏輯：判斷是否為週末、產生候選交易日清單。
// 抽成獨立模組是因為 history.mjs（給 backfill-history.mjs 用）跟 scan.mjs 都需要判斷
// 「今天/某一天是不是交易日」，避免兩邊各自寫一份邏輯，容易長出不一致的行為
// （例如一邊用 getDay()、一邊用別的方式判斷週末，結果邊界情況對不起來）。
//
// 注意：現在除了週六日，也會排除已知的台股休市日（以 2026 年官方行事曆為準）。
// 這不是完整的國定假日引擎，而是一份可維護的交換所休市清單；如果未來年度有調整，
// 只要更新下方的日期表即可，不需要動到候選日期產生邏輯。

/**
 * 判斷某個日期是不是週六或週日
 * @param {Date} date
 * @returns {boolean}
 */
export function isWeekend(date) {
  const day = date.getDay(); // 0 = 週日, 6 = 週六
  return day === 0 || day === 6;
}

function formatIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 以 TWSE 官方公告的 2026 年交易日曆為基準，先把已知休市日列出。
// 這份清單可以在每年年初更新，讓 getPastTradingDayCandidates 自動跳過非交易日。
const EXCHANGE_HOLIDAYS_BY_YEAR = {
  2026: new Set([
    '2026-01-01',
    '2026-02-16',
    '2026-02-17',
    '2026-02-18',
    '2026-02-19',
    '2026-02-20',
    '2026-02-27',
    '2026-04-03',
    '2026-04-04',
    '2026-04-05',
    '2026-05-01',
    '2026-06-19',
    '2026-09-25',
    '2026-10-09',
    '2026-10-26',
    '2026-12-25',
  ]),
};

/**
 * 判斷某個日期是不是台股休市日（週末以外，含已知國定/補假休市）。
 * @param {Date} date
 * @returns {boolean}
 */
export function isExchangeHoliday(date) {
  const holidaySet = EXCHANGE_HOLIDAYS_BY_YEAR[date.getFullYear()];
  if (!holidaySet) return false;
  return holidaySet.has(formatIsoDate(date));
}

const TAIWAN_UTC_OFFSET_HOURS = 8;
const MARKET_DATA_READY_HOUR = 14; // 台灣時間幾點後，盤後資料才算大致穩定可用

/**
 * 判斷現在是不是已經過了台灣時間下午 2 點——台股 13:30 收盤，盤後資料通常要再等一段時間
 * 才會確定下來，太早查詢可能拿到還沒最終確認的資料。用 UTC 時間換算，不依賴伺服器本身的
 * 時區設定（Netlify Functions 執行環境預設是 UTC，用 getUTCHours() 換算比較保險，
 * 不會因為部署環境的時區設定不同而算錯）。
 *
 * 這裡只判斷「現在幾點」，不判斷「今天是不是交易日」，兩者是分開的兩個檢查（見 isWeekend）。
 *
 * @param {Date} [date] 預設現在
 * @returns {boolean}
 */
export function isMarketDataReady(date = new Date()) {
  const taiwanHour = (date.getUTCHours() + TAIWAN_UTC_OFFSET_HOURS) % 24;
  return taiwanHour >= MARKET_DATA_READY_HOUR;
}

/**
 * 把日期物件轉成 YYYYMMDD 字串（給 TWSE API 的 date 參數用）
 */
export function formatDateParam(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * 產生「候選交易日」清單：從 referenceDate 往回推，跳過週六日。
 * 這只是粗略近似（沒有處理國定假日），實際交易日數量可能比 count 少，
 * 所以呼叫端要自己多要幾個候選日期，並依「實際回傳的日期」來判斷是否蒐集足夠。
 *
 * @param {Date} referenceDate
 * @param {number} count 要產生幾個候選日期
 * @returns {Date[]}
 */
export function getPastTradingDayCandidates(referenceDate, count) {
  const candidates = [];
  const cursor = new Date(referenceDate);
  cursor.setDate(cursor.getDate() - 1); // 從「前一天」開始往回推

  while (candidates.length < count) {
    if (!isWeekend(cursor) && !isExchangeHoliday(cursor)) {
      candidates.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() - 1);
  }

  return candidates;
}
