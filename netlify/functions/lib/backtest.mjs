// netlify/functions/lib/backtest.mjs
// D 日盤後訊號，D+1 執行。
// Baseline 可由 daily open/close 精確描述；Advanced 使用 daily OHLC proxy，
// 因日 K 無法知道 High/Low/trigger 的盤中先後，相關交易會標記 pathAmbiguous。

export const DEFAULT_TOP_N = 10;
export const DEFAULT_COMMISSION_RATE = 0.001425;
export const DEFAULT_DAY_TRADE_TAX_RATE = 0.0015;
export const DEFAULT_SLIPPAGE_RATE = 0;

function validPrice(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function average(trades, field) {
  return trades.length === 0 ? null : trades.reduce((sum, trade) => sum + trade[field], 0) / trades.length;
}

function summarizeTrades(trades, selectedCount) {
  const wins = trades.filter((t) => t.netReturnPercent > 0);
  const losses = trades.filter((t) => t.netReturnPercent < 0);
  const grossProfit = wins.reduce((s, t) => s + t.netReturnPercent, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netReturnPercent, 0));

  return {
    triggerRatePercent: selectedCount === 0 ? null : (trades.length / selectedCount) * 100,
    averageWinPercent: wins.length ? average(wins, 'netReturnPercent') : null,
    averageLossPercent: losses.length ? average(losses, 'netReturnPercent') : null,
    expectancyPercent: trades.length ? average(trades, 'netReturnPercent') : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? null : 0),
  };
}

function longFill(price, slippageRate, isEntry) {
  return price * (isEntry ? 1 + slippageRate : 1 - slippageRate);
}

function shortFill(price, slippageRate, isEntry) {
  return price * (isEntry ? 1 - slippageRate : 1 + slippageRate);
}

