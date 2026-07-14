// netlify/functions/scan.mjs
//
// 完整流程的入口 function：抓今日行情 → 讀 Blobs 累積的歷史成交量 → 跑因子篩選 →
// 把今日資料存進歷史累積庫（給明天用）→ 回傳多方/空方觀察榜。
// 這是實際會被 Scheduled Function 呼叫、或使用者手動觸發測試的進入點。
//
// 部署到 Netlify 後可直接瀏覽器打開 /.netlify/functions/scan 測試。
// 歷史資料改成從 Blobs 讀（不再現場跟 TWSE 要好幾天份資料），速度應該比舊版快很多，
// 但剛開始使用的前幾天，累積天數不夠，量能異常因子會先是中性值，可以用
// backfill-history.mjs 手動補資料加速暖機（見 README）。

import { normalizeTwseRow, normalizeTpexRow, isTradableRow } from './lib/normalize.mjs';
import { getRecentVolumeHistory, appendDailySnapshot } from './lib/volume-archive.mjs';
import { fetchInstitutionalNetBuy } from './lib/institutional.mjs';
import { screenWatchlists } from './lib/screen.mjs';
import { saveLatestScan } from './lib/storage.mjs';
import { isWeekend } from './lib/trading-day.mjs';

const TWSE_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
const TPEX_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';

// 排程設定：收盤後台灣時間約 14:10（UTC 06:10）自動觸發，週一到週五（UTC cron 語法）
// 排程觸發與手動打開網址呼叫的是同一個 handler，執行完都會把結果存進 Netlify Blobs（見 lib/storage.mjs），
// 前端 Dashboard 之後會透過 latest.mjs 讀取這裡存的最新結果。
export const config = { schedule: '10 6 * * 1-5' };

async function fetchTodayTwseQuotes() {
  const res = await fetch(TWSE_URL, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`TWSE API 回應錯誤: HTTP ${res.status}`);
  const rows = await res.json();
  return rows.map(normalizeTwseRow).filter(isTradableRow);
}

async function fetchTodayTpexQuotes() {
  // 見 README「已知限制」：TPEx 欄位尚未實際驗證，欄位對不上時會拋出錯誤，
  // 這裡選擇讓錯誤往上傳遞（而不是吞掉），因為上櫃資料如果抓錯，整份候選名單的
  // 「全市場」前提就不成立了，寧可讓使用者知道，也不要默默只用上市資料出結果。
  const res = await fetch(TPEX_URL, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`TPEx API 回應錯誤: HTTP ${res.status}`);
  const rows = await res.json();
  return rows.map(normalizeTpexRow).filter(isTradableRow);
}

