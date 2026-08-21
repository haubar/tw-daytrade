// netlify/functions/history-index.mjs
//
// 給前端「歷史資料列表」面板用（見 src/components/HistoryPanel.vue）：合併「哪幾天有成功
// 抓到每日行情快照」（volume-archive）跟「哪幾天有回測結果」（backtest-storage），
// 讓使用者一眼看出資料累積的現況——不用逐一打開 backtest-latest 或去猜有沒有資料。
//
// 這兩份資料保留天數不一樣：volume-archive 只留最近 15 天（給量能異常因子當歷史窗口用，
// 見 volume-archive.mjs 的 MAX_ARCHIVED_DAYS），backtest-storage 留最近 260 天（約一個
// 交易年度，給累積績效分析用）。合併後的清單用兩邊日期的聯集，不是交集，這樣才能完整
// 反映「回測資料其實比每日快照存得更久」這件事。

import { getArchivedDates } from './lib/volume-archive.mjs';
import { getBacktestIndex, getBacktestResultByDate } from './lib/backtest-storage.mjs';
import { mergeDateLists, summarizeBacktest, buildHistoryItems } from './lib/history-index.mjs';

export default async () => {
  try {
    const [archivedDates, backtestDates] = await Promise.all([getArchivedDates(), getBacktestIndex()]);

    // 聯集：兩邊日期集合合併去重，確保回測資料比每日快照存得更久這件事不會漏掉。
    const allDates = mergeDateLists(archivedDates, backtestDates);

    // 只對「有回測資料」的日期實際去查完整結果，不會對每個日期都查一次
    // （backtestDates 通常比 archivedDates 多很多筆，這樣可以省掉不必要的 Blobs 讀取）。
    const backtestSummaryByDate = new Map(
      await Promise.all(
        backtestDates.map(async (date) => [date, summarizeBacktest(await getBacktestResultByDate(date))])
      )
    );

    const items = buildHistoryItems(allDates, archivedDates, backtestSummaryByDate);

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
