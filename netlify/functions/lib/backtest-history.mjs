import { DEFAULT_HISTORY_WINDOW_DAYS } from './volume-archive.mjs';
import { formatIsoDate } from './trading-day.mjs';

/**
 * 將「由近到遠」排序的交易日快照排成回測窗口。
 * 每個窗口包含：訊號日、隔日執行行情與訊號日前 N 日量能資料。
 * 第一個日期只能作為最新訊號日的執行日，最後 N 天只能當歷史基準，故不會各自產生交易。
 */
export function buildHistoricalBacktestWindows(daysNewestFirst, historyDays = DEFAULT_HISTORY_WINDOW_DAYS) {
  const windows = [];
  for (let signalIndex = 1; signalIndex + historyDays < daysNewestFirst.length; signalIndex += 1) {
    windows.push({
      execution: daysNewestFirst[signalIndex - 1],
      signal: daysNewestFirst[signalIndex],
      history: daysNewestFirst.slice(signalIndex + 1, signalIndex + 1 + historyDays),
    });
  }
  return windows;
}

export function parseBacktestDays(value, fallback = 3, max = 3) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) return fallback;
  return parsed;
}

export function parseCursorDate(value) {
  if (!value) return new Date();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 算出下一次回填要用的 endDate。
 *
 * 真實發生過的 bug：這批候選日期如果一個完整窗口都沒湊出來（常見原因是 TWSE 逾時，導致
 * 成功抓到的天數不夠形成窗口，見 backfill-backtest.mjs 的 debugInfo），原本的寫法會讓
 * nextEndDate 變成 null，使用者不知道下次要從哪個日期繼續打，回填流程直接卡死——重打同一個
 * endDate，遇到的還是同樣容易逾時的那幾天，不一定會有幫助。
 *
 * 修法：不管這批候選裡有沒有湊出任何窗口，都退回用「這批候選裡最舊的那一天」當下一次的
 * endDate，確保永遠有辦法往前推進到下一批全新的候選日期，不會卡在原地。
 *
 * @param {Array<{signal: {date: string}}>} windows 這次成功湊出的回測窗口
 * @param {Date[]} candidates 這次嘗試抓取的候選交易日（由近到遠排序）
 * @returns {string|null} 'YYYY-MM-DD'，candidates 也是空的時候回傳 null
 */
export function computeNextEndDate(windows, candidates) {
  const oldestWindow = windows.at(-1);
  if (oldestWindow) return oldestWindow.signal.date;
  return candidates.length > 0 ? formatIsoDate(candidates.at(-1)) : null;
}