export default async (req) => {
  const startedAt = Date.now();
  const todayDateStr = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  try {
    // 三個資料來源彼此獨立，全部平行發出。歷史資料現在是讀 Netlify Blobs 裡累積的紀錄
    // （見 volume-archive.mjs），不再現場跟 TWSE 要好幾天份資料——這是部署後實測發現的
    // 效能瓶頸，改成這樣之後，理論上每次執行只需要各資料來源各一次請求，速度快很多。
    const [twseResult, tpexResult, historyResult, institutionalResult] = await Promise.allSettled([
      fetchTodayTwseQuotes(),
      fetchTodayTpexQuotes(),
      getRecentVolumeHistory(3, todayDateStr),
      fetchInstitutionalNetBuy(),
    ]);

    const todayQuotes = [
      ...(twseResult.status === 'fulfilled' ? twseResult.value : []),
      ...(tpexResult.status === 'fulfilled' ? tpexResult.value : []),
    ];

    if (todayQuotes.length === 0) {
      throw new Error('今日行情抓取失敗，TWSE 與 TPEx 皆無資料可用');
    }

    // 把今天的資料存進 Blobs 累積庫，讓「明天」執行時可以讀到今天的資料當作歷史的一部分。
    // 如果今天是週六日（例如使用者手動觸發測試剛好選在週末），TWSE 端點還是會回傳「最近一個
    // 交易日」的資料（例如週五的資料），但那筆資料不該被標記成「今天（週末）」存進歷史累積庫——
    // 這樣會產生一筆假的非交易日資料，汙染量能異常因子的計算基礎（週五的量能會被誤算成
    // 「這是週末當天的量能」，跟真正的週五那天分開計算，導致同一份資料被扭曲成兩筆不同的天）。
    // 這一步失敗（或跳過）不應該讓整個掃描失敗，獨立包 try/catch。
    let archiveWarning = null;
    if (isWeekend(new Date())) {
      archiveWarning = '今天是非交易日（週末），不寫入歷史累積庫，避免產生無效的交易日資料';
    } else {
      try {
        await appendDailySnapshot(todayDateStr, todayQuotes);
      } catch (e) {
        archiveWarning = `今日資料寫入歷史累積庫失敗（不影響本次結果，但明天的歷史資料會少這一天）: ${e.message}`;
      }
    }

    // getRecentVolumeHistory 內部如果連不到 Blobs 會整個 reject，這裡保守處理成「視為沒有歷史資料」，
    // 而不是讓整個 scan 跟著死掉——量能異常因子會全部是中性值，但其他三個因子還是能正常運作。
    // 天數設定為 3 天：剛開始使用（或剛清空 Blobs 累積庫）的前幾天，累積天數不夠 3 天，
    // 可以先用 backfill-history.mjs 手動補資料加速暖機。
    const { volumeHistory, datesUsed } =
      historyResult.status === 'fulfilled' ? historyResult.value : { volumeHistory: new Map(), datesUsed: [] };

    // 法人買賣超抓取失敗不應該讓整個掃描失敗——沒有這個因子還是可以用其他三個因子繼續產生結果，
    // 只是這次的結果會少一個訊號來源，這裡把「抓取失敗」跟「抓到但日期對不上」分開判斷。
    let institutionalNetBuy = new Map();
    let institutionalWarning = null;
    if (institutionalResult.status === 'fulfilled') {
      institutionalNetBuy = institutionalResult.value.netBuyByCode;
      if (institutionalResult.value.dateMismatch) {
        // 比照 history.mjs 驗證歷史資料端點時發現的問題：date 參數不一定可靠，
        // 這裡不是直接丟棄資料（資料本身可能還是有效的，只是不是今天的），而是清楚標記出來，
        // 讓看結果的人知道這個因子可能不是當日資料，之後再視情況決定要不要改成重試或直接排除。
        institutionalWarning = `法人買賣超資料日期與預期不符（預期 ${institutionalResult.value.requestedDate}，實際拿到 ${institutionalResult.value.actualDate}），本次結果可能不是最新的法人資料`;
      }
    } else {
      institutionalWarning = `法人買賣超資料抓取失敗（本次結果的法人因子將全部視為中性）: ${institutionalResult.reason.message}`;
    }

    const result = screenWatchlists(todayQuotes, volumeHistory, institutionalNetBuy, { topN: 30 });

    const payload = {
      generatedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      dataSourceStatus: {
        twse: twseResult.status === 'fulfilled' ? `ok (${twseResult.value.length} 檔)` : `失敗: ${twseResult.reason.message}`,
        tpex: tpexResult.status === 'fulfilled' ? `ok (${tpexResult.value.length} 檔)` : `失敗: ${tpexResult.reason.message}`,
        institutional: institutionalNetBuy.size > 0
          ? `ok (${institutionalNetBuy.size} 檔)${institutionalWarning ? ` ⚠ ${institutionalWarning}` : ''}`
          : `失敗: ${institutionalWarning}`,
        historyArchive: historyResult.status === 'fulfilled'
          ? `ok（累積 ${datesUsed.length}/3 天，${datesUsed.length < 3 ? '尚未暖機完成，量能異常因子會偏向中性' : '天數足夠'}）${archiveWarning ? ` ⚠ ${archiveWarning}` : ''}`
          : `失敗（本次量能異常因子將全部視為中性）: ${historyResult.reason?.message ?? '未知錯誤'}`,
      },
      historicalDatesUsed: datesUsed,
      marketChangePercent: result.marketChangePercent,
      totalCandidates: result.totalCandidates,
      excludedNoHistory: result.excludedNoHistory,
      longWatchlist: result.longWatchlist,
      shortWatchlist: result.shortWatchlist,
      disclaimer: '本結果僅供參考，不構成投資建議。當沖有資格與風險限制，請自行評估。',
    };

    // 存進 Netlify Blobs，這樣排程自動執行的結果才有地方可以查（前端會呼叫 latest.mjs 讀取）。
    // 存檔失敗不應該讓整個請求失敗——使用者手動打開這支 function 時，還是想看到當次算出來的結果，
    // 只是這次剛好沒存成功而已，所以這裡用 try/catch 包起來，只記錄警告訊息。
    let storageWarning = null;
    try {
      await saveLatestScan(payload);
    } catch (e) {
      storageWarning = `結果儲存失敗（不影響本次回傳的結果）: ${e.message}`;
    }

    return new Response(
      JSON.stringify(storageWarning ? { ...payload, storageWarning } : payload, null, 2),
      { headers: { 'content-type': 'application/json; charset=utf-8' } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
};
