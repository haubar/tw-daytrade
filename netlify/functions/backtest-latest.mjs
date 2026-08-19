import { getLatestBacktestResult } from './lib/backtest-storage.mjs';

export default async () => {
  try {
    const result = await getLatestBacktestResult();
    if (!result) return new Response(JSON.stringify({ error: '目前尚無回測結果。' }), { status: 404 });
    return new Response(JSON.stringify(result, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
