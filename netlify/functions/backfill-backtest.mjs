// 分批回填「上市市場」歷史回測。每次預設 3 個訊號日，回應 nextEndDate 後可繼續往前補。
// 不含上櫃，因目前尚無已驗證的 TPEx 歷史行情與歷史法人資料來源。

import { fetchOneDay } from './lib/history.mjs';
import { fetchInstitutionalNetBuy } from './lib/institutional.mjs';
import { getPastTradingDayCandidates } from './lib/trading-day.mjs';
import { screenWatchlists } from './lib/screen.mjs';
import { evaluateOpenToCloseLong } from './lib/backtest.mjs';
import { saveBacktestResult } from './lib/backtest-storage.mjs';
import { buildHistoricalBacktestWindows, parseBacktestDays, parseCursorDate } from './lib/backtest-history.mjs';
import { DEFAULT_HISTORY_WINDOW_DAYS } from './lib/volume-archive.mjs';

const MAX_SIGNAL_DAYS_PER_RUN = 3;
const TOP_N = 10;
const BATCH_SIZE = 3;

function dateFromIso(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function chunk(items, size) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

function buildVolumeHistory(historyDays) {
  const volumeHistory = new Map();
  for (const day of historyDays) {
    for (const quote of day.quotes) {
      if (!volumeHistory.has(quote.code)) volumeHistory.set(quote.code, []);
      volumeHistory.get(quote.code).push(quote.volume);
    }
  }
  return volumeHistory;
}

export default async (req) => {
  const url = new URL(req.url);
  const days = parseBacktestDays(url.searchParams.get('days'), MAX_SIGNAL_DAYS_PER_RUN, MAX_SIGNAL_DAYS_PER_RUN);
  const cursorDate = parseCursorDate(url.searchParams.get('endDate'));
  if (!cursorDate) {
    return new Response(JSON.stringify({ error: 'endDate 必須是 YYYY-MM-DD 格式' }), { status: 400 });
  }

  try {
    // 每個訊號日需要：1 個執行日 + 5 個歷史基準日；相鄰窗口共用資料，所以只多抓 days + 6 天。
    const candidates = getPastTradingDayCandidates(cursorDate, days + DEFAULT_HISTORY_WINDOW_DAYS + 1);
    const snapshots = [];
    const debugInfo = [];
    for (const batch of chunk(candidates, BATCH_SIZE)) {
      const settled = await Promise.allSettled(batch.map((date) => fetchOneDay(date)));
      settled.forEach((result, index) => {
        const candidate = batch[index];
        if (result.status === 'fulfilled' && result.value.actualDate && result.value.quotes.length > 0) {
          snapshots.push({ date: result.value.actualDate, quotes: result.value.quotes });
          debugInfo.push({ candidateDate: candidate.toISOString().slice(0, 10), actualDate: result.value.actualDate, quoteCount: result.value.quotes.length, error: null });
        } else {
          debugInfo.push({ candidateDate: candidate.toISOString().slice(0, 10), actualDate: null, quoteCount: 0, error: result.status === 'rejected' ? result.reason.message : '回傳資料沒有有效交易日' });
        }
      });
    }

    // 端點偶爾可能無視日期參數；以實際日期去重並維持由近到遠的候選順序。
    const seen = new Set();
    const uniqueSnapshots = snapshots.filter((snapshot) => !seen.has(snapshot.date) && seen.add(snapshot.date));
    const windows = buildHistoricalBacktestWindows(uniqueSnapshots);
    const results = [];

    for (const window of windows) {
      const institutional = await fetchInstitutionalNetBuy(dateFromIso(window.signal.date));
      if (institutional.actualDate !== window.signal.date) {
        results.push({ signalDate: window.signal.date, skipped: true, reason: `T86 實際日期不符（${institutional.actualDate ?? '無法辨識'}）` });
        continue;
      }
      const screened = screenWatchlists(window.signal.quotes, buildVolumeHistory(window.history), institutional.netBuyByCode, { topN: TOP_N });
      const evaluation = evaluateOpenToCloseLong(screened.longWatchlist, window.execution.quotes, { topN: TOP_N });
      const record = {
        signalDate: window.signal.date,
        executionDate: window.execution.date,
        generatedAt: new Date().toISOString(),
        marketCoverage: 'TWSE-only',
        factorCoverage: 'volume-gap-relativeStrength-institutional',
        ...evaluation,
      };
      await saveBacktestResult(record);
      results.push(record);
    }

    const oldestWindow = windows.at(-1);
    return new Response(JSON.stringify({
      message: `歷史回測回填完成：成功結算 ${results.filter((result) => !result.skipped).length}/${windows.length} 個訊號日（上市市場）`,
      requestedSignalDays: days,
      completed: results,
      debugInfo,
      nextEndDate: oldestWindow?.signal.date ?? null,
      instruction: oldestWindow ? '以 nextEndDate 再呼叫一次即可繼續往前回填；每次最多 3 個訊號日。' : '資料不足以形成回測窗口，請檢查 debugInfo。',
    }, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } });
  }
};
