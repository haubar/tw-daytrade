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

import { normalizeTwseRow, normalizeTpexRow, isTradableRow, isWarrant } from './lib/normalize.mjs';
import {
  getRecentVolumeHistory,
  getRecentChangeHistory,
  getRecentMarketChangeHistory,
  appendDailySnapshot,
  DEFAULT_HISTORY_WINDOW_DAYS,
} from './lib/volume-archive.mjs';
import { computeChangePercent, computeMarketChangeProxy } from './lib/factors.mjs';
import { fetchInstitutionalNetBuy } from './lib/institutional.mjs';
import { fetchFinMindInstitutionalNetBuy } from './lib/finmind.mjs';
import { fetchTaiexChangePercent } from './lib/taiex.mjs';
import { fetchDayTradeEligibleCodes } from './lib/day-trade-eligibility.mjs';
import { screenWatchlists, getTpexCandidateCodes } from './lib/screen.mjs';
import { getScanByDate, saveLatestScan } from './lib/storage.mjs';
import { evaluateOpenToCloseLong } from './lib/backtest.mjs';
import { saveBacktestResult } from './lib/backtest-storage.mjs';
import { isNonTradingDay, isMarketDataReady } from './lib/trading-day.mjs';
import { getExchangeHolidaysForYears } from './lib/trading-calendar-cache.mjs';

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
  // isWarrant 過濾權證（見 lib/normalize.mjs 的說明）：雖然這次真實部署發現的異常數字
  // （4644 檔）是在 TPEx 那邊，但 TWSE 上市權證理論上也可能混在 STOCK_DAY_ALL 的回應裡，
  // 兩邊一併過濾，不要只挑出問題的那一邊修。
  return rows.map(normalizeTwseRow).filter(isTradableRow).filter((q) => !isWarrant(q));
}

async function fetchTodayTpexQuotes() {
  // 見 README「已知限制」：TPEx 欄位尚未實際驗證，欄位對不上時會拋出錯誤，
  // 這裡選擇讓錯誤往上傳遞（而不是吞掉），因為上櫃資料如果抓錯，整份候選名單的
  // 「全市場」前提就不成立了，寧可讓使用者知道，也不要默默只用上市資料出結果。
  const res = await fetch(TPEX_URL, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`TPEx API 回應錯誤: HTTP ${res.status}`);
  const rows = await res.json();
  return rows.map(normalizeTpexRow).filter(isTradableRow).filter((q) => !isWarrant(q));
}

