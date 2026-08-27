// netlify/functions/stock-win-rate.mjs
//
// 個股勝率排行：跨過去 N 個「有回測資料」的訊號日，把同一支股票每次被選進觀察榜、
// 實際進場的交易彙總起來，算出這支股票被選中後的個人勝率，依高到低排序。
//
// 跟 history-index.mjs 不一樣：那邊是「每天整批 10 檔」的勝率，這邊是拆到「每支股票」
// 的層級。查詢參數：
//   days      要往回掃幾個訊號日（預設 60，上限 260＝backtest-storage 的保留上限）
//   minTrades 最小樣本數門檻，濾掉只出現一兩次的個股（預設 3）
//   strategy  'base'（預設，隔日開盤買收盤賣）或 'adv'（高級 ORB 突破策略）
//   limit     回傳前幾名（預設 30，上限 100）

import { getBacktestIndex, getBacktestResultByDate } from './lib/backtest-storage.mjs';
import { buildStockStats, rankStocksByWinRate } from './lib/stock-win-rate.mjs';

function clampInt(raw, fallback, min, max) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export default async (req) => {
  try {
    const url = new URL(req.url);
    const days = clampInt(url.searchParams.get('days'), 60, 1, 260);
    const minTrades = clampInt(url.searchParams.get('minTrades'), 3, 1, 260);
    const limit = clampInt(url.searchParams.get('limit'), 30, 1, 100);
    const strategy = url.searchParams.get('strategy') === 'adv' ? 'adv' : 'base';

    const index = (await getBacktestIndex()).slice(0, days);
    // 逐日的完整回測結果（含 trades 明細），不能用 summarizeBacktest() 的摘要版，
    // 那邊已經把 trades 濾掉了。
    const results = await Promise.all(index.map((date) => getBacktestResultByDate(date)));

    const stockStats = buildStockStats(results);
    const items = rankStocksByWinRate(stockStats, { strategy, minTrades, limit });

    return new Response(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          strategy,
          minTrades,
          daysRequested: days,
          daysScanned: index.length,
          distinctStocksSeen: stockStats.size,
          items,
        },
        null,
        2
      ),
      { headers: { 'content-type': 'application/json; charset=utf-8' } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
};
