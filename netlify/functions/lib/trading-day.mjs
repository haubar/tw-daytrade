// netlify/functions/lib/trading-day.mjs
//
// 共用的「交易日」相關邏輯：判斷是否為週末、產生候選交易日清單。
// 抽成獨立模組是因為 history.mjs（給 backfill-history.mjs 用）跟 scan.mjs 都需要判斷
// 「今天/某一天是不是交易日」，避免兩邊各自寫一份邏輯，容易長出不一致的行為
// （例如一邊用 getDay()、一邊用別的方式判斷週末，結果邊界情況對不起來）。
//
// 注意：這裡只排除週六日，沒有排除國定假日（例如過年、清明連假），
// 這是刻意的簡化——完整的台股交易日曆需要額外維護一份假日清單，
// 目前先用「跳過週末」處理最大宗的情況，遇到連假頂多是候選清單多跑幾輪、
// 不會產生錯誤結果（因為最終還是會用「回傳資料本身的日期」驗證，見 fetchOneDay）。

/**
 * 判斷某個日期是不是週六或週日
 * @param {Date} date
 * @returns {boolean}
 */
export function isWeekend(date) {
  const day = date.getDay(); // 0 = 週日, 6 = 週六
  return day === 0 || day === 6;
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
    if (!isWeekend(cursor)) {
      candidates.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() - 1);
  }

  return candidates;
}
