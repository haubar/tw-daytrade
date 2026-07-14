// netlify/functions/lib/history.mjs
//
// 抓取過去 N 個交易日的市場快照，組成「每檔股票的成交量歷史」，供量能異常因子使用。
// 這支模組的即時多天抓取邏輯目前只被 backfill-history.mjs 使用（scan.mjs 已改成讀
// volume-archive.mjs 的 Blobs 累積庫，見階段 15 的架構調整）。
//
// 關鍵限制（已用真實請求驗證過）：
// TWSE 歷史資料端點（www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY_ALL?date=YYYYMMDD）
// 的 date 參數不完全可靠——實測發現指定 2026-07-02，卻收到 2026-07-07 的資料。
// 因此這裡的策略是：發送請求後一定要從「回傳資料本身的日期欄位」確認實際拿到哪一天的資料，
// 不能只信任送出去的參數。重複日期或無法辨識的日期會被跳過，直到蒐集到足夠的獨立交易日。
//
// 交易日判斷（跳過週六日）的邏輯抽到 trading-day.mjs，這裡重新匯出方便舊有呼叫端跟測試沿用。

import { parseCsv } from './csv.mjs';
import { normalizeTwseCsvRow, extractDateFromCsvRow, isTradableRow } from './normalize.mjs';
import { formatDateParam, getPastTradingDayCandidates } from './trading-day.mjs';

export { formatDateParam, getPastTradingDayCandidates };

const HISTORY_URL_BASE = 'https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY_ALL';

/**
 * 抓取單一候選日期的市場快照，回傳正規化後的資料 + 資料本身標示的實際日期。
 * 加上請求逾時保護（8 秒）：Netlify Function 本身的執行時間就有硬性上限，
 * 單一個候選日期的請求如果卡住不回應，不該讓它拖垮整個預算。
 * 開放匯出給 backfill-history.mjs 使用，讓它可以針對「特定候選日期」個別抓取，
 * 而不是只能用 fetchVolumeHistory 那種「抓最近 N 天」的固定邏輯。
 * @param {Date} dateParam
 */
export async function fetchOneDay(dateParam) {
  // 加上一個每次都不同的參數（cache-busting），強迫繞過可能存在的 CDN 快取。
  // 背景：實測發現不管 date 參數送哪一天，回傳的資料永遠是同一天（最新的），
  // 懷疑是 TWSE 前面的 CDN 快取沒有把 date 參數算進快取鍵值，導致大家都拿到同一份快取結果。
  const cacheBuster = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const url = `${HISTORY_URL_BASE}?response=json&date=${formatDateParam(dateParam)}&_=${cacheBuster}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
  });
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
 * 效能筆記：這裡刻意把候選日期的請求「全部平行發出」，而不是一天一天序列等待。
 * 部署到 Netlify 後實測發現序列版本會讓整個 function 超過 Netlify Function 的執行時間上限
 * （逾時 30 秒，錯誤訊息只會顯示籠統的「unknown error」，不會直接告訴你是逾時）。
 * 平行發出後，總等待時間變成「最慢那一個請求的時間」，而不是「所有請求時間的總和」。
 *
 * @param {number} targetDays 想要蒐集到的獨立交易日數量（預設 3）
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
