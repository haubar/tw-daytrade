// 將盤後多方觀察榜轉為可驗證的「隔日開盤買、收盤賣」基準策略績效。
//
// 訊號日 D 收盤後才知道觀察榜，故只能在 D+1 開盤進場；本模組只處理
// 已知的成交價格與成本，不假設盤中成交順序、停損或槓桿。

export const DEFAULT_TOP_N = 10;
// 手續費實際折扣因券商與帳戶而異；以證交所標準費率作保守基準。
export const DEFAULT_COMMISSION_RATE = 0.001425;
// 現股當沖股票的證交稅優惠稅率，現行適用至 2027-12-31。
export const DEFAULT_DAY_TRADE_TAX_RATE = 0.0015;

function validPrice(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * 以等權重計算訊號日的多方榜，在執行日開盤買入、收盤賣出的單日績效。
 * @param {Array<{code:string, name?:string, market?:string, dayTradeEligible?:boolean|null}>} signalItems
 * @param {Array<{code:string, name?:string, open:number, close:number}>} executionQuotes
 * @param {{topN?:number, commissionRate?:number, taxRate?:number, unavailableMarkets?:Set<string>}} [options]
 *   unavailableMarkets：今天（執行日）完全抓不到報價的市場別（例如 TPEx 端點逾時失敗時傳入
 *   new Set(['TPEx'])）。這是實際發生過的真實情況：昨天選出的多方榜如果剛好都是上櫃股票，
 *   而今天上櫃資料源整個抓取失敗，這些股票在 executionQuotes 裡當然找不到報價，但這跟
 *   「這幾檔股票本身資料異常」是完全不同的原因——前者是系統性、當天全市場都受影響，
 *   後者才是真的要去查那一檔股票本身怎麼了。分開標示避免使用者誤判成個股層級的問題。
 */
export function evaluateOpenToCloseLong(signalItems, executionQuotes, options = {}) {
  const {
    topN = DEFAULT_TOP_N,
    commissionRate = DEFAULT_COMMISSION_RATE,
    taxRate = DEFAULT_DAY_TRADE_TAX_RATE,
    unavailableMarkets = new Set(),
  } = options;

  const quoteByCode = new Map((executionQuotes ?? []).map((quote) => [quote.code, quote]));
  // 先固定訊號榜的 Top N，再移除無法現股當沖者；不以第 N+1 名遞補，
  // 才不會把「Top N 策略」悄悄變成另一套策略。
  const selected = (signalItems ?? [])
    .slice(0, topN)
    .filter((item) => item?.code && item.dayTradeEligible !== false);
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

    const grossReturnPercent = ((quote.close - quote.open) / quote.open) * 100;
    // 等權重的報酬率應以「買入總成本」為分母，故把進出成本都納入價格比值。
    const netReturnPercent = (((quote.close * (1 - commissionRate - taxRate)) / (quote.open * (1 + commissionRate))) - 1) * 100;
    trades.push({
      code: item.code,
      name: item.name ?? quote.name ?? '',
      entryPrice: quote.open,
      exitPrice: quote.close,
      grossReturnPercent,
      netReturnPercent,
    });
  }

  const average = (field) => trades.length === 0 ? null : trades.reduce((sum, trade) => sum + trade[field], 0) / trades.length;
  
  const baseResult = {
    strategy: 'long-open-to-close-equal-weight',
    configuredTopN: topN,
    selectedCount: selected.length,
    executedCount: trades.length,
    skipped,
    commissionRate,
    taxRate,
    grossReturnPercent: average('grossReturnPercent'),
    netReturnPercent: average('netReturnPercent'),
    winRatePercent: trades.length === 0 ? null : (trades.filter((trade) => trade.netReturnPercent > 0).length / trades.length) * 100,
    trades,
  };

  // 新增高級當沖策略計算 (動態止損與突破確認)
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
    
    // 盤中進場觸發價：開盤價 + 1.5% (模擬向上突破早盤高點)
    const triggerBuyPrice = Math.round(open * 1.015 * 100) / 100;
    
    // 如果當天最高價根本沒達到觸發價，代表動能未確認，今天「不進場」
    if (high < triggerBuyPrice) {
      advSkipped.push({ code: item.code, reason: '未達到盤中動能觸發價 (未破高)' });
      continue;
    }

    // 進場後的止損價：開盤價 - 1.0% (極速止損)
    const stopLossPrice = Math.round(open * 0.99 * 100) / 100;
    
    let exitPrice = close;
    let exitReason = '收盤強制平倉';

    // 模擬盤中走勢的保守假設：
    // 1. 若當天最低價低於止損價，且我們是在觸發後才遇到最低點（保守估計為觸發止損）
    if (low <= stopLossPrice) {
      exitPrice = stopLossPrice;
      exitReason = '觸發盤中硬性止損';
    } 
    // 2. 模擬移動止盈：若盤中最高價曾達到開盤 +3.5% 以上，啟動保本/移動止盈，在回踩時以 +2.0% 出場
    else if (high >= open * 1.035) {
      exitPrice = Math.round(open * 1.02 * 100) / 100;
      exitReason = '觸發保本/移動止盈';
    }

    const grossReturnPercent = ((exitPrice - triggerBuyPrice) / triggerBuyPrice) * 100;
    const netReturnPercent = (((exitPrice * (1 - commissionRate - taxRate)) / (triggerBuyPrice * (1 + commissionRate))) - 1) * 100;

    advTrades.push({
      code: item.code,
      name: item.name ?? quote.name ?? '',
      entryPrice: triggerBuyPrice,
      exitPrice,
      exitReason,
      grossReturnPercent,
      netReturnPercent,
    });
  }

  const advAverage = (field) => advTrades.length === 0 ? null : advTrades.reduce((sum, trade) => sum + trade[field], 0) / advTrades.length;

  baseResult.adv = {
    strategy: 'long-high-winrate-orb',
    selectedCount: selected.length,
    executedCount: advTrades.length,
    skippedCount: advSkipped.length,
    skipped: advSkipped,
    grossReturnPercent: advAverage('grossReturnPercent'),
    netReturnPercent: advAverage('netReturnPercent'),
    winRatePercent: advTrades.length === 0 ? null : (advTrades.filter((trade) => trade.netReturnPercent > 0).length / advTrades.length) * 100,
    trades: advTrades,
  };

  return baseResult;
}

