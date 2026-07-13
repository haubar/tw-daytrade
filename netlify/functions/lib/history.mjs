// netlify/functions/lib/history.mjs
//
// 抓取過去 N 個交易日的市場快照，組成「每檔股票的成交量歷史」，供量能異常因子使用。
//
// 關鍵限制（已用真實請求驗證過）：
// TWSE 歷史資料端點（www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY_ALL?date=YYYYMMDD）
// 的 date 參數不完全可靠——實測發現指定 2026-07-02，卻收到 2026-07-07 的資料。
// 因此這裡的策略是：發送請求後一定要從「回傳資料本身的日期欄位」確認實際拿到哪一天的資料，
// 不能只信任送出去的參數。重複日期或無法辨識的日期會被跳過，直到蒐集到足夠的獨立交易日。

import { parseCsv } from './csv.mjs';
import { normalizeTwseCsvRow, extractDateFromCsvRow, isTradableRow } from './normalize.mjs';

const HISTORY_URL_BASE = 'https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY_ALL';

/**
 * 把日期物件轉成 YYYYMMDD 字串（給 API 的 date 參數用）
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
    const dayOfWeek = cursor.getDay(); // 0=週日, 6=週六
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      candidates.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() - 1);
  }

  return candidates;
}

/**
 * 抓取單一候選日期的市場快照，回傳正規化後的資料 + 資料本身標示的實際日期。
 * @param {Date} dateParam
 */
async function fetchOneDay(dateParam) {
  const url = `${HISTORY_URL_BASE}?response=json&date=${formatDateParam(dateParam)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`歷史資料端點回應錯誤: HTTP ${res.status}`);
  }
  const text = await res.text();
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return { actualDate: null, quotes: [] };
  }
  const actualDate = extractDateFromCsvRow(rows[0]);
  const quotes = rows
    .map((r) => normalizeTwseCsvRow(r))
    .filter((q) => isTradableRow(q));
  return { actualDate, quotes };
}

/**
 * 抓取過去 N 個「獨立交易日」的成交量歷史，組成 code -> volumes[] 的 map。
 *
 * @param {number} targetDays 想要蒐集到的獨立交易日數量（例如 5）
 * @param {Date} [referenceDate] 參考日（預設今天），主要方便測試時固定日期
 * @param {number} [maxAttempts] 最多嘗試幾個候選日期，避免因為端點異常無限嘗試
 * @returns {Promise<{volumeHistory: Map<string, number[]>, datesUsed: string[]}>}
 */
export async function fetchVolumeHistory(targetDays = 5, referenceDate = new Date(), maxAttempts = 12) {
  const candidates = getPastTradingDayCandidates(referenceDate, maxAttempts);
  const volumeHistory = new Map();
  const datesUsed = [];

  for (const candidate of candidates) {
    if (datesUsed.length >= targetDays) break;

    let result;
    try {
      result = await fetchOneDay(candidate);
    } catch (e) {
      // 單一天請求失敗不影響整體流程，跳過繼續嘗試下一個候選日
      continue;
    }

    if (!result.actualDate || datesUsed.includes(result.actualDate)) {
      // 拿到重複日期（例如端點忽略了 date 參數），跳過避免重複計算
      continue;
    }

    datesUsed.push(result.actualDate);
    for (const q of result.quotes) {
      if (!volumeHistory.has(q.code)) volumeHistory.set(q.code, []);
      volumeHistory.get(q.code).push(q.volume);
    }
  }

  return { volumeHistory, datesUsed };
}
