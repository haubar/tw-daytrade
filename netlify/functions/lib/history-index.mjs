// netlify/functions/lib/history-index.mjs
//
// history-index.mjs（Netlify Function）用到的純函式。

export function mergeDateLists(archivedDates, backtestDates) {
  const all = [...new Set([...(archivedDates ?? []), ...(backtestDates ?? [])])];
  return all.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

export function summarizeBacktest(result) {
  if (!result) return null;

  const countWon = (trades) => (Array.isArray(trades) ? trades.filter((t) => t.netReturnPercent > 0).length : 0);
  const tradeReturns = (trades) => Array.isArray(trades)
    ? trades.map((t) => t.netReturnPercent).filter((v) => typeof v === 'number' && Number.isFinite(v))
    : [];

  const summarizeSide = (side) => {
    if (!side) return null;
    const summary = {
      executedCount: side.executedCount ?? 0,
      selectedCount: side.selectedCount ?? 0,
      wonCount: countWon(side.trades),
      netReturnPercent: side.netReturnPercent ?? null,
      winRatePercent: side.winRatePercent ?? null,
      tradeReturns: tradeReturns(side.trades),
      adv: null,
    };

    if (side.adv) {
      summary.adv = {
        executedCount: side.adv.executedCount ?? 0,
        selectedCount: side.adv.selectedCount ?? 0,
        wonCount: countWon(side.adv.trades),
        netReturnPercent: side.adv.netReturnPercent ?? null,
        winRatePercent: side.adv.winRatePercent ?? null,
        triggerRatePercent: side.adv.triggerRatePercent ?? (
          (side.adv.selectedCount ?? 0) > 0
            ? ((side.adv.executedCount ?? 0) / side.adv.selectedCount) * 100
            : null
        ),
        tradeReturns: tradeReturns(side.adv.trades),
        ambiguousTradeCount: side.adv.ambiguousTradeCount ?? 0,
        backtestQuality: side.adv.backtestQuality ?? null,
      };
    }
    return summary;
  };

  const longSummary = summarizeSide(result.long || result);
  const shortSummary = summarizeSide(result.short);

  return {
    executionDate: result.executionDate ?? null,
    executedCount: longSummary.executedCount,
    selectedCount: longSummary.selectedCount,
    wonCount: longSummary.wonCount,
    netReturnPercent: longSummary.netReturnPercent,
    winRatePercent: longSummary.winRatePercent,
    adv: longSummary.adv,
    long: longSummary,
    short: shortSummary,
  };
}

export function computeRollingStats(items, windowSizes = [5, 20, 30]) {
  const withBacktest = (items ?? []).filter((it) => it?.backtest);

  function summarizeWindow(days, pick) {
    let totalExecuted = 0;
    let totalWon = 0;
    let totalSelected = 0;
    let compoundFactor = 1;
    let daysWithTrades = 0;
    let equity = 1;
    let peak = 1;
    let maxDrawdown = 0;
    let totalTradeReturn = 0;
    let totalTradeCount = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    const dailyReturns = [];

    // items 是新到舊；風險曲線必須按時間正序計算。
    const chronologicalDays = [...days].reverse();

    for (const day of chronologicalDays) {
      const s = pick(day.backtest);
      if (!s) continue;

      totalSelected += s.selectedCount ?? 0;
      if ((s.executedCount ?? 0) <= 0) continue;

      totalExecuted += s.executedCount;
      totalWon += s.wonCount ?? 0;
      daysWithTrades += 1;

      if (typeof s.netReturnPercent === 'number' && Number.isFinite(s.netReturnPercent)) {
        const dailyReturn = s.netReturnPercent / 100;
        compoundFactor *= 1 + dailyReturn;
        dailyReturns.push(dailyReturn);

        equity *= 1 + dailyReturn;
        peak = Math.max(peak, equity);
        maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
      }

      for (const r of s.tradeReturns ?? []) {
        if (!Number.isFinite(r)) continue;
        totalTradeReturn += r;
        totalTradeCount += 1;
        if (r > 0) grossProfit += r;
        else if (r < 0) grossLoss += Math.abs(r);
      }
    }

    const mean = dailyReturns.length
      ? dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length
      : null;

    const variance = dailyReturns.length > 1
      ? dailyReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (dailyReturns.length - 1)
      : null;

    const stdDev = variance === null ? null : Math.sqrt(variance);

    return {
      tradingDays: days.length,
      daysWithTrades,
      executionCoveragePercent: totalSelected === 0 ? null : (totalExecuted / totalSelected) * 100,
      pooledWinRatePercent: totalExecuted === 0 ? null : (totalWon / totalExecuted) * 100,
      compoundNetReturnPercent: daysWithTrades === 0 ? null : (compoundFactor - 1) * 100,
      maxDrawdownPercent: daysWithTrades === 0 ? null : maxDrawdown * 100,
      sharpeRatioAnnualized: stdDev && stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : null,
      expectancyPercent: totalTradeCount ? totalTradeReturn / totalTradeCount : null,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? null : 0),
      sampleReady: days.length >= 20,
    };
  }

  const result = {
    base: {},
    adv: {},
    long: { base: {}, adv: {} },
    short: { base: {}, adv: {} },
  };

  for (const n of windowSizes) {
    const days = withBacktest.slice(0, n);
    result.base[`window${n}`] = summarizeWindow(days, (bt) => bt.long || bt);
    result.adv[`window${n}`] = summarizeWindow(days, (bt) => (bt.long || bt).adv);
    result.long.base[`window${n}`] = summarizeWindow(days, (bt) => bt.long || bt);
    result.long.adv[`window${n}`] = summarizeWindow(days, (bt) => (bt.long || bt).adv);
    result.short.base[`window${n}`] = summarizeWindow(days, (bt) => bt.short);
    result.short.adv[`window${n}`] = summarizeWindow(days, (bt) => bt.short?.adv);
  }

  return result;
}

export function buildBackfillStatusItems(tradingDayDates, backtestDates) {
  const backtestSet = new Set(backtestDates ?? []);
  return (tradingDayDates ?? []).map((date) => ({
    date,
    hasBacktest: backtestSet.has(date),
  }));
}

export function buildHistoryItems(allDates, archivedDates, backtestSummaryByDate) {
  const archivedSet = new Set(archivedDates ?? []);
  return (allDates ?? []).map((date) => ({
    date,
    hasDailySnapshot: archivedSet.has(date),
    backtest: backtestSummaryByDate?.get(date) ?? null,
  }));
}
