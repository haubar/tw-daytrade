// netlify/functions/scan.mjs
//
// 完整流程的入口 function：抓今日行情 → 讀 Blobs 累積的歷史成交量 → 第一輪因子篩選
// → 對第一輪觀察榜裡的上櫃股票額外查 FinMind 法人資料、第二輪重新篩選 → 把今日資料存進
// 歷史累積庫（給明天用）→ 回傳多方/空方觀察榜。
// 這是實際會被 Scheduled Function 呼叫、或使用者手動觸發測試的進入點。
//
// 部署到 Netlify 後可直接瀏覽器打開 /.netlify/functions/scan 測試。
// 歷史資料改成從 Blobs 讀（不再現場跟 TWSE 要好幾天份資料），速度應該比舊版快很多，
// 但剛開始使用的前幾天，累積天數不夠，量能異常因子會先是中性值，可以用
// backfill-history.mjs 手動補資料加速暖機（見 README）。
//
// 為什麼要跑兩輪 screenWatchlists：T86（上市法人資料）可以一次撈全市場，但 FinMind
// （上櫃法人資料，見 lib/finmind.mjs）一次只能查一支股票，不可能對全部上櫃股都查一次。
// 做法是先用 T86 資料跑第一輪，找出「進了觀察榜的上櫃股票」，只對這些候選額外查 FinMind
// 補強，再跑第二輪產生最終結果（見 lib/screen.mjs 的 getTpexCandidateCodes 說明）。

import { normalizeTwseRow, normalizeTpexRow, isTradableRow } from './lib/normalize.mjs';
import { getRecentVolumeHistory, appendDailySnapshot } from './lib/volume-archive.mjs';
import { fetchInstitutionalNetBuy } from './lib/institutional.mjs';
import { fetchFinMindInstitutionalNetBuy } from './lib/finmind.mjs';
import { fetchTaiexChangePercent } from './lib/taiex.mjs';
import { screenWatchlists, getTpexCandidateCodes } from './lib/screen.mjs';
import { saveLatestScan } from './lib/storage.mjs';
import { isWeekend, isMarketDataReady } from './lib/trading-day.mjs';

