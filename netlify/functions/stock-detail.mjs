import { getBacktestIndex, getBacktestResultByDate } from './lib/backtest-storage.mjs';
import { getLatestScan } from './lib/storage.mjs';
import { getSharedWatchlist } from './lib/watchlist.mjs';
import { buildStockDetail } from './lib/stock-detail.mjs';

function json(value, status = 200) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function clampInt(raw, fallback, min, max) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

export default async (req) => {
  try {
    const url = new URL(req.url);
    const code = String(url.searchParams.get('code') ?? '').trim().toUpperCase();
    if (!/^\d{4,6}$/.test(code)) return json({ error: '請提供 4 到 6 碼股票代碼' }, 400);

    const days = clampInt(url.searchParams.get('days'), 60, 1, 260);
    const [latestScan, sharedWatchlist, index] = await Promise.all([
      getLatestScan(),
      getSharedWatchlist(),
      getBacktestIndex(),
    ]);
    const dates = index.slice().sort((a, b) => String(b).localeCompare(String(a))).slice(0, days);
    const results = await Promise.all(dates.map((date) => getBacktestResultByDate(date)));
    const sharedItem = sharedWatchlist.items.find((item) => item.code === code) ?? null;

    return json(buildStockDetail({
      code,
      latestScan,
      sharedItem,
      results,
      daysRequested: days,
    }));
  } catch (error) {
    return json({ error: error.message || '個股資料讀取失敗' }, 500);
  }
};
