const normalizeText = (value) => {
  return String(value ?? '').trim().toUpperCase();
}

/**
 * 從已正規化的市場行情中搜尋股票。
 * 搜尋欄位包含股票代碼與名稱，精確代碼優先，其次是名稱／代碼開頭匹配。
 */
export function searchQuotes(quotes, query, limit = 20) {
  const keyword = normalizeText(query);
  if (!keyword) return [];

  return (quotes ?? [])
    .filter((quote) => {
      const code = normalizeText(quote?.code);
      const name = normalizeText(quote?.name);
      return code.includes(keyword) || name.includes(keyword);
    })
    .sort((a, b) => {
      const aCode = normalizeText(a?.code);
      const bCode = normalizeText(b?.code);
      const aName = normalizeText(a?.name);
      const bName = normalizeText(b?.name);
      const score = (code, name) => (code === keyword ? 0 : code.startsWith(keyword) ? 1 : name.startsWith(keyword) ? 2 : 3);
      return score(aCode, aName) - score(bCode, bName) || aCode.localeCompare(bCode);
    })
    .slice(0, Math.max(1, limit))
    .map((quote) => ({
      code: quote.code,
      name: quote.name,
      market: quote.market,
      close: quote.close,
      change: quote.change,
      volume: quote.volume,
    }));
}

export function findQuoteByCode(quotes, code, market = null) {
  const normalizedCode = normalizeText(code);
  const normalizedMarket = market ? normalizeText(market) : null;
  return (quotes ?? []).find((quote) => normalizeText(quote?.code) === normalizedCode
    && (!normalizedMarket || normalizeText(quote?.market) === normalizedMarket)) ?? null;
}
