import { addToSharedWatchlist, getSharedWatchlist, removeFromSharedWatchlist } from './lib/watchlist.mjs';
import { fetchTwseQuotes, fetchTpexQuotes } from './fetch-daily-quotes.mjs';
import { findQuoteByCode } from './lib/stock-search.mjs';
import { jsonResponse } from './lib/http.mjs';

export default async (req) => {
  try {
    if (req.method === 'GET') return jsonResponse(await getSharedWatchlist());
    if (req.method !== 'POST' && req.method !== 'DELETE') return jsonResponse({ error: '只支援 GET、POST、DELETE' }, 405);

    const body = await req.json();
    if (req.method === 'POST') {
      const results = await Promise.allSettled([fetchTwseQuotes(), fetchTpexQuotes()]);
      const quotes = results
        .filter((result) => result.status === 'fulfilled')
        .flatMap((result) => result.value.normalized);
      const verified = findQuoteByCode(quotes, body?.code, body?.market);
      if (!verified) {
        const sourceFailure = results.every((result) => result.status === 'rejected');
        return jsonResponse({ error: sourceFailure ? '目前無法取得上市／上櫃行情，暫時無法確認這檔股票。' : '找不到這檔股票的有效行情，請重新搜尋後再加入。' }, sourceFailure ? 503 : 400);
      }
      return jsonResponse(await addToSharedWatchlist({
        ...body,
        code: verified.code,
        name: verified.name,
        market: verified.market,
      }));
    }

    const result = await removeFromSharedWatchlist(body?.code);
    return jsonResponse({ ...result.watchlist, removed: result.removed });
  } catch (error) {
    const message = error instanceof SyntaxError ? '請提供合法的 JSON' : error.message;
    return jsonResponse({ error: message || '自選股操作失敗' }, 400);
  }
};
