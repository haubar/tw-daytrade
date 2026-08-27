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
 *
 * 同時挑出 adv（高級 ORB 策略，見 backtest.mjs 的 evaluateOpenToCloseLong）的摘要——
 * 這個策略「沒突破觸發價」的天數會被 skip、不計入勝率分母，所以額外帶出
 * executedCount/selectedCount，讓前端能顯示「進場覆蓋率」，不讓使用者誤把
 * 「小樣本、高勝率」看成「策略本身很準」。
 * @param {Object|null} result
 * @returns {Object|null}
 */
export function summarizeBacktest(result) {
  if (!result) return null;
  // wonCount 直接從 trades 明細算，不要用 winRatePercent 反推（四捨五入後的百分比乘回去
  // 可能對不齊整數），這樣後面滾動勝率才能用「總勝場 ÷ 總場次」精確地跨多天彙總，
  // 而不是對每天的百分比取平均（那樣小樣本的日子會被跟大樣本的日子等權重看待）。
  const countWon = (trades) => (Array.isArray(trades) ? trades.filter((t) => t.netReturnPercent > 0).length : 0);
  return {
    executionDate: result.executionDate ?? null,
    executedCount: result.executedCount ?? 0,
    selectedCount: result.selectedCount ?? 0,
    wonCount: countWon(result.trades),
    netReturnPercent: result.netReturnPercent ?? null,
    winRatePercent: result.winRatePercent ?? null,
    adv: result.adv
      ? {
          executedCount: result.adv.executedCount ?? 0,
          selectedCount: result.adv.selectedCount ?? 0,
          wonCount: countWon(result.adv.trades),
          netReturnPercent: result.adv.netReturnPercent ?? null,
          winRatePercent: result.adv.winRatePercent ?? null,
        }
      : null,
  };
}

/**
 * 近 N 個「有回測資料」交易日的滾動彙總——基準策略跟高級策略分開算。
 *
 * 為什麼不是對每天的 winRatePercent 直接取平均：那樣「今天 10 檔全進場」跟
 * 「今天只有 2 檔突破觸發價進場」會被當成同樣的一票，小樣本的日子雜訊被拉到跟大樣本
 * 一樣重。改成「總勝場 ÷ 總進場場次」的併總勝率（pooled win rate），樣本數大的日子
 * 自然佔比較多權重，比較不會被少數幾天的極端小樣本誤導。
 *
 * 淨利用複利串接（把每天的「Top N 等權重單日報酬率」視為每天全部出清、隔天重新選股
 * 進場，逐日乘上 1+報酬率），近似「一路照著這個策略操作」的累積績效；不是嚴謹的
 * 資金曲線回測（沒有處理隔日缺報價、跳過交易的資金閒置問題），只作為方向性參考。
 *
 * @param {Array<{date: string, backtest: Object|null}>} items buildHistoryItems() 的結果，需為新到舊排序
 * @param {number[]} [windowSizes]
 * @returns {{base: Object, adv: Object}} 每個 window size 一組統計，key 為 `window${N}`
 */
export function computeRollingStats(items, windowSizes = [5, 20]) {
  const withBacktest = (items ?? []).filter((it) => it?.backtest);

  function summarizeWindow(days, pick) {
    let totalExecuted = 0;
    let totalWon = 0;
    let totalSelected = 0;
    let compoundFactor = 1;
    let daysWithTrades = 0;

    for (const day of days) {
      const s = pick(day.backtest);
      if (!s) continue;
      totalSelected += s.selectedCount ?? 0;
      if ((s.executedCount ?? 0) > 0) {
        totalExecuted += s.executedCount;
        totalWon += s.wonCount ?? 0;
        daysWithTrades += 1;
        if (typeof s.netReturnPercent === 'number' && Number.isFinite(s.netReturnPercent)) {
          compoundFactor *= 1 + s.netReturnPercent / 100;
        }
      }
    }

    return {
      tradingDays: days.length,
      daysWithTrades,
      executionCoveragePercent: totalSelected === 0 ? null : (totalExecuted / totalSelected) * 100,
      pooledWinRatePercent: totalExecuted === 0 ? null : (totalWon / totalExecuted) * 100,
      compoundNetReturnPercent: daysWithTrades === 0 ? null : (compoundFactor - 1) * 100,
    };
  }

  const result = { base: {}, adv: {} };
  for (const n of windowSizes) {
    const days = withBacktest.slice(0, n);
    result.base[`window${n}`] = summarizeWindow(days, (bt) => bt);
    result.adv[`window${n}`] = summarizeWindow(days, (bt) => bt.adv);
  }
  return result;
}

/**
 * 組出給「回填控制頁」用的過去 N 個交易日狀態清單：每一天標示有沒有回測結果。
 * @param {string[]} tradingDayDates 過去 N 個交易日（新到舊排序，'YYYY-MM-DD'）
 * @param {string[]} backtestDates 已經有回測結果的訊號日清單（不需要排序，只用來判斷有無）
 * @returns {Array<{date: string, hasBacktest: boolean}>}
 */
export function buildBackfillStatusItems(tradingDayDates, backtestDates) {
  const backtestSet = new Set(backtestDates ?? []);
  return (tradingDayDates ?? []).map((date) => ({
    date,
    hasBacktest: backtestSet.has(date),
  }));
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
