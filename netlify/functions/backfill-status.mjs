// netlify/functions/backfill-status.mjs
//
// 給「回填控制頁」用：列出過去 N 個交易日，標示每一天有沒有回測結果，讓使用者一眼看出
// 缺口在哪、按對應的按鈕觸發單日回填（見 backfill-backtest.mjs 的 signalDate 參數）。

import { getPastTradingDayCandidates, formatIsoDate } from './lib/trading-day.mjs';
import { getBacktestIndex } from './lib/backtest-storage.mjs';
import { buildBackfillStatusItems } from './lib/history-index.mjs';

const DEFAULT_DAYS = 10;
const MAX_DAYS = 30; // 上限，避免有人手動改網址參數要求過多天數，拖慢回應

export default async (req) => {
  try {
    const url = new URL(req.url);
    const requestedDays = Number(url.searchParams.get('days'));
    const days = Number.isInteger(requestedDays) && requestedDays >= 1 && requestedDays <= MAX_DAYS ? requestedDays : DEFAULT_DAYS;

    const tradingDayDates = getPastTradingDayCandidates(new Date(), days).map(formatIsoDate);
    const backtestDates = await getBacktestIndex();
    const items = buildBackfillStatusItems(tradingDayDates, backtestDates);

    return new Response(
      JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 2),
      { headers: { 'content-type': 'application/json; charset=utf-8' } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
};
