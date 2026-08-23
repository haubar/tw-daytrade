// netlify/functions/data-source-stats.mjs
//
// 統計工具：算出過去 N 個交易日，各個資料源（法人買賣超、TPEx、TAIEX...）實際的
// 成功/失敗比例。對應使用者的疑慮：「法人資料的 institutionalDataMissing 標示做完後，
// 才發現幾乎每天都抓失敗，不是只有上櫃股票的問題」——先把真實數字算出來，再決定
// 要不要調整權重或改資料源，不是憑印象判斷。
//
// 用法：https://你的站台.netlify.app/.netlify/functions/data-source-stats?days=20
//
// scan.mjs 沒有維護「哪些日期有存過完整快照」的索引（跟 volume-archive／backtest-storage
// 不同），所以這裡採用跟 backfill-status.mjs 一樣的做法：算出過去 N 個交易日，
// 逐一嘗試讀取，讀不到的日期跳過（可能還沒執行過、或是很久以前被覆蓋掉的舊資料）。

import { getPastTradingDayCandidates, formatIsoDate } from './lib/trading-day.mjs';
import { getScanByDate } from './lib/storage.mjs';
import { summarizeDataSourceHistory, buildDailyBreakdown } from './lib/data-source-stats.mjs';

const DEFAULT_DAYS = 20;
const MAX_DAYS = 60; // 上限，避免有人手動改網址參數要求過多天數，一次觸發太多 Blobs 讀取

export default async (req) => {
  try {
    const url = new URL(req.url);
    const requestedDays = Number(url.searchParams.get('days'));
    const days = Number.isInteger(requestedDays) && requestedDays >= 1 && requestedDays <= MAX_DAYS ? requestedDays : DEFAULT_DAYS;

    // 包含「今天」一起算：跟 backfill-status.mjs 不同（那邊只看過去、不含今天，因為
    // 今天的回測還沒有機會執行），這裡是想看「資料源本身」的成功率，今天如果已經
    // 執行過 scan.mjs，也應該算進統計裡。
    const candidateDates = [formatIsoDate(new Date()), ...getPastTradingDayCandidates(new Date(), days).map(formatIsoDate)];

    const snapshots = [];
    for (const date of candidateDates) {
      const scan = await getScanByDate(date);
      if (scan) snapshots.push({ date, dataSourceStatus: scan.dataSourceStatus ?? {} });
    }

    const summary = summarizeDataSourceHistory(snapshots);
    const dailyBreakdown = buildDailyBreakdown(snapshots);

    return new Response(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          requestedDays: days,
          daysWithSnapshot: snapshots.length,
          note: snapshots.length < days
            ? `要求分析 ${days} 個交易日，但只找到 ${snapshots.length} 天有完整快照可用（可能是部署時間還沒那麼久、或部分歷史快照已被覆蓋）。`
            : null,
          summary,
          dailyBreakdown,
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
