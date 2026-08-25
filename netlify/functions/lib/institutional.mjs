// netlify/functions/lib/institutional.mjs
//
// 抓取「三大法人買賣超日報」（外資+投信+自營商），取代原本規劃的隔日沖分點因子。
//
// 為什麼不是分點資料：原本規劃查詢 bsr.twse.com.tw 取得券商分點進出，
// 但該系統有圖形驗證碼保護，無法在 Netlify Function 裡自動化查詢（也不該寫繞過驗證碼的程式碼）。
// 三大法人買賣超日報是官方免費資料、有清楚的查詢端點、而且是「全市場一次撈到」，
// 不像分點資料需要「先篩選出候選名單、再逐檔查詢」的兩階段設計，架構更簡單。
//
// 端點：改用 JSON 版本 https://www.twse.com.tw/rwd/zh/fund/T86?date=...&selectType=ALL&response=json
// （已用真實請求打過驗證，回傳格式是 { stat, date, fields, data, ... }，stat==='OK' 代表有資料）。
//
// 為什麼從 HTML 版本改過來：原本用 https://www.twse.com.tw/fund/T86?response=html 配 cheerio
// 解析表格。部署觀察一陣子後用 data-source-stats.mjs 統計工具發現，法人資料幾乎每天都是
// 「技術上成功、但解析出來是空的 Map」，追查後確認舊的 URL 路徑（少了 /rwd/zh/ 前綴）跟
// TWSE 目前實際服務的正確路徑對不上，導致 HTML 結構跟預期的欄位比對邏輯抓不到資料，
// 又沒有丟出明確的例外，靜靜地回傳空結果。JSON 版本結構穩定、有明確的 stat 欄位可以判斷
// 「這天真的沒資料」還是「格式跑掉了」，比繼續修 HTML 解析更根本地解決問題。
//
// 欄位陷阱（沿用官方文件的提醒）：外資被拆成「外陸資（不含外資自營商）」跟「外資自營商」
// 兩組，自營商被拆成「自行買賣」跟「避險」兩組，如果自己把看起來像的欄位全部加總，
// 同一筆會被算兩次——這裡直接用官方已經算好的「三大法人買賣超股數」這個彙總欄位，
// 不自己重新加總子項目。

const T86_URL_BASE = 'https://www.twse.com.tw/rwd/zh/fund/T86';
const CODE_FIELD_NAME = '證券代號';
const NET_BUY_FIELD_NAME = '三大法人買賣超股數';

/**
 * 把千分位逗號數字字串轉成數字（例如 "14,785,200" → 14785200）
 */
function parseThousands(text) {
  const cleaned = String(text).replace(/,/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 從報表 HTML（另一個端點用的格式，例如 history.mjs 抓的歷史行情表格標題）中擷取
 * 「這份報表實際是哪一天的資料」（民國年格式，例如「115年05月11日」），轉成西元 YYYY-MM-DD。
 *
 * 這個函式現在只給 history.mjs 用（那個端點的日期還是包在 HTML/title 字串裡）；
 * T86 本身已經改用 JSON 版本，日期直接從回應的 date 欄位讀（純數字格式，見 formatT86Date），
 * 不需要再從 HTML 文字裡擷取。
 *
 * @param {string} html
 * @returns {string | null} 'YYYY-MM-DD' 格式，找不到則回傳 null
 */
export function extractReportDate(html) {
  const match = html.match(/(\d{2,3})年(\d{1,2})月(\d{1,2})日/);
  if (!match) return null;
  const rocYear = parseInt(match[1], 10);
  const year = rocYear + 1911;
  const month = String(match[2]).padStart(2, '0');
  const day = String(match[3]).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 把 T86 JSON 回應的 date 欄位（例如 '20260821'，純西元年月日八碼數字，不是民國年）
 * 轉成 'YYYY-MM-DD'。
 * @param {string|number|undefined|null} dateValue
 * @returns {string|null}
 */
export function formatT86Date(dateValue) {
  const str = String(dateValue ?? '').trim();
  if (!/^\d{8}$/.test(str)) return null;
  return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
}

/**
 * 從 T86 JSON 回應解析出 code -> 三大法人買賣超股數 的 map。
 * 拆成獨立函式（不直接綁在 fetch 裡）方便用固定的 JSON 樣本測試解析邏輯，不用真的連網路。
 *
 * 不寫死欄位順序，依欄位「名稱」在 fields 陣列裡找索引，避免官方之後調整欄位順序時
 * 程式碼跟著壞掉（沿用原本 HTML 版本就有的設計原則）。
 *
 * @param {{stat?: string, fields?: string[], data?: Array<Array<string|number>>}} payload
 * @returns {Map<string, number>}
 */
export function parseInstitutionalJson(payload) {
  const netBuyByCode = new Map();

  // stat !== 'OK' 代表非交易日或查無資料（官方端點會明確回報，不是默默回退到上一個交易日），
  // 這種情況回傳空 Map 是正確行為，不是解析失敗。
  if (!payload || payload.stat !== 'OK' || !Array.isArray(payload.fields) || !Array.isArray(payload.data)) {
    return netBuyByCode;
  }

  const codeIndex = payload.fields.indexOf(CODE_FIELD_NAME);
  const netBuyIndex = payload.fields.indexOf(NET_BUY_FIELD_NAME);
  if (codeIndex === -1 || netBuyIndex === -1) {
    // 找不到預期欄位，代表官方格式可能又變了，寧可回傳空結果讓上層知道「這次沒抓到資料」，
    // 也不要用錯的欄位位置算出誤導性的數字
    return netBuyByCode;
  }

  for (const row of payload.data) {
    if (!Array.isArray(row)) continue;
    const code = String(row[codeIndex] ?? '').trim();
    if (!code) continue;
    netBuyByCode.set(code, parseThousands(row[netBuyIndex]));
  }

  return netBuyByCode;
}

/**
 * 抓取指定日期的三大法人買賣超日報。
 * 只涵蓋上市（TWSE）股票——上櫃（TPEx）的法人買賣超是不同的資料源，目前尚未串接（見 README 已知限制）。
 *
 * @param {Date} [date] 預設今天
 * @returns {Promise<{netBuyByCode: Map<string, number>, requestedDate: string, actualDate: string|null, dateMismatch: boolean}>}
 */
export async function fetchInstitutionalNetBuy(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const dateParam = `${y}${m}${d}`;
  const requestedDate = `${y}-${m}-${d}`;

  const url = `${T86_URL_BASE}?date=${dateParam}&selectType=ALL&response=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    throw new Error(`三大法人買賣超日報端點回應錯誤: HTTP ${res.status}`);
  }
  const payload = await res.json();

  const netBuyByCode = parseInstitutionalJson(payload);
  const actualDate = formatT86Date(payload?.date);
  // 找不到日期（null）時不算「對不上」，因為那是另一種問題（stat 不是 OK、或格式又變了，
  // parseInstitutionalJson 那邊的欄位偵測機制已經處理），這裡只在「有抓到日期、但跟預期不同」
  // 時才標記為 mismatch
  const dateMismatch = actualDate !== null && actualDate !== requestedDate;

  return { netBuyByCode, requestedDate, actualDate, dateMismatch };
}
