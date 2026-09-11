import { getRecentInstitutionalHistory } from './lib/institutional-archive.mjs';
import { buildSectorFlow } from './lib/sector-flow.mjs';
import { DEFAULT_SECTORS, filterSectorsByCodes } from './lib/sector-classification.mjs';
import { getSharedWatchlist } from './lib/watchlist.mjs';

function json(value, status = 200) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export default async (req) => {
  try {
    const url = new URL(req.url);
    const days = Math.min(Math.max(Number.parseInt(url.searchParams.get('days'), 10) || 20, 5), 20);
    const watchlistOnly = url.searchParams.get('watchlistOnly') === '1';
    const [snapshots, watchlist] = await Promise.all([
      getRecentInstitutionalHistory(days),
      getSharedWatchlist(),
    ]);
    const sectors = watchlistOnly
      ? filterSectorsByCodes(DEFAULT_SECTORS, watchlist.items.map((item) => item.code))
      : DEFAULT_SECTORS;
    return json({ ...buildSectorFlow(snapshots, { sectors }), daysRequested: days, daysScanned: snapshots.length, watchlistOnly });
  } catch (error) {
    return json({ error: error.message || '板塊資金資料讀取失敗' }, 500);
  }
};