export function evaluateOpenToCloseLong(signalItems, executionQuotes, options = {}) {
  const {
    topN = DEFAULT_TOP_N,
    commissionRate = DEFAULT_COMMISSION_RATE,
    taxRate = DEFAULT_DAY_TRADE_TAX_RATE,
    slippageRate = DEFAULT_SLIPPAGE_RATE,
    unavailableMarkets = new Set(),
  } = options;

  const quoteByCode = new Map((executionQuotes ?? []).map((quote) => [quote.code, quote]));
  const selected = (signalItems ?? []).slice(0, topN).filter((item) => item?.code && item.dayTradeEligible !== false);
  const skipped = [];
  const trades = [];

  for (const item of selected) {
    const quote = quoteByCode.get(item.code);
    if (!quote || !validPrice(quote.open) || !validPrice(quote.close)) {
      const reason = item.market && unavailableMarkets.has(item.market)
        ? `執行日當天「${item.market}」市場資料抓取失敗，非個股本身問題`
        : '缺少有效的隔日開盤或收盤價格';
      skipped.push({ code: item.code, reason });
      continue;
    }

    const entryPrice = longFill(quote.open, slippageRate, true);
    const exitPrice = longFill(quote.close, slippageRate, false);
    const grossReturnPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
    const netReturnPercent = (((exitPrice * (1 - commissionRate - taxRate)) / (entryPrice * (1 + commissionRate))) - 1) * 100;

    trades.push({
      code: item.code,
      name: item.name ?? quote.name ?? '',
      entryPrice,
      exitPrice,
      grossReturnPercent,
      netReturnPercent,
    });
  }

  const baseResult = {
    strategy: 'long-open-to-close-equal-weight',
    configuredTopN: topN,
    selectedCount: selected.length,
    executedCount: trades.length,
    skipped,
    commissionRate,
    taxRate,
    slippageRate,
    grossReturnPercent: average(trades, 'grossReturnPercent'),
    netReturnPercent: average(trades, 'netReturnPercent'),
    winRatePercent: trades.length === 0 ? null : (trades.filter((trade) => trade.netReturnPercent > 0).length / trades.length) * 100,
    trades,
  };

  const advTrades = [];
  const advSkipped = [];

  for (const item of selected) {
    const quote = quoteByCode.get(item.code);
    if (!quote || !validPrice(quote.open) || !validPrice(quote.close)) {
      const reason = item.market && unavailableMarkets.has(item.market)
        ? `執行日當天「${item.market}」市場資料抓取失敗，非個股本身問題`
        : '缺少有效的隔日開盤或收盤價格';
      advSkipped.push({ code: item.code, reason });
      continue;
    }

    const { open, high, low, close } = quote;
    if (!validPrice(high) || !validPrice(low)) {
      advSkipped.push({ code: item.code, reason: '缺少有效的隔日最高或最低價格，無法執行 OHLC proxy 策略' });
      continue;
    }

    const rawEntryPrice = Math.round(open * 1.015 * 100) / 100;
    if (high < rawEntryPrice) {
      advSkipped.push({ code: item.code, reason: '未達到盤中動能觸發價 (未破高)' });
      continue;
    }

    const stopLossPrice = Math.round(open * 0.99 * 100) / 100;
    let rawExitPrice = close;
    let exitReason = '收盤強制平倉';
    let pathAmbiguous = false;

    if (low <= stopLossPrice) {
      rawExitPrice = stopLossPrice;
      exitReason = '觸發盤中硬性止損';
      pathAmbiguous = true;
    } else if (high >= open * 1.035) {
      rawExitPrice = Math.round(open * 1.02 * 100) / 100;
      exitReason = '觸發保本/移動止盈';
      pathAmbiguous = true;
    }

    const entryPrice = longFill(rawEntryPrice, slippageRate, true);
    const exitPrice = longFill(rawExitPrice, slippageRate, false);
    const grossReturnPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
    const netReturnPercent = (((exitPrice * (1 - commissionRate - taxRate)) / (entryPrice * (1 + commissionRate))) - 1) * 100;

    advTrades.push({
      code: item.code,
      name: item.name ?? quote.name ?? '',
      entryPrice,
      exitPrice,
      exitReason,
      pathAmbiguous,
      backtestQuality: pathAmbiguous ? 'daily-ohlc-path-ambiguous' : 'daily-ohlc-proxy',
      grossReturnPercent,
      netReturnPercent,
    });
  }

  baseResult.adv = {
    strategy: 'long-high-winrate-orb',
    selectedCount: selected.length,
    executedCount: advTrades.length,
    skippedCount: advSkipped.length,
    skipped: advSkipped,
    grossReturnPercent: average(advTrades, 'grossReturnPercent'),
    netReturnPercent: average(advTrades, 'netReturnPercent'),
    winRatePercent: advTrades.length === 0 ? null : (advTrades.filter((trade) => trade.netReturnPercent > 0).length / advTrades.length) * 100,
    ...summarizeTrades(advTrades, selected.length),
    ambiguousTradeCount: advTrades.filter((trade) => trade.pathAmbiguous).length,
    backtestQuality: 'daily-ohlc-proxy',
    trades: advTrades,
  };

  return baseResult;
}

