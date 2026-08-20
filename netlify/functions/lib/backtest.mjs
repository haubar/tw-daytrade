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
  return {
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
}