/**
 * 以等權重計算訊號日的空方榜，在執行日開盤賣出（放空）、收盤買入（回補）的單日績效。
 * @param {Array<{code:string, name?:string, market?:string, dayTradeEligible?:boolean|null}>} signalItems
 * @param {Array<{code:string, name?:string, open:number, close:number}>} executionQuotes
 * @param {{topN?:number, commissionRate?:number, taxRate?:number, unavailableMarkets?:Set<string>}} [options]
 */
export function evaluateOpenToCloseShort(signalItems, executionQuotes, options = {}) {
  const {
    topN = DEFAULT_TOP_N,
    commissionRate = DEFAULT_COMMISSION_RATE,
    taxRate = DEFAULT_DAY_TRADE_TAX_RATE,
    unavailableMarkets = new Set(),
  } = options;

  const quoteByCode = new Map((executionQuotes ?? []).map((quote) => [quote.code, quote]));
  const selected = (signalItems ?? [])
    .slice(0, topN)
    .filter((item) => item?.code && item.dayTradeEligible !== false);
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

    const grossReturnPercent = ((quote.open - quote.close) / quote.open) * 100;
    const netReturnPercent = (((quote.open * (1 - commissionRate - taxRate)) - quote.close * (1 + commissionRate)) / (quote.open * (1 + commissionRate))) * 100;
    trades.push({
      code: item.code,
      name: item.name ?? quote.name ?? '',
      entryPrice: quote.open,
      exitPrice: quote.close,
      grossReturnPercent,
      netReturnPercent,
    });
  }

  const average = (field) => trades.length === 0 ? null : trades.reduce((sum, trade) => sum + trade[field], 0) / trades.length;

  const baseResult = {
    strategy: 'short-open-to-close-equal-weight',
    configuredTopN: topN,
    selectedCount: selected.length,
    executedCount: trades.length,
    skipped,
    commissionRate,
    taxRate,
    grossReturnPercent: average('grossReturnPercent'),
    netReturnPercent: average('netReturnPercent'),
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
    
    // 盤中進場觸發價：開盤價 - 1.5% (模擬向下突破早盤低點)
    const triggerSellPrice = Math.round(open * 0.985 * 100) / 100;
    
    // 如果當天最低價根本沒有跌破觸發價，代表空方動能未確認，今天「不進場」
    if (low > triggerSellPrice) {
      advSkipped.push({ code: item.code, reason: '未達到盤中動能觸發價 (未破低)' });
      continue;
    }

    // 進場後的止損價：開盤價 + 1.0% (極速止損)
    const stopLossPrice = Math.round(open * 1.01 * 100) / 100;
    
    let exitPrice = close;
    let exitReason = '收盤強制平倉';

    // 模擬盤中走勢的保守假設：
    // 1. 若當天最高價高於止損價，且我們是在觸發後才遇到最高點（保守估計為觸發止損）
    if (high >= stopLossPrice) {
      exitPrice = stopLossPrice;
      exitReason = '觸發盤中硬性止損';
    } 
    // 2. 模擬移動止盈：若盤中最低價曾達到開盤 -3.5% 以下，啟動保本/移動止盈，在回彈時以 -2.0% 出場
    else if (low <= open * 0.965) {
      exitPrice = Math.round(open * 0.98 * 100) / 100;
      exitReason = '觸發保本/移動止盈';
    }

    const grossReturnPercent = ((triggerSellPrice - exitPrice) / triggerSellPrice) * 100;
    const netReturnPercent = (((triggerSellPrice * (1 - commissionRate - taxRate)) - exitPrice * (1 + commissionRate)) / (triggerSellPrice * (1 + commissionRate))) * 100;

    advTrades.push({
      code: item.code,
      name: item.name ?? quote.name ?? '',
      entryPrice: triggerSellPrice,
      exitPrice,
      exitReason,
      grossReturnPercent,
      netReturnPercent,
    });
  }

  const advAverage = (field) => advTrades.length === 0 ? null : advTrades.reduce((sum, trade) => sum + trade[field], 0) / advTrades.length;

  baseResult.adv = {
    strategy: 'short-high-winrate-orb',
    selectedCount: selected.length,
    executedCount: advTrades.length,
    skippedCount: advSkipped.length,
    skipped: advSkipped,
    grossReturnPercent: advAverage('grossReturnPercent'),
    netReturnPercent: advAverage('netReturnPercent'),
    winRatePercent: advTrades.length === 0 ? null : (advTrades.filter((trade) => trade.netReturnPercent > 0).length / advTrades.length) * 100,
    trades: advTrades,
  };

  return baseResult;
}
