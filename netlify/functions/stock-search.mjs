import { fetchTwseQuotes, fetchTpexQuotes } from './fetch-daily-quotes.mjs';
import { searchQuotes } from './lib/stock-search.mjs';

function json(value, status = 200) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export default async (req) => {
  const url = new URL(req.url);
  const query = String(url.searchParams.get('q') ?? '').trim();
  if (req.method !== 'GET') return json({ error: '只支援 GET' }, 405);
  if (query.length < 1) return json({ error: '請輸入股票名稱或代碼' }, 400);

  try {
    const results = await Promise.allSettled([fetchTwseQuotes(), fetchTpexQuotes()]);
    const quotes = results
      .filter((result) => result.status === 'fulfilled')
      .flatMap((result) => result.value.normalized);
    const errors = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason?.message || '資料來源讀取失敗');

    return json({
      query,
      items: searchQuotes(quotes, query),
      sourceErrors: errors,
    });
  } catch (error) {
    return json({ error: error.message || '股票搜尋失敗' }, 500);
  }
};
