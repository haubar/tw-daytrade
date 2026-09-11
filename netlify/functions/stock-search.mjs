import { fetchTwseQuotes, fetchTpexQuotes } from './fetch-daily-quotes.mjs';
import { searchQuotes } from './lib/stock-search.mjs';
import { errorResponse, jsonResponse } from './lib/http.mjs';

const QUOTE_CACHE_TTL_MS = 5 * 60 * 1000;
let quoteCache = { expiresAt: 0, promise: null };

const loadMarketQuotes = () => {
  if (quoteCache.promise && quoteCache.expiresAt > Date.now()) return quoteCache.promise;

  const promise = Promise.allSettled([fetchTwseQuotes(), fetchTpexQuotes()]).then((results) => ({
    quotes: results
      .filter((result) => result.status === 'fulfilled')
      .flatMap((result) => result.value.normalized),
    errors: results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason?.message || '資料來源讀取失敗'),
  }));
  quoteCache = { expiresAt: Date.now() + QUOTE_CACHE_TTL_MS, promise };
  return promise;
};

export default async (req) => {
  const url = new URL(req.url);
  const query = String(url.searchParams.get('q') ?? '').trim();
  if (req.method !== 'GET') return jsonResponse({ error: '只支援 GET' }, 405);
  if (query.length < 1) return jsonResponse({ error: '請輸入股票名稱或代碼' }, 400);

  try {
    const { quotes, errors } = await loadMarketQuotes();

    return jsonResponse({
      query,
      items: searchQuotes(quotes, query),
      sourceErrors: errors,
    });
  } catch (error) {
    return errorResponse(error);
  }
};
