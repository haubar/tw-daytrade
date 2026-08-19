// netlify/functions/lib/day-trade-eligibility.mjs
//
// 抓取「上市股票每日當日沖銷交易標的及統計」，用來判斷一檔股票今天能不能做現股當沖。
// 對應《後續修改清單》P3「當沖資格過濾」：這個工具本身叫「當沖判斷器」，但先前完全沒有
// 檢查過候選股票是不是真的能當沖——不是所有股票都能當沖，只有交易所公告的當沖標的清單裡
// 的股票才可以（一般是台灣50、中型100、富櫃50成分股，以及可發行權證的標的等，詳見
// 證交所「現股當日沖銷交易專區」的公告條件，這裡不重新複製那份條件清單，直接以官方
// 每日公告的名單為準，比自己維護一份規則清單更不容易過時）。
//
// 端點：TWSE OpenAPI /exchangeReport/TWTB4U（已在 openapi.twse.com.tw/v1/swagger.json 裡
// 確認過欄位，是 JSON 格式，不像 T86 法人資料要解析 HTML）。
// 只涵蓋上市（TWSE）——上櫃（TPEx）的當沖標的清單目前沒有找到對應的公開 JSON 端點
// （只找到「上櫃股票現股當沖交易標的資訊」這個資料集存在，但沒有確認到可直接呼叫的
// OpenAPI 路徑），所以上櫃股票的當沖資格目前回傳「未知」而不是「不可當沖」——
// 沒有資料不等於不合格，不能把「不知道」跟「否定」混為一談。

const TWTB4U_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/TWTB4U';

/**
 * 從 TWTB4U 回傳的原始列資料，整理出「今天可以現股當沖」的上市股票代碼集合。
 * 拆成獨立函式（不直接綁在 fetch 裡）方便用固定樣本資料測試解析邏輯，不用真的連網路。
 *
 * TWTB4U 的邏輯是：出現在這份清單裡的股票，原則上是當沖標的；但 Suspension 欄位
 * （暫停現股賣出後現款買進當沖註記）如果有值，代表今天這檔被臨時暫停當沖資格
 * （常見原因是列入注意股、處置股、或除權息前後），這種要排除。
 *
 * @param {Array<{Code?: string, Suspension?: string}>} rows
 * @returns {Set<string>}
 */
export function parseDayTradeEligibleRows(rows) {
  const eligibleCodes = new Set();
  if (!Array.isArray(rows)) return eligibleCodes;

  for (const row of rows) {
    const code = String(row?.Code ?? '').trim();
    if (!code) continue;
    const suspended = String(row?.Suspension ?? '').trim() !== '';
    if (!suspended) eligibleCodes.add(code);
  }
  return eligibleCodes;
}

/**
 * 抓取今天上市股票的現股當沖資格清單。
 *
 * @returns {Promise<Set<string>>} 今天可以現股當沖的上市股票代碼集合
 */
export async function fetchDayTradeEligibleCodes() {
  const res = await fetch(TWTB4U_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    throw new Error(`當沖標的清單端點回應錯誤: HTTP ${res.status}`);
  }
  const rows = await res.json();
  return parseDayTradeEligibleRows(rows);
}
