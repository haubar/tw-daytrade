import { buildStockStats } from './stock-win-rate.mjs';

const STRATEGIES = [
  { key: 'adv', label: '多方高級' },
  { key: 'shortAdv', label: '空方高級' },
  { key: 'base', label: '多方基準' },
  { key: 'shortBase', label: '空方基準' },
];

const normalizeCode = (value) => {
  return String(value ?? '').trim().toUpperCase();
}

const findLatestQuote = (latestScan, code) => {
  const lists = [latestScan?.longWatchlist, latestScan?.shortWatchlist];
  for (const list of lists) {
    const item = list?.find((candidate) => normalizeCode(candidate?.code) === code);
    if (item) return item;
  }
  return null;
}

const summarizeBucket = (bucket) => {
  const trades = bucket?.trades ?? 0;
  const wins = bucket?.wins ?? 0;
  return {
    trades,
    wins,
    losses: Math.max(0, trades - wins),
    winRatePercent: trades > 0 ? (wins / trades) * 100 : null,
    avgNetReturnPercent: trades > 0 ? (bucket.sumNetReturn ?? 0) / trades : null,
  };
}

/**
 * 組合自選股詳細資料。計算沿用 stock-win-rate 的 buildStockStats，避免個股頁
 * 與既有排行 API 使用不同的勝率定義。
 */
export function buildStockDetail({ code: rawCode, latestScan = null, sharedItem = null, results = [], daysRequested = 60 }) {
  const code = normalizeCode(rawCode);
  const stats = buildStockStats(results).get(code);
  const latestQuote = findLatestQuote(latestScan, code);
  const name = latestQuote?.name || sharedItem?.name || stats?.name || code;
  const market = latestQuote?.market || sharedItem?.market || null;

  return {
    code,
    name,
    market,
    generatedAt: latestScan?.generatedAt ?? null,
    signalDate: latestScan?.generatedAt?.slice?.(0, 10) ?? null,
    current: latestQuote
      ? {
          close: latestQuote.close ?? null,
          changePercent: latestQuote.changePercent ?? null,
          volume: latestQuote.volume ?? null,
          score: latestQuote.score ?? null,
          side: latestScan?.longWatchlist?.some((item) => normalizeCode(item.code) === code)
            ? 'long'
            : 'short',
          dayTradeEligible: latestQuote.dayTradeEligible ?? null,
          institutionalDataMissing: latestQuote.institutionalDataMissing ?? null,
        }
      : null,
    strategies: Object.fromEntries(STRATEGIES.map(({ key, label }) => [key, { label, ...summarizeBucket(stats?.[key]) }])),
    lastSeenDate: stats?.lastSeenDate ?? null,
    daysRequested,
    daysScanned: results.filter(Boolean).length,
    dataSourceStatus: latestScan?.dataSourceStatus ?? null,
    disclaimer: '歷史勝率是本專案模型過去選中此股票後的回測統計，不代表未來上漲機率或投資建議。',
  };
}
