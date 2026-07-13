// netlify/functions/scan.mjs
//
// 完整流程的入口 function：抓今日行情 → 抓歷史成交量 → 跑因子篩選 → 回傳多方/空方觀察榜。
// 這是實際會被 Scheduled Function 呼叫、或使用者手動觸發測試的進入點。
//
// 部署到 Netlify 後可直接瀏覽器打開 /.netlify/functions/scan 測試（會需要幾秒鐘，因為要抓多天資料）。

import { normalizeTwseRow, normalizeTpexRow, isTradableRow } from './lib/normalize.mjs';
import { fetchVolumeHistory } from './lib/history.mjs';
import { fetchInstitutionalNetBuy } from './lib/institutional.mjs';
import { screenWatchlists } from './lib/screen.mjs';
import { saveLatestScan } from './lib/storage.mjs';

const TWSE_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
const TPEX_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';

// 排程設定：收盤後台灣時間約 14:10（UTC 06:10）自動觸發，週一到週五（UTC cron 語法）
// 排程觸發與手動打開網址呼叫的是同一個 handler，執行完都會把結果存進 Netlify Blobs（見 lib/storage.mjs），
// 前端 Dashboard 之後會透過 latest.mjs 讀取這裡存的最新結果。
export const config = { schedule: '10 6 * * 1-5' };

async function fetchTodayTwseQuotes() {
  const res = await fetch(TWSE_URL);
  if (!res.ok) throw new Error(`TWSE API 回應錯誤: HTTP ${res.status}`);
  const rows = await res.json();
  return rows.map(normalizeTwseRow).filter(isTradableRow);
}

async function fetchTodayTpexQuotes() {
  // 見 README「已知限制」：TPEx 欄位尚未實際驗證，欄位對不上時會拋出錯誤，
  // 這裡選擇讓錯誤往上傳遞（而不是吞掉），因為上櫃資料如果抓錯，整份候選名單的
  // 「全市場」前提就不成立了，寧可讓使用者知道，也不要默默只用上市資料出結果。
  const res = await fetch(TPEX_URL);
  if (!res.ok) throw new Error(`TPEx API 回應錯誤: HTTP ${res.status}`);
  const rows = await res.json();
  return rows.map(normalizeTpexRow).filter(isTradableRow);
}

export default async (req) => {
  const startedAt = Date.now();
  try {
    // 四個資料來源彼此獨立（歷史資料、法人資料都不需要等 TWSE/TPEx 的結果才能開始抓），
    // 全部平行發出，不要排隊序列等待。實測發現序列版本很容易讓整個 function 超過
    // Netlify 的執行時間上限而逾時（逾時時瀏覽器只會看到籠統的「unknown error」，
    // 不會直接告訴你是逾時，所以這個坑不容易一眼看出來）。
    const [twseResult, tpexResult, historyResult, institutionalResult] = await Promise.allSettled([
      fetchTodayTwseQuotes(),
      fetchTodayTpexQuotes(),
      fetchVolumeHistory(5),
      fetchInstitutionalNetBuy(),
    ]);

    const todayQuotes = [
      ...(twseResult.status === 'fulfilled' ? twseResult.value : []),
      ...(tpexResult.status === 'fulfilled' ? tpexResult.value : []),
    ];

    if (todayQuotes.length === 0) {
      throw new Error('今日行情抓取失敗，TWSE 與 TPEx 皆無資料可用');
    }

    // fetchVolumeHistory 內部已經把「單一天請求失敗」的情況處理掉了，理論上不會整個 reject，
    // 但還是用 allSettled 保守處理，避免它萬一真的 reject 就讓整個 scan 跟著死掉
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
