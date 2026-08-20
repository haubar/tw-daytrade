import { DEFAULT_HISTORY_WINDOW_DAYS } from './volume-archive.mjs';

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
