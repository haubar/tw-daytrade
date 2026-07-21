// netlify/functions/lib/finmind.mjs
//
// 抓取 FinMind（finmindtrade.com）的個股三大法人買賣超資料，補齊 institutional.mjs（T86）
// 沒有涵蓋到的上櫃（TPEx）股票——T86 端點只有上市股票的法人買賣超，見 institutional.mjs 的說明。
//
// 為什麼選 FinMind 而不是像 fubon-ebrokerdj 那類券商看盤網站：FinMind 是正式的開源金融資料平台，
// 有清楚的官方 REST API 文件（llms.txt / llms-full.txt），是設計給程式查詢用的，不是繞過人類
// 互動介面的爬蟲對象。
//
// 端點格式沿革（重要，記錄清楚避免以後重踩）：
// 這個模組是照 FinMind 官方文件描述的格式撰寫，**還沒有在這個環境用真實請求驗證過**
// （FinMind 官網本身要 JS 渲染才能瀏覽，且我方環境的抓取工具在測試過程中出現快取問題，
// 沒能拿到可信的即時回應）。部署到 Netlify 後第一次執行，務必檢查 dataSourceStatus 裡
// 這個資料源的狀態，如果解析失敗，錯誤訊息會列出實際欄位，比照 institutional.mjs／history.mjs
// 過去幾次「先用文件寫、部署後校正」的做法修正。
//
// Token：從環境變數 FINMIND_TOKEN 讀取，不寫死在程式碼裡。免費方案有 token 是 600 次/小時，
// 沒 token 是 300 次/小時；我們只查特定幾檔上櫃股票（不是查全市場），照文件描述屬於免費層可用範圍，
// 但這點也還沒有實測確認，是根據文件的合理推測。

const FINMIND_API_URL = 'https://api.finmindtrade.com/api/v4/data';
const DATASET = 'TaiwanStockInstitutionalInvestorsBuySell';

/**
 * 把 FinMind 回傳的 { data: [{date, stock_id, buy, name, sell}, ...] } 陣列，
 * 依股票代碼加總「外資+投信+自營商」的買超股數減賣超股數，得到單一淨買超數字，
 * 格式跟 institutional.mjs 的 netBuyByCode（Map<code, netBuyShares>）保持一致，
 * 這樣 screen.mjs／scan.mjs 合併兩個來源時不用寫兩套邏輯。
 *
 * 拆成獨立函式方便用固定樣本測試，不用每次都連網路。
 *
 * @param {Array} rows FinMind 回傳的 data 陣列，每筆 {date, stock_id, buy, name, sell}
 * @returns {Map<string, number>}
 */
export function parseFinMindInstitutionalRows(rows) {
  const netBuyByCode = new Map();
  if (!Array.isArray(rows)) return netBuyByCode;

  for (const row of rows) {
    if (!row || typeof row.stock_id !== 'string') continue;
    const buy = Number(row.buy);
    const sell = Number(row.sell);
    if (!Number.isFinite(buy) || !Number.isFinite(sell)) continue;

    const net = buy - sell;
    const existing = netBuyByCode.get(row.stock_id) ?? 0;
    netBuyByCode.set(row.stock_id, existing + net);
  }

  return netBuyByCode;
}

/**
 * 抓取指定股票清單在某一天的三大法人買賣超（用於補齊上櫃股票，T86 沒有的部分）。
 * 每檔股票各發一次請求（FinMind 的 data_id 一次只接受單一股票代碼），全部平行發出
 * （沿用階段 14/19 學到的教訓：序列請求容易逾時，一次平行發送的數量也不能太多——
 * 台股上櫃約 800 檔，這裡不會、也不該一次全部平行發，只針對候選股票清單查詢）。
 *
 * @param {string[]} stockIds 要查詢的股票代碼清單（例如 screen.mjs 篩出的上櫃候選股）
 * @param {string} dateStr 'YYYY-MM-DD'
 * @returns {Promise<{netBuyByCode: Map<string, number>, failedStockIds: string[], emptyStockIds: string[], debugInfo: Array}>}
 */
export async function fetchFinMindInstitutionalNetBuy(stockIds, dateStr) {
  const token = process.env.FINMIND_TOKEN;
  const netBuyByCode = new Map();
  const failedStockIds = [];
  const emptyStockIds = []; // 請求技術上成功，但 FinMind 回傳的 data 是空陣列（沒有失敗，但也沒有資料）

  if (!stockIds || stockIds.length === 0) {
    return { netBuyByCode, failedStockIds, emptyStockIds, debugInfo: [] };
  }

  const results = await Promise.allSettled(
    stockIds.map(async (stockId) => {
      const params = new URLSearchParams({
        dataset: DATASET,
        data_id: stockId,
        start_date: dateStr,
        end_date: dateStr,
      });
      if (token) params.set('token', token);

      const res = await fetch(`${FINMIND_API_URL}?${params.toString()}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        throw new Error(`FinMind API 回應錯誤: HTTP ${res.status}（股票代碼 ${stockId}）`);
      }
      const body = await res.json();
      if (body.status !== 200) {
        // FinMind 用 HTTP 200 + body 裡的 status 欄位回報業務邏輯錯誤（例如額度用完、等級不夠），
        // 跟一般 REST API 用 HTTP 狀態碼表達錯誤的習慣不同，要另外檢查
        throw new Error(`FinMind 回應業務邏輯錯誤: ${body.msg ?? '未知原因'}（股票代碼 ${stockId}）`);
      }
      return { stockId, rows: body.data, hasToken: Boolean(token) };
    })
  );

  // 診斷資訊：跟 backfill-history.mjs 的 debugInfo 同樣的精神——第一次真實部署發現
  // 「查了 20 檔、成功 0 檔、但也沒有失敗紀錄」這種矛盾結果後才加的。這代表「技術上成功
  // 但資料是空陣列」的情況完全沒被計入成功也沒被計入失敗，直接消失，沒有這份 debugInfo
  // 的話根本看不出問題出在哪（例如免費層 token 對近期日期的存取範圍受限，導致每筆查詢
  // 都技術上成功、但回傳空陣列）。
  const debugInfo = [];

  results.forEach((result, i) => {
    const stockId = stockIds[i];
    if (result.status === 'fulfilled') {
      const rowCount = Array.isArray(result.value.rows) ? result.value.rows.length : -1;
      debugInfo.push({ stockId, rowCount, hasToken: result.value.hasToken, error: null });

      const parsed = parseFinMindInstitutionalRows(result.value.rows);
      const net = parsed.get(result.value.stockId);
      if (net !== undefined) {
        netBuyByCode.set(result.value.stockId, net);
      } else {
        emptyStockIds.push(stockId);
      }
    } else {
      debugInfo.push({ stockId, rowCount: null, hasToken: Boolean(token), error: result.reason.message });
      failedStockIds.push(stockId);
    }
  });

  return { netBuyByCode, failedStockIds, emptyStockIds, debugInfo };
}
