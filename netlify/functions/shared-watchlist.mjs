import { addToSharedWatchlist, getSharedWatchlist, removeFromSharedWatchlist } from './lib/watchlist.mjs';

function json(value, status = 200) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export default async (req) => {
  try {
    if (req.method === 'GET') return json(await getSharedWatchlist());
    if (req.method !== 'POST' && req.method !== 'DELETE') return json({ error: '只支援 GET、POST、DELETE' }, 405);

    const body = await req.json();
    if (req.method === 'POST') {
      return json(await addToSharedWatchlist(body));
    }

    const result = await removeFromSharedWatchlist(body?.code);
    return json({ ...result.watchlist, removed: result.removed });
  } catch (error) {
    const message = error instanceof SyntaxError ? '請提供合法的 JSON' : error.message;
    return json({ error: message || '自選股操作失敗' }, 400);
  }
};
