import { getRecentInstitutionalHistory } from './lib/institutional-archive.mjs';
import { buildSectorFlow } from './lib/sector-flow.mjs';
import { DEFAULT_SECTORS, filterSectorsByCodes } from './lib/sector-classification.mjs';
import { getSharedWatchlist } from './lib/watchlist.mjs';
import { errorResponse, jsonResponse } from './lib/http.mjs';

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
    return jsonResponse({ ...buildSectorFlow(snapshots, { sectors }), daysRequested: days, daysScanned: snapshots.length, watchlistOnly });
  } catch (error) {
    return errorResponse(error);
  }
};