const TWSE_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
const TPEX_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';
// 兩階段流程（見 lib/screen.mjs 的 getTpexCandidateCodes 說明）第二輪要查 FinMind 的上櫃候選數量上限。
// topN=100 時，理論上多空觀察榜合計最多可能有到 100 檔都是上櫃股票，但 FinMind 一次只能查一檔、
// 免費額度是 300~600 次/小時，這裡設一個保守上限，避免候選數量意外暴增時拖慢整個 scan 或超額度。
const MAX_FINMIND_CANDIDATES = 20;

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
    const [twseResult, tpexResult, historyResult, institutionalResult, taiexResult] = await Promise.allSettled([
      fetchTodayTwseQuotes(),
      fetchTodayTpexQuotes(),
      getRecentVolumeHistory(3, todayDateStr),
      fetchInstitutionalNetBuy(),
      fetchTaiexChangePercent(),
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
    } else if (!isMarketDataReady(new Date())) {
      // 台股 13:30 收盤，太早查詢可能拿到還沒最終確認的盤後資料，先不寫進歷史累積庫，
      // 避免把不準確的資料當成「今天的正式收盤資料」存下來，之後拿來算量能異常因子會失真。
      // 排程本身是設定在台灣時間 14:10 觸發（見檔頭排程設定），本來就會過這個檢查，
      // 這裡主要是防呆使用者在下午 2 點前手動觸發測試的情況。
      archiveWarning = '現在還沒到台灣時間下午 2 點，盤後資料可能還沒確定下來，先不寫入歷史累積庫（可以晚一點再手動觸發一次，或等排程在 14:10 自動執行）';
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

    // TAIEX 抓取失敗、或端點回應正常但解析不出資料（回傳 null），都優雅退回原本的估計值
    // （computeMarketChangeProxy，見 screen.mjs），不會讓整個掃描失敗——大盤漲跌幅本來就只是
    // 「相對強弱」因子的比較基準之一，不是關鍵路徑上的必要資料。
    let realTaiexChangePercent = null;
    let taiexWarning = null;
    if (taiexResult.status === 'fulfilled' && taiexResult.value !== null) {
      realTaiexChangePercent = taiexResult.value;
    } else if (taiexResult.status === 'fulfilled') {
      taiexWarning = 'TAIEX 端點回應正常，但解析不出「發行量加權股價指數」這筆資料，改用估計值';
    } else {
      taiexWarning = `TAIEX 指數抓取失敗，改用估計值: ${taiexResult.reason.message}`;
    }

    // topN 拉到 100（原本 30）：前端要做成交量/股價/漲幅篩選，如果候選池只有 30 檔，
    // 篩一篩很容易剩沒幾檔可看，拉大候選池篩選才有意義。
    //
    // 第一輪：用 T86（上市法人資料）跑一次，上櫃股票的法人因子暫時是中性值。
    const firstPassResult = screenWatchlists(todayQuotes, volumeHistory, institutionalNetBuy, {
      topN: 100,
      marketChangePercent: realTaiexChangePercent ?? undefined,
    });

    // 第二輪：從第一輪結果裡挑出「進了觀察榜的上櫃股票」，只對這些candidate額外查 FinMind 補強
    // 法人資料，再重新算一次分數（見 lib/screen.mjs 的 getTpexCandidateCodes 說明，為什麼要分兩輪
    // 而不是像 T86 那樣一次查全市場——FinMind 的法人資料一次只能查一支股票）。
    const tpexCandidateCodes = getTpexCandidateCodes(firstPassResult).slice(0, MAX_FINMIND_CANDIDATES);

    let result = firstPassResult;
    let finmindStatus;
    if (tpexCandidateCodes.length === 0) {
      finmindStatus = '本次第一輪觀察榜沒有上櫃股票，不需要查詢';
    } else {
      // FinMind 抓取失敗不應該讓整個掃描失敗——這幾檔上櫃股票的法人因子維持中性值，
      // 沿用第一輪的結果，其他因子/其他股票完全不受影響。
      try {
        const { netBuyByCode: finmindNetBuy, failedStockIds, emptyStockIds, debugInfo } = await fetchFinMindInstitutionalNetBuy(
          tpexCandidateCodes,
          todayDateStr
        );

        if (finmindNetBuy.size > 0) {
          // 合併 T86（上市）跟 FinMind（上櫃候選）兩份 map：兩者股票代碼不重疊，直接 union 即可。
          const mergedInstitutionalNetBuy = new Map([...institutionalNetBuy, ...finmindNetBuy]);
          result = screenWatchlists(todayQuotes, volumeHistory, mergedInstitutionalNetBuy, {
            topN: 100,
            marketChangePercent: realTaiexChangePercent ?? undefined,
          });
        }

        // 「成功」跟「技術上成功但資料是空的」分開報告，不要都混在「成功」數字裡——
        // 部署後第一次真實請求就發生過「查 20 檔、成功 0 檔、也沒有失敗紀錄」這種矛盾結果，
        // 原因是這兩種情況以前沒有分開追蹤，20 筆技術上成功、但 data 是空陣列的請求全部
        // 不見蹤影。emptyStockIds.length 偏高（例如整批都是空）通常代表 token/免費層對
        // 近期日期的存取範圍有限制，而不是「這些股票剛好都沒有法人買賣」的巧合。
        const parts = [`查詢 ${tpexCandidateCodes.length} 檔上櫃候選`, `成功 ${finmindNetBuy.size} 檔`];
        if (emptyStockIds.length > 0) parts.push(`空資料 ${emptyStockIds.length} 檔`);
        if (failedStockIds.length > 0) parts.push(`失敗 ${failedStockIds.length} 檔`);
        finmindStatus = `${finmindNetBuy.size > 0 ? 'ok' : '⚠ 全部無有效資料'}（${parts.join('，')}）`;

        // 成功數是 0 時，把前 3 筆的診斷細節也附上，不用等下一輪再手動排查
        if (finmindNetBuy.size === 0 && debugInfo.length > 0) {
          finmindStatus += ` | 診斷樣本: ${JSON.stringify(debugInfo.slice(0, 3))}`;
        }
      } catch (e) {
        finmindStatus = `查詢失敗（本次上櫃候選股的法人因子維持中性值）: ${e.message}`;
      }
    }

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
        taiex: realTaiexChangePercent !== null ? 'ok（使用真實 TAIEX 指數）' : `改用估計值${taiexWarning ? ` ⚠ ${taiexWarning}` : ''}`,
        finmindTpexInstitutional: finmindStatus,
      },
      historicalDatesUsed: datesUsed,
      marketChangePercent: result.marketChangePercent,
      marketChangePercentIsEstimate: realTaiexChangePercent === null, // 前端可以用這個決定要不要顯示「近似」字樣
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
