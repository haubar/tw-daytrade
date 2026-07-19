// netlify/functions/lib/taiex.mjs
//
// 抓取真實的 TAIEX（發行量加權股價指數）當日漲跌百分比，取代原本用「全市場成交值加權平均
// 漲跌幅」估計出來的近似值（見 factors.mjs 的 computeMarketChangeProxy）。
//
// 用的是 openapi.twse.com.tw 的 MI_INDEX 端點——這個網域我們已經在用（fetchTodayTwseQuotes
// 用的就是同網域的 STOCK_DAY_ALL），已知穩定可連線，風險比接新網域低很多。
//
// 已用真實請求驗證過：這個端點回傳「全部指數」的清單（發行量加權股價指數、臺灣50指數、
// 各類股指數等上百筆），我們只需要「發行量加權股價指數」這一筆，直接取「漲跌百分比」欄位
// （已經是帶正負號的數字字串，例如 "-0.58"），不用像個股資料那樣額外處理顏色/正負號分開的問題。

const TAIEX_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX';
const TAIEX_INDEX_NAME = '發行量加權股價指數';

/**
 * 從 MI_INDEX 回傳的指數清單裡解析出 TAIEX 當日漲跌百分比。
 * 拆成獨立函式方便用固定樣本測試，不用每次都連網路。
 *
 * @param {Array} rows MI_INDEX 回傳的原始 JSON 陣列
 * @returns {number|null} 找不到對應指數、或欄位無法解析成數字時回傳 null（不拋出例外），
 *   讓呼叫端可以優雅退回估計值，而不是讓整個請求失敗
 */
export function parseTaiexChangePercent(rows) {
  if (!Array.isArray(rows)) return null;

  const taiexRow = rows.find((r) => r && r['指數'] === TAIEX_INDEX_NAME);
  if (!taiexRow) return null;

  const n = Number(taiexRow['漲跌百分比']);
  return Number.isFinite(n) ? n : null;
}

/**
 * 抓取今日 TAIEX 漲跌百分比。
 * @returns {Promise<number|null>} 成功解析出數字則回傳該值；端點回應正常但解析不出 TAIEX
 *   這筆資料時回傳 null（不拋出例外）；HTTP 錯誤或逾時則拋出例外，交給呼叫端決定如何降級
 */
export async function fetchTaiexChangePercent() {
  const res = await fetch(TAIEX_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    throw new Error(`TAIEX 指數端點回應錯誤: HTTP ${res.status}`);
  }
  const rows = await res.json();
  return parseTaiexChangePercent(rows);
}
