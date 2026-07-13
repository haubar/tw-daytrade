// netlify/functions/backfill-history.mjs
//
// 一次性手動補資料工具：直接沿用 history.mjs 那套「現場跟 TWSE 要好幾天份歷史資料」的邏輯，
// 把抓到的每一天資料寫進 volume-archive.mjs 的 Blobs 累積庫，讓 scan.mjs 不用乾等 2-3 個交易日
// 才能自然累積出足夠的歷史天數。
//
// 這支 function 刻意不加排程設定，只給你手動打開網址觸發一次用。因為它一樣要現場抓好幾天資料，
// 一樣有機會逼近（甚至超過）Netlify 的執行時間上限——如果真的逾時，不用緊張，
// 讓 scan.mjs 每天自然累積個 2-3 天就會自己補齊，這支只是「加速暖機」的工具，不是必需品。
//
// 用法：部署後打開 https://你的站台.netlify.app/.netlify/functions/backfill-history 一次即可。

import { fetchVolumeHistory } from './lib/history.mjs';
import { appendDailySnapshot } from './lib/volume-archive.mjs';

export default async (req) => {
  try {
    const { volumeHistory, datesUsed } = await fetchVolumeHistory(3);

    if (datesUsed.length === 0) {
      return new Response(
        JSON.stringify({ error: '沒有抓到任何歷史交易日資料，Blobs 累積庫沒有更新' }),
        { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } }
      );
    }

    // volumeHistory 目前是 code -> [依日期新到舊排序的 volume 陣列]，
    // 要反過來拆成「每一天各自的快照」（code -> volume）才能一天一天寫進 Blobs。
    const snapshotsByDate = datesUsed.map((date, dayIndex) => {
      const quotes = [];
      for (const [code, volumes] of volumeHistory.entries()) {
        if (volumes[dayIndex] !== undefined) {
          quotes.push({ code, volume: volumes[dayIndex] });
        }
      }
      return { date, quotes };
    });

    for (const { date, quotes } of snapshotsByDate) {
      await appendDailySnapshot(date, quotes);
    }

    return new Response(
      JSON.stringify(
        {
          message: '補資料完成，scan.mjs 下次執行就能讀到這些歷史資料',
          datesBackfilled: datesUsed,
          stockCountPerDay: snapshotsByDate.map((s) => ({ date: s.date, count: s.quotes.length })),
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
