// netlify/functions/lib/institutional.mjs
//
// 抓取「三大法人買賣超日報」（外資+投信+自營商），取代原本規劃的隔日沖分點因子。
//
// 為什麼不是分點資料：原本規劃查詢 bsr.twse.com.tw 取得券商分點進出，
// 但該系統有圖形驗證碼保護，無法在 Netlify Function 裡自動化查詢（也不該寫繞過驗證碼的程式碼）。
// 三大法人買賣超日報是官方免費資料、有清楚的查詢端點、而且是「全市場一次撈到」，
// 不像分點資料需要「先篩選出候選名單、再逐檔查詢」的兩階段設計，架構更簡單。
//
// 端點格式：已用真實請求驗證過（見 PROGRESS.md），回傳的是 HTML 表格（不是乾淨的 JSON），
// 所以用 cheerio 解析。欄位包含外資、投信、自營商買賣超，以及加總後的「三大法人買賣超股數」，
// 這裡直接取用加總欄位，不用自己重新加總三個子項目。

import * as cheerio from 'cheerio';

const T86_URL_BASE = 'https://www.twse.com.tw/fund/T86';

/**
 * 把千分位逗號數字字串轉成數字（例如 "14,785,200" → 14785200）
 */
function parseThousands(text) {
  const cleaned = String(text).replace(/,/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 從報表 HTML 中擷取「這份報表實際是哪一天的資料」（民國年格式，例如「115年05月11日」），
 * 轉成西元 YYYY-MM-DD。
 *
 * 為什麼需要這個：驗證 history.mjs 用的歷史資料端點時，發現 TWSE 的 date 參數不完全可靠
 * （送出去的日期跟實際拿到的資料日期對不上）。這裡先把「擷取報表實際日期」的能力做出來，
 * 讓 fetchInstitutionalNetBuy 可以比對「我要的日期」跟「實際拿到的日期」是否一致，
 * 不要盲目信任送出去的參數。
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

  const url = `${T86_URL_BASE}?response=html&date=${dateParam}&selectType=ALL`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`三大法人買賣超日報端點回應錯誤: HTTP ${res.status}`);
  }
  const html = await res.text();

  const netBuyByCode = parseInstitutionalHtml(html);
  const actualDate = extractReportDate(html);
  // 找不到日期（null）時不算「對不上」，因為那是另一種問題（格式解析失敗，parseInstitutionalHtml
  // 那邊的欄位偵測機制已經處理），這裡只在「有抓到日期、但跟預期不同」時才標記為 mismatch
  const dateMismatch = actualDate !== null && actualDate !== requestedDate;

  return { netBuyByCode, requestedDate, actualDate, dateMismatch };
}

/**
 * 從 HTML 內容解析出 code -> 三大法人買賣超股數 的 map。
 * 拆成獨立函式（不直接綁在 fetch 裡）是為了方便用固定的 HTML 樣本測試解析邏輯，不用真的連網路。
 *
 * @param {string} html
 * @returns {Map<string, number>}
 */
export function parseInstitutionalHtml(html) {
  const $ = cheerio.load(html);
  const netBuyByCode = new Map();

  // 找出表頭，確認「三大法人買賣超股數」欄位的位置（不寫死欄位順序，因為官方報表格式可能會調整）
  const headerCells = $('table').first().find('tr').first().find('th, td');
  let netBuyColumnIndex = -1;
  headerCells.each((i, el) => {
    const text = $(el).text().trim();
    if (text.includes('三大法人買賣超股數')) {
      netBuyColumnIndex = i;
    }
  });

  if (netBuyColumnIndex === -1) {
    // 找不到預期的欄位，代表報表格式可能變了，寧可回傳空結果讓上層知道「這次沒抓到資料」，
    // 也不要用錯的欄位位置算出誤導性的數字
    return netBuyByCode;
  }

  $('table')
    .first()
    .find('tr')
    .slice(1) // 跳過表頭
    .each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length <= netBuyColumnIndex) return;

      const code = $(cells[0]).text().trim();
      const netBuyText = $(cells[netBuyColumnIndex]).text().trim();
      if (!code || netBuyText === '') return;

      netBuyByCode.set(code, parseThousands(netBuyText));
    });

  return netBuyByCode;
}
