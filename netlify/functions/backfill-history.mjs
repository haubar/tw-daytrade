// netlify/functions/backfill-history.mjs
//
// 一次性手動補資料工具：把過去的交易日資料補進 volume-archive.mjs 的 Blobs 累積庫，
// 讓 scan.mjs 不用乾等好幾個交易日才能自然累積出足夠的歷史天數。
//
// 這支 function 刻意不加排程設定，只給你手動打開網址觸發一次用。
//
// 行為：
// - 跳過週六日（見 trading-day.mjs），只找交易日
// - 跳過已經存在 Blobs 累積庫裡的日期，不重複補——每次執行都是「往前多補幾天新的」，
//   而不是每次都補同樣的最近幾天（这樣連續按好幾次也不會有幫助）
// - 目標是補到 3 天「新的」交易日資料，如果候選日期裡有些已經補過、有些抓取失敗，
//   會自動往更早的日期找，直到湊滿 3 天或候選清單用完為止
//
// 用法：部署後打開 https://你的站台.netlify.app/.netlify/functions/backfill-history，
// 之後如果想再往前多補幾天歷史，可以再打開一次，會自動接續往前補，不會補到重複的天。

import { fetchOneDay } from './lib/history.mjs';
import { getPastTradingDayCandidates } from './lib/trading-day.mjs';
import { appendDailySnapshot, getArchivedDates } from './lib/volume-archive.mjs';

const TARGET_NEW_DAYS = 3;
const MAX_CANDIDATE_ATTEMPTS = 15; // 候選交易日的搜尋範圍上限，避免因為一直跳過已存在的天數而無限找下去

/**
 * 從一批「候選交易日的抓取結果」裡，依日期由近到遠的順序，挑出「還沒被存過」的新交易日，
 * 最多挑 targetCount 天。拆成獨立的純函式方便測試，不用每次都真的連網路。
 *
 * @param {Array<{actualDate: string|null, quotes: Array}>} fetchResults 依候選日期順序排列的抓取結果
 * @param {string[]} alreadyArchivedDates 已經存在 Blobs 累積庫裡的日期
 * @param {number} targetCount 想要挑出幾天新的
 * @returns {Array<{date: string, quotes: Array}>}
 */
export function pickNewTradingDays(fetchResults, alreadyArchivedDates, targetCount) {
  const seen = new Set(alreadyArchivedDates);
  const picked = [];

  for (const result of fetchResults) {
    if (picked.length >= targetCount) break;
    if (!result || !result.actualDate) continue; // 抓取失敗或無法辨識日期，跳過
    if (seen.has(result.actualDate)) continue; // 已經存過（或這批結果裡重複），跳過，繼續往前找

    seen.add(result.actualDate);
    picked.push({ date: result.actualDate, quotes: result.quotes });
  }

  return picked;
}

export default async (req) => {
  try {
    const archivedDates = await getArchivedDates();

    // 候選交易日全部平行發出（見階段 14 的教訓：序列抓取很容易逾時），
    // 每一個候選日期實際對應到哪一天，要等抓回來看回傳資料本身的日期才知道
    // （TWSE 的 date 參數不可靠，見 history.mjs 的說明）。
    const candidates = getPastTradingDayCandidates(new Date(), MAX_CANDIDATE_ATTEMPTS);
    const settledResults = await Promise.allSettled(candidates.map((c) => fetchOneDay(c)));
    const fetchResults = settledResults.map((s) => (s.status === 'fulfilled' ? s.value : null));

    const newDays = pickNewTradingDays(fetchResults, archivedDates, TARGET_NEW_DAYS);

    if (newDays.length === 0) {
      return new Response(
        JSON.stringify({
          message: '沒有新的交易日可以補——可能是候選範圍內的天數都已經存在累積庫裡了，或是這次請求都抓取失敗',
          alreadyArchivedDates: archivedDates,
        }),
        { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } }
      );
    }

    for (const { date, quotes } of newDays) {
      await appendDailySnapshot(date, quotes);
    }

    return new Response(
      JSON.stringify(
        {
          message: `補資料完成，新增了 ${newDays.length} 天，scan.mjs 下次執行就能讀到這些歷史資料`,
          datesBackfilled: newDays.map((d) => d.date),
          stockCountPerDay: newDays.map((d) => ({ date: d.date, count: d.quotes.length })),
          alreadyArchivedBeforeThisRun: archivedDates,
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
