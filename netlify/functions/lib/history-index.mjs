// netlify/functions/lib/history-index.mjs
//
// history-index.mjs（Netlify Function）用到的純函式，拆出來方便測試，不用真的連 Blobs。

/**
 * 合併「有每日快照的日期」跟「有回測結果的日期」成一份新到舊排序的日期清單（聯集，不是交集）。
 * @param {string[]} archivedDates 'YYYY-MM-DD'
 * @param {string[]} backtestDates 'YYYY-MM-DD'
 * @returns {string[]} 新到舊排序、去重後的日期清單
 */
export function mergeDateLists(archivedDates, backtestDates) {
  const all = [...new Set([...(archivedDates ?? []), ...(backtestDates ?? [])])];
  return all.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

/**
 * 從完整的回測結果裡挑出給列表用的摘要欄位，不整包塞進列表回應
 * （列表本身可能有上百筆，只需要知道「這天回測結果好不好」，不需要完整 trades 明細）。
 * @param {Object|null} result
 * @returns {Object|null}
 */
export function summarizeBacktest(result) {
  if (!result) return null;
  return {
    executionDate: result.executionDate ?? null,
    executedCount: result.executedCount ?? 0,
    selectedCount: result.selectedCount ?? 0,
    netReturnPercent: result.netReturnPercent ?? null,
    winRatePercent: result.winRatePercent ?? null,
  };
}

/**
 * 組出最終要回傳給前端的歷史資料列表項目。
 * @param {string[]} allDates mergeDateLists() 的結果
 * @param {string[]} archivedDates
 * @param {Map<string, Object|null>} backtestSummaryByDate
 * @returns {Array<{date: string, hasDailySnapshot: boolean, backtest: Object|null}>}
 */
export function buildHistoryItems(allDates, archivedDates, backtestSummaryByDate) {
  const archivedSet = new Set(archivedDates ?? []);
  return (allDates ?? []).map((date) => ({
    date,
    hasDailySnapshot: archivedSet.has(date),
    backtest: backtestSummaryByDate?.get(date) ?? null,
  }));
}
