import { getRecentInstitutionalHistory } from './lib/institutional-archive.mjs';
import { buildSectorReplay } from './lib/sector-flow.mjs';

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
    const snapshots = await getRecentInstitutionalHistory(days);
    return json({ daysRequested: days, daysScanned: snapshots.length, frames: buildSectorReplay(snapshots) });
  } catch (error) {
    return json({ error: error.message || '板塊回放資料讀取失敗' }, 500);
  }
};