export function evaluateOpenToCloseShort(signalItems, executionQuotes, options = {}) {
  const {
    topN = DEFAULT_TOP_N,
    commissionRate = DEFAULT_COMMISSION_RATE,
    taxRate = DEFAULT_DAY_TRADE_TAX_RATE,
    slippageRate = DEFAULT_SLIPPAGE_RATE,
    unavailableMarkets = new Set(),
  } = options;

  const quoteByCode = new Map((executionQuotes ?? []).map((quote) => [quote.code, quote]));
  const selected = (signalItems ?? []).slice(0, topN).filter((item) => item?.code && item.dayTradeEligible !== false);
  const skipped = [];
  const trades = [];

  for (const item of selected) {
    const quote = quoteByCode.get(item.code);
    if (!quote || !validPrice(quote.open) || !validPrice(quote.close)) {
      const reason = item.market && unavailableMarkets.has(item.market)
        ? `執行日當天「${item.market}」市場資料抓取失敗，非個股本身問題`
        : '缺少有效的隔日開盤或收盤價格';
      skipped.push({ code: item.code, reason });
      continue;
    }

    const entryPrice = shortFill(quote.open, slippageRate, true);
    const exitPrice = shortFill(quote.close, slippageRate, false);
    const grossReturnPercent = ((entryPrice - exitPrice) / entryPrice) * 100;
    const netReturnPercent = (((entryPrice * (1 - commissionRate - taxRate)) - exitPrice * (1 + commissionRate)) / (entryPrice * (1 + commissionRate))) * 100;

    trades.push({
      code: item.code,
      name: item.name ?? quote.name ?? '',
      entryPrice,
      exitPrice,
      grossReturnPercent,
      netReturnPercent,
    });
  }

  const baseResult = {
    strategy: 'short-open-to-close-equal-weight',
    configuredTopN: topN,
    selectedCount: selected.length,
    executedCount: trades.length,
    skipped,
    commissionRate,
    taxRate,
    slippageRate,
    grossReturnPercent: average(trades, 'grossReturnPercent'),
    netReturnPercent: average(trades, 'netReturnPercent'),
    winRatePercent: trades.length === 0 ? null : (trades.filter((trade) => trade.netReturnPercent > 0).length / trades.length) * 100,
    trades,
  };

  const advTrades = [];
  const advSkipped = [];

  for (const item of selected) {
    const quote = quoteByCode.get(item.code);
    if (!quote || !validPrice(quote.open) || !validPrice(quote.close)) {
      const reason = item.market && unavailableMarkets.has(item.market)
        ? `執行日當天「${item.market}」市場資料抓取失敗，非個股本身問題`
        : '缺少有效的隔日開盤或收盤價格';
      advSkipped.push({ code: item.code, reason });
      continue;
    }

    const { open, high, low, close } = quote;
    if (!validPrice(high) || !validPrice(low)) {
      advSkipped.push({ code: item.code, reason: '缺少有效的隔日最高或最低價格，無法執行 OHLC proxy 策略' });
      continue;
    }

    const rawEntryPrice = Math.round(open * 0.985 * 100) / 100;
    if (low > rawEntryPrice) {
      advSkipped.push({ code: item.code, reason: '未達到盤中動能觸發價 (未破低)' });
      continue;
    }

    const stopLossPrice = Math.round(open * 1.01 * 100) / 100;
    let rawExitPrice = close;
    let exitReason = '收盤強制平倉';
    let pathAmbiguous = false;

    if (high >= stopLossPrice) {
      rawExitPrice = stopLossPrice;
      exitReason = '觸發盤中硬性止損';
      pathAmbiguous = true;
    } else if (low <= open * 0.965) {
      rawExitPrice = Math.round(open * 0.98 * 100) / 100;
      exitReason = '觸發保本/移動止盈';
      pathAmbiguous = true;
    }

    const entryPrice = shortFill(rawEntryPrice, slippageRate, true);
    const exitPrice = shortFill(rawExitPrice, slippageRate, false);
    const grossReturnPercent = ((entryPrice - exitPrice) / entryPrice) * 100;
    const netReturnPercent = (((entryPrice * (1 - commissionRate - taxRate)) - exitPrice * (1 + commissionRate)) / (entryPrice * (1 + commissionRate))) * 100;

    advTrades.push({
      code: item.code,
      name: item.name ?? quote.name ?? '',
      entryPrice,
      exitPrice,
      exitReason,
      pathAmbiguous,
      backtestQuality: pathAmbiguous ? 'daily-ohlc-path-ambiguous' : 'daily-ohlc-proxy',
      grossReturnPercent,
      netReturnPercent,
    });
  }

  baseResult.adv = {
    strategy: 'short-high-winrate-orb',
    selectedCount: selected.length,
    executedCount: advTrades.length,
    skippedCount: advSkipped.length,
    skipped: advSkipped,
    grossReturnPercent: average(advTrades, 'grossReturnPercent'),
    netReturnPercent: average(advTrades, 'netReturnPercent'),
    winRatePercent: advTrades.length === 0 ? null : (advTrades.filter((trade) => trade.netReturnPercent > 0).length / advTrades.length) * 100,
    ...summarizeTrades(advTrades, selected.length),
    ambiguousTradeCount: advTrades.filter((trade) => trade.pathAmbiguous).length,
    backtestQuality: 'daily-ohlc-proxy',
    trades: advTrades,
  };

  return baseResult;
}
