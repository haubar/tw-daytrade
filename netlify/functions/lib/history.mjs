// netlify/functions/lib/history.mjs
//
// 抓取過去 N 個交易日的市場快照，組成「每檔股票的成交量歷史」，供量能異常因子使用。
//
// 關鍵限制（已用真實請求驗證過）：
// TWSE 歷史資料端點（www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY_ALL?date=YYYYMMDD）
// 的 date 參數不完全可靠——實測發現指定 2026-07-02，卻收到 2026-07-07 的資料。
// 因此這裡的策略是：發送請求後一定要從「回傳資料本身的日期欄位」確認實際拿到哪一天的資料，
// 不能只信任送出去的參數。重複日期或無法辨識的日期會被跳過，直到蒐集到足夠的獨立交易日。
//
// 效能限制（部署到 Netlify 後實測發現）：
// scan.mjs 因為有 export const config = { schedule }，屬於 Netlify 的 Scheduled Function，
// 這類 function 不管用什麼方式呼叫，執行時間上限固定是 30 秒，跟付費方案無關。
// 抓歷史資料是整個流程裡最花時間的部分（要對同一個端點發出多筆全市場資料的請求），
// 所以這裡把預設抓取天數從原本規劃的 5 天降到 3 天、候選嘗試次數從 12 降到 6，
// 用「均量統計基礎稍微變小」換取「大幅降低逾時風險」。之後如果確認有更多執行時間餘裕，
// 或者改成把歷史資料改成每日累積存進 Netlify Blobs（不用每次都重新抓好幾天），
// 可以再把天數調回來。

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
 * 加上請求逾時保護（8 秒）：Netlify Function 本身的執行時間就有硬性上限，
 * 單一個候選日期的請求如果卡住不回應，不該讓它拖垮整個 fetchVolumeHistory 的預算。
 * @param {Date} dateParam
 */
async function fetchOneDay(dateParam) {
  const url = `${HISTORY_URL_BASE}?response=json&date=${formatDateParam(dateParam)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
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
/**
 * 抓取過去 N 個「獨立交易日」的成交量歷史，組成 code -> volumes[] 的 map。
 *
 * 效能筆記：這裡刻意把候選日期的請求「全部平行發出」，而不是一天一天序列等待。
 * 部署到 Netlify 後實測發現序列版本會讓整個 scan.mjs 超過 Netlify Function 的執行時間上限
 * （逾時 30 秒，錯誤訊息只會顯示籠統的「unknown error」，不會直接告訴你是逾時）。
 * 平行發出後，總等待時間變成「最慢那一個請求的時間」，而不是「所有請求時間的總和」。
 *
 * @param {number} targetDays 想要蒐集到的獨立交易日數量（預設 3，見下方效能筆記）
 * @param {Date} [referenceDate] 參考日（預設今天），主要方便測試時固定日期
 * @param {number} [maxAttempts] 最多嘗試幾個候選日期，避免因為端點異常或重複日期導致蒐集不到足夠天數（預設 6）
 * @returns {Promise<{volumeHistory: Map<string, number[]>, datesUsed: string[]}>}
 */
export async function fetchVolumeHistory(targetDays = 3, referenceDate = new Date(), maxAttempts = 6) {
  const candidates = getPastTradingDayCandidates(referenceDate, maxAttempts);

  // 全部候選日期一次平行發出，不等前一個回來才發下一個
  const settledResults = await Promise.allSettled(candidates.map((candidate) => fetchOneDay(candidate)));

  const volumeHistory = new Map();
  const datesUsed = [];

  // 依候選日期原本的順序（由近到遠）處理結果，確保「同一份候選清單」不管有沒有平行化，
  // 篩出來的 datesUsed 順序都一致，方便測試跟除錯時判斷行為有沒有跑掉。
  for (const settled of settledResults) {
    if (datesUsed.length >= targetDays) break;
    if (settled.status !== 'fulfilled') continue; // 單一天請求失敗不影響整體流程，跳過

    const result = settled.value;
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