export default async (req) => {
  const startedAt = Date.now();
  const todayDateStr = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  try {
    // 三個資料來源彼此獨立，全部平行發出。歷史資料現在是讀 Netlify Blobs 裡累積的紀錄
    // （見 volume-archive.mjs），不再現場跟 TWSE 要好幾天份資料——這是部署後實測發現的
    // 效能瓶頸，改成這樣之後，理論上每次執行只需要各資料來源各一次請求，速度快很多。
    const [twseResult, tpexResult, historyResult, changeHistoryResult, marketChangeHistoryResult, institutionalResult, taiexResult, dayTradeEligibleResult] = await Promise.allSettled([
      fetchTodayTwseQuotes(),
      fetchTodayTpexQuotes(),
      getRecentVolumeHistory(DEFAULT_HISTORY_WINDOW_DAYS, todayDateStr),
      getRecentChangeHistory(DEFAULT_HISTORY_WINDOW_DAYS, todayDateStr),
      getRecentMarketChangeHistory(DEFAULT_HISTORY_WINDOW_DAYS, todayDateStr),
      fetchInstitutionalNetBuy(),
      fetchTaiexChangePercent(),
      fetchDayTradeEligibleCodes(),
    ]);

    const todayQuotes = [
      ...(twseResult.status === 'fulfilled' ? twseResult.value : []),
      ...(tpexResult.status === 'fulfilled' ? tpexResult.value : []),
    ];

    if (todayQuotes.length === 0) {
      throw new Error('今日行情抓取失敗，TWSE 與 TPEx 皆無資料可用');
    }

    // TAIEX 抓取失敗、或端點回應正常但解析不出資料（回傳 null），都優雅退回原本的估計值
    // （computeMarketChangeProxy，見 screen.mjs），不會讓整個掃描失敗——大盤漲跌幅本來就只是
    // 「相對強弱」因子的比較基準之一，不是關鍵路徑上的必要資料。
    // 這段移到 appendDailySnapshot 之前，是因為存進歷史累積庫的「今天的大盤漲跌幅」需要用到
    // 這個值（給明天的多日相對強弱因子當比較基準，見 volume-archive.mjs 的 getRecentMarketChangeHistory）。
    let realTaiexChangePercent = null;
    let taiexWarning = null;
    if (taiexResult.status === 'fulfilled' && taiexResult.value !== null) {
      realTaiexChangePercent = taiexResult.value;
    } else if (taiexResult.status === 'fulfilled') {
      taiexWarning = 'TAIEX 端點回應正常，但解析不出「發行量加權股價指數」這筆資料，改用估計值';
    } else {
      taiexWarning = `TAIEX 指數抓取失敗，改用估計值: ${taiexResult.reason.message}`;
    }
    // 沒有真實 TAIEX 時，存進歷史累積庫的大盤漲跌幅改用跟 screenWatchlists 同一套估計公式
    // （computeMarketChangeProxy），確保「今天存進去給明天用的大盤數字」跟「今天實際拿來排名用的
    // 大盤數字」是同一個值，不會兩邊對不上。
    const marketChangePercentForArchive = realTaiexChangePercent ?? computeMarketChangeProxy(todayQuotes);

    // 把今天的資料存進 Blobs 累積庫，讓「明天」執行時可以讀到今天的資料當作歷史的一部分。
    // 如果今天是週六日（例如使用者手動觸發測試剛好選在週末），TWSE 端點還是會回傳「最近一個
    // 交易日」的資料（例如週五的資料），但那筆資料不該被標記成「今天（週末）」存進歷史累積庫——
    // 這樣會產生一筆假的非交易日資料，汙染量能異常因子的計算基礎（週五的量能會被誤算成
    // 「這是週末當天的量能」，跟真正的週五那天分開計算，導致同一份資料被扭曲成兩筆不同的天）。
    // 這一步失敗（或跳過）不應該讓整個掃描失敗，獨立包 try/catch。
    //
    // dynamicHolidays 是 sync-trading-calendar.mjs 自動同步下來的官方休市日（見
    // trading-calendar-cache.mjs），比 trading-day.mjs 裡手動維護的靜態表更即時、更不容易
    // 因為忘記手動更新而過期。讀取失敗（例如還沒同步過、Blobs 連線問題）優雅退回空集合，
    // isNonTradingDay 本身還是會用靜態表當備援，不會讓整個判斷失效。
    let dynamicHolidays = new Set();
    try {
      const now = new Date();
      dynamicHolidays = await getExchangeHolidaysForYears([now.getFullYear(), now.getFullYear() + 1]);
    } catch {
      // 讀取失敗就當作沒有自動同步的資料，靜態表依然有效，不影響主流程
    }

    let archiveWarning = null;
    if (isNonTradingDay(new Date(), dynamicHolidays)) {
      archiveWarning = '今天是非交易日（週末或交易所休市日），不寫入歷史累積庫，避免產生無效的交易日資料';
    } else if (!isMarketDataReady(new Date())) {
      // 台股 13:30 收盤，太早查詢可能拿到還沒最終確認的盤後資料，先不寫進歷史累積庫，
      // 避免把不準確的資料當成「今天的正式收盤資料」存下來，之後拿來算量能異常因子會失真。
      // 排程本身是設定在台灣時間 14:10 觸發（見檔頭排程設定），本來就會過這個檢查，
      // 這裡主要是防呆使用者在下午 2 點前手動觸發測試的情況。
      archiveWarning = '現在還沒到台灣時間下午 2 點，盤後資料可能還沒確定下來，先不寫入歷史累積庫（可以晚一點再手動觸發一次，或等排程在 14:10 自動執行）';
    } else {
      try {
        // 把每檔股票當日漲跌幅一併存進去，給明天的多日相對強弱因子用（見 factors.mjs 的
        // computeMultiDayRelativeStrength、volume-archive.mjs 的 getRecentChangeHistory）。
        const todayQuotesWithChangePercent = todayQuotes.map((q) => ({
          ...q,
          changePercent: computeChangePercent(q.change, q.close - q.change),
        }));
        await appendDailySnapshot(todayDateStr, todayQuotesWithChangePercent, undefined, {
          marketChangePercent: marketChangePercentForArchive,
        });
      } catch (e) {
        archiveWarning = `今日資料寫入歷史累積庫失敗（不影響本次結果，但明天的歷史資料會少這一天）: ${e.message}`;
      }
    }

    // getRecentVolumeHistory 內部如果連不到 Blobs 會整個 reject，這裡保守處理成「視為沒有歷史資料」，
    // 而不是讓整個 scan 跟著死掉——量能異常因子會全部是中性值，但其他三個因子還是能正常運作。
    // 天數設定為 DEFAULT_HISTORY_WINDOW_DAYS（見 volume-archive.mjs 的說明，原本 3 天拉長到 5 天，
    // 降低單一天異常量能對均量基準的干擾）：剛開始使用（或剛清空 Blobs 累積庫）的前幾天，
    // 累積天數不夠，可以先用 backfill-history.mjs 手動補資料加速暖機。
    const { volumeHistory, datesUsed } =
      historyResult.status === 'fulfilled' ? historyResult.value : { volumeHistory: new Map(), datesUsed: [] };

    // 多日相對強弱因子的歷史資料。跟量能歷史一樣採優雅退化：讀取失敗就當作沒有歷史資料，
    // screenWatchlists/buildCandidate 會自動退回單日版本的相對強弱（見 screen.mjs 的說明），
    // 不會讓整個掃描失敗。
    const changeHistory = changeHistoryResult.status === 'fulfilled' ? changeHistoryResult.value : new Map();
    const marketChangeHistory = marketChangeHistoryResult.status === 'fulfilled' ? marketChangeHistoryResult.value : [];

    // 法人買賣超抓取失敗不應該讓整個掃描失敗——沒有這個因子還是可以用其他三個因子繼續產生結果，
    // 只是這次的結果會少一個訊號來源。這裡要分清楚三種完全不同的情況，不能混在一起：
    // ①真的抓取失敗（fetch 丟例外：逾時、HTTP錯誤）②抓到但日期對不上③fetch 正常完成、
    // 也沒有日期問題，但解析出來的 netBuyByCode 剛好是空的（例如非交易日、或官方格式跑掉）。
    //
    // 真實踩過的 bug：原本只處理①②，③這種情況 institutionalWarning 會一直是 null，
    // 但下面組 dataSourceStatus 訊息時，只要 institutionalNetBuy.size===0 就會印出
    // `失敗: ${institutionalWarning}`，變成看起來很嚇人的「失敗: null」——這其實不是「抓取失敗」，
    // 是「有抓到回應，但解析結果是空的」，兩者原因、該採取的處理方式完全不同，混在一起
    // 的訊息會誤導看的人去查「網路是不是斷了」，而不是去查「解析邏輯是不是有問題」。
    let institutionalNetBuy = new Map();
    let institutionalWarning = null;
    if (institutionalResult.status === 'fulfilled') {
      institutionalNetBuy = institutionalResult.value.netBuyByCode;
      if (institutionalResult.value.dateMismatch) {
        // 比照 history.mjs 驗證歷史資料端點時發現的問題：date 參數不一定可靠，
        // 這裡不是直接丟棄資料（資料本身可能還是有效的，只是不是今天的），而是清楚標記出來，
        // 讓看結果的人知道這個因子可能不是當日資料，之後再視情況決定要不要改成重試或直接排除。
        institutionalWarning = `法人買賣超資料日期與預期不符（預期 ${institutionalResult.value.requestedDate}，實際拿到 ${institutionalResult.value.actualDate}），本次結果可能不是最新的法人資料`;
      } else if (institutionalNetBuy.size === 0) {
        // 情況③：fetch 本身沒有問題，但解析出來是空的——常見原因是非交易日（T86 對非交易日
        // 會明確回報查無資料，不是靜靜地退回上一個交易日）、或官方報表格式又變了導致欄位
        // 比對不到。跟「抓取失敗」用完全不同的措辭，才不會誤導成網路問題。
        institutionalWarning = `法人買賣超資料抓取成功，但解析結果是空的（可能是非交易日查無資料，或官方報表格式跟預期不同）`;
      }
    } else {
      institutionalWarning = `法人買賣超資料抓取失敗（本次結果的法人因子將全部視為中性）: ${institutionalResult.reason.message}`;
    }

    // 當沖資格清單抓取失敗一樣優雅退化：不影響掃描其他部分，只是這次結果的 dayTradeEligible
    // 欄位全部會是 null（未知），不會誤判成「這些股票都不能當沖」。
    let dayTradeEligibleCodes = null;
    let dayTradeEligibleWarning = null;
    if (dayTradeEligibleResult.status === 'fulfilled') {
      dayTradeEligibleCodes = dayTradeEligibleResult.value;
    } else {
      dayTradeEligibleWarning = `當沖標的清單抓取失敗（本次結果的 dayTradeEligible 欄位將全部是未知）: ${dayTradeEligibleResult.reason.message}`;
    }

    // topN 拉到 100（原本 30）：前端要做成交量/股價/漲幅篩選，如果候選池只有 30 檔，
    // 篩一篩很容易剩沒幾檔可看，拉大候選池篩選才有意義。
    //
    // 第一輪：用 T86（上市法人資料）跑一次，上櫃股票的法人因子暫時是中性值。
    const firstPassResult = screenWatchlists(todayQuotes, volumeHistory, institutionalNetBuy, {
      topN: 100,
      marketChangePercent: realTaiexChangePercent ?? undefined,
      changeHistory,
      marketChangeHistory,
      dayTradeEligibleCodes,
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
            changeHistory,
            marketChangeHistory,
            dayTradeEligibleCodes,
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
        // 訊息開頭統一用 'ok'／'失敗' 慣例（跟其他 dataSourceStatus 欄位一致），
        // 才能被 data-source-stats.mjs 的 classifyStatus() 正確分類——原本這裡用「⚠」開頭，
        // 沒有依循慣例，導致統計工具把「查了但全部沒抓到資料」誤判成 unknown（沒查），
        // 沒辦法反映真實的失敗率。
        finmindStatus = `${finmindNetBuy.size > 0 ? 'ok' : '失敗（全部無有效資料）'}（${parts.join('，')}）`;

        // 成功數是 0 時，把前 3 筆的診斷細節也附上，不用等下一輪再手動排查
        if (finmindNetBuy.size === 0 && debugInfo.length > 0) {
          finmindStatus += ` | 診斷樣本: ${JSON.stringify(debugInfo.slice(0, 3))}`;
        }
      } catch (e) {
        // 同樣統一用「失敗」開頭（原本是「查詢失敗」，"查詢"開頭會被 classifyStatus() 判斷成
        // unknown，不是 failed，統計數字會少算這種真正的例外情況）
        finmindStatus = `失敗（查詢時發生例外，本次上櫃候選股的法人因子維持中性值）: ${e.message}`;
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
          ? `ok（累積 ${datesUsed.length}/${DEFAULT_HISTORY_WINDOW_DAYS} 天，${datesUsed.length < DEFAULT_HISTORY_WINDOW_DAYS ? '尚未暖機完成，量能異常因子會偏向中性' : '天數足夠'}）${archiveWarning ? ` ⚠ ${archiveWarning}` : ''}`
          : `失敗（本次量能異常因子將全部視為中性）: ${historyResult.reason?.message ?? '未知錯誤'}`,
        // 多日相對強弱因子的暖機狀態，跟 historyArchive（量能異常因子）是分開累積的兩份資料，
        // 剛升級的前幾天，即使量能歷史已經累積好幾天，相對強弱因子還是會先退回單日版本，
        // 因為 changePercent／marketChangePercent 是這次升級後才開始存的，需要重新累積。
        relativeStrengthWindow: marketChangeHistory.length > 0
          ? `ok（累積 ${marketChangeHistory.length}/${DEFAULT_HISTORY_WINDOW_DAYS} 天，多日相對強弱因子已啟用）`
          : '尚未累積到任何一天的多日資料，相對強弱因子暫時全部使用單日版本（這是這次升級後才開始存的資料，需要幾個交易日重新累積）',
        taiex: realTaiexChangePercent !== null ? 'ok（使用真實 TAIEX 指數）' : `失敗，改用估計值${taiexWarning ? ` ⚠ ${taiexWarning}` : ''}`,
        finmindTpexInstitutional: finmindStatus,
        dayTradeEligibility: dayTradeEligibleCodes !== null
          ? `ok（${dayTradeEligibleCodes.size} 檔上市股票今天可以現股當沖；上櫃股票暫無資料源，一律顯示未知）`
          : `失敗（本次 dayTradeEligible 欄位全部顯示未知）: ${dayTradeEligibleWarning}`,
      },
      historicalDatesUsed: datesUsed,
      marketChangePercent: result.marketChangePercent,
      marketChangePercentIsEstimate: realTaiexChangePercent === null, // 前端可以用這個決定要不要顯示「近似」字樣
      totalCandidates: result.totalCandidates,
      // 診斷用：有多少「有歷史資料可以參與排名」的候選股是上市/上櫃。如果 tpexCandidatesWithHistory
      // 是 0，代表上櫃股票根本沒進入候選池，FinMind 兩階段流程的候選名單自然也會是空的——
      // 這樣才能分清楚「上櫃候選是 0」到底是因為「上櫃股票歷史資料沒累積到」還是「累積到了、
      // 但這次剛好沒有一檔上櫃股票排進前 100 名」，兩種情況的因應方式完全不同。
      twseCandidatesWithHistory: result.twseCandidatesWithHistory,
      tpexCandidatesWithHistory: result.tpexCandidatesWithHistory,
      excludedNoHistory: result.excludedNoHistory,
      longWatchlist: result.longWatchlist,
      shortWatchlist: result.shortWatchlist,
      backtest: null,
      disclaimer: '本結果僅供參考，不構成投資建議。當沖有資格與風險限制，請自行評估。',
    };

    // 基準回測：最近一個訊號日收盤後的多方榜，於今天開盤買入、收盤賣出。
    // 同一天重跑時會依 signalDate 覆蓋，避免同一筆績效被重複累加。
    if (datesUsed.length > 0) {
      try {
        const signalDate = datesUsed[0];
        const signalScan = await getScanByDate(signalDate);
        if (signalScan?.longWatchlist?.length > 0) {
          // 今天（執行日）如果有市場完全抓不到報價（例如上櫃端點逾時失敗），事先告訴
          // evaluateOpenToCloseLong，讓它在 skipped 訊息裡分清楚「這是系統性資料源問題」
          // 還是「這幾檔股票本身有問題」（見 backtest.mjs 的說明；這是實際發生過的真實案例：
          // 昨天多方榜剛好選到上櫃股票，今天上櫃資料源整個失敗，10 檔全部被跳過，
          // 原本的通用訊息會讓人誤以為是個股層級的異常）。
          const unavailableMarkets = new Set();
          if (tpexResult.status !== 'fulfilled') unavailableMarkets.add('TPEx');
          if (twseResult.status !== 'fulfilled') unavailableMarkets.add('TWSE');

          const backtestResult = {
            signalDate,
            executionDate: todayDateStr,
            generatedAt: new Date().toISOString(),
            ...evaluateOpenToCloseLong(signalScan.longWatchlist, todayQuotes, { unavailableMarkets }),
          };
          await saveBacktestResult(backtestResult);
          payload.backtest = backtestResult;
        }
      } catch (e) {
        // 回測紀錄是輔助資訊，不能讓正常的盤後掃描失敗。
        payload.backtestWarning = `基準回測紀錄失敗（不影響本次選股結果）: ${e.message}`;
      }
    }

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
