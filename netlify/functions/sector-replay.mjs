import { getRecentInstitutionalHistory } from './lib/institutional-archive.mjs';
import { buildSectorReplay } from './lib/sector-flow.mjs';
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
    return jsonResponse({ daysRequested: days, daysScanned: snapshots.length, watchlistOnly, frames: buildSectorReplay(snapshots, { sectors }) });
  } catch (error) {
    return errorResponse(error);
  }
};
