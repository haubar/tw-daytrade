import { fetchTwseQuotes, fetchTpexQuotes } from './fetch-daily-quotes.mjs';
import { searchQuotes } from './lib/stock-search.mjs';
import { errorResponse, jsonResponse } from './lib/http.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const query = String(url.searchParams.get('q') ?? '').trim();
  if (req.method !== 'GET') return jsonResponse({ error: '只支援 GET' }, 405);
  if (query.length < 1) return jsonResponse({ error: '請輸入股票名稱或代碼' }, 400);

  try {
    const results = await Promise.allSettled([fetchTwseQuotes(), fetchTpexQuotes()]);
    const quotes = results
      .filter((result) => result.status === 'fulfilled')
      .flatMap((result) => result.value.normalized);
    const errors = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason?.message || '資料來源讀取失敗');

    return jsonResponse({
      query,
      items: searchQuotes(quotes, query),
      sourceErrors: errors,
    });
  } catch (error) {
    return errorResponse(error);
  }
};
