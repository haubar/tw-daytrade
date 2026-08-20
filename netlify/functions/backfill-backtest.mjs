// 分批回填「上市市場」歷史回測。每次預設 1 個訊號日，回應 nextEndDate 後可繼續往前補。
// 不含上櫃，因目前尚無已驗證的 TPEx 歷史行情與歷史法人資料來源。
//
// 對 TWSE 的請求改成依序（不並行）發出，避免同時發出多個請求觸發 TWSE 的併發限制
// （實測過：9 個候選日期並行分批抓取時，5 個逾時、只成功 4 個，完全湊不出一個回測窗口）。

import { fetchOneDay } from './lib/history.mjs';
import { fetchInstitutionalNetBuy } from './lib/institutional.mjs';
import { getPastTradingDayCandidates } from './lib/trading-day.mjs';
import { screenWatchlists } from './lib/screen.mjs';
import { evaluateOpenToCloseLong } from './lib/backtest.mjs';
import { saveBacktestResult } from './lib/backtest-storage.mjs';
import { buildHistoricalBacktestWindows, parseBacktestDays, parseCursorDate, computeNextEndDate } from './lib/backtest-history.mjs';
import { DEFAULT_HISTORY_WINDOW_DAYS } from './lib/volume-archive.mjs';

// 改成依序（不並行）打 TWSE，避免觸發併發請求限制；代價是單次呼叫的總耗時變長，
// 所以把單次最多回填的訊號日數從 3 調降到 1，讓每次呼叫需要循序抓取的候選天數
// （days + DEFAULT_HISTORY_WINDOW_DAYS + 1）盡量少，降低整支 function 自己被 Netlify
// 執行逾時砍斷、連 JSON 錯誤訊息都拿不到的風險——調降前 days=3 时最多要循序抓 9 天，
// 若多筆逾時，總耗時可能超過 60 秒；調降後最多只需循序抓 7 天，安全邊際大很多。
// 想加快整體回填進度，用 nextEndDate 多呼叫幾次即可，不需要一次要求更多天數。
const MAX_SIGNAL_DAYS_PER_RUN = 1;
const TOP_N = 10;

function dateFromIso(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
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
    // 改成一次一個、依序打（不是同時發 BATCH_SIZE 個並行請求）。實測發現 TWSE 端點在多個
    // 並行請求下逾時率很高（例如 9 個候選裡並行請求 3 個一批，有 5 個逾時，只成功 4 個，
    // 完全湊不出一個回測窗口），改成依序逐一請求雖然整體花的時間變長，但每一個請求都是
    // 單獨對 TWSE 發出，不會互相搶資源觸發逾時，成功率明顯更穩定。
    for (const candidate of candidates) {
      try {
        const result = await fetchOneDay(candidate);
        if (result.actualDate && result.quotes.length > 0) {
          snapshots.push({ date: result.actualDate, quotes: result.quotes });
          debugInfo.push({ candidateDate: candidate.toISOString().slice(0, 10), actualDate: result.actualDate, quoteCount: result.quotes.length, error: null });
        } else {
          debugInfo.push({ candidateDate: candidate.toISOString().slice(0, 10), actualDate: null, quoteCount: 0, error: '回傳資料沒有有效交易日' });
        }
      } catch (e) {
        debugInfo.push({ candidateDate: candidate.toISOString().slice(0, 10), actualDate: null, quoteCount: 0, error: e.message });
      }
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
    // 就算這批完全沒湊出任何窗口，也不能讓 nextEndDate 卡在 null——那樣使用者不知道下次
    // 要從哪個日期繼續打，回填流程就卡死在原地（見 computeNextEndDate 的說明，這是真實
    // 發生過的 bug）。
    const nextEndDate = computeNextEndDate(windows, candidates);

    return new Response(JSON.stringify({
      message: `歷史回測回填完成：成功結算 ${results.filter((result) => !result.skipped).length}/${windows.length} 個訊號日（上市市場）`,
      requestedSignalDays: days,
      completed: results,
      debugInfo,
      nextEndDate,
      instruction: oldestWindow
        ? '以 nextEndDate 再呼叫一次即可繼續往前回填；每次最多 1 個訊號日（改成依序打 TWSE 以降低逾時率，見檔頭說明）。'
        : nextEndDate
          ? `這批候選日期沒有湊出任何完整窗口（常見原因是 TWSE 逾時導致成功抓到的天數不夠，見 debugInfo 的 error 欄位），已自動把 nextEndDate 往前推到 ${nextEndDate}，用這個值再呼叫一次即可繼續，不會卡住。`
          : '候選日期清單是空的，請檢查 endDate 參數是否正確。',
    }, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } });
  }
};
