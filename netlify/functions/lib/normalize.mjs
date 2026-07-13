// netlify/functions/lib/normalize.mjs
//
// 把 TWSE（上市）與 TPEx（上櫃）兩種不同來源的每日行情，
// 轉換成同一份「統一格式」，方便後面的因子計算不用管資料來源差異。
//
// 統一格式（每檔股票一筆）：
// {
//   market: 'TWSE' | 'TPEx',
//   code: string,       // 股票代號
//   name: string,        // 股票名稱
//   open: number,
//   high: number,
//   low: number,
//   close: number,
//   volume: number,      // 成交股數
//   change: number,       // 漲跌（正負號已處理好）
// }

/**
 * 安全轉換字串為數字，處理逗號千分位、空字串、"--" 等髒資料
 */
function toNumber(val) {
  if (val === null || val === undefined) return 0;
  const cleaned = String(val).replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '--') return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 正規化 TWSE STOCK_DAY_ALL 回傳的單筆資料
 * 已用即時資料驗證欄位：Code, Name, TradeVolume, OpeningPrice, HighestPrice, LowestPrice, ClosingPrice, Change
 */
export function normalizeTwseRow(row) {
  return {
    market: 'TWSE',
    code: row.Code,
    name: row.Name,
    open: toNumber(row.OpeningPrice),
    high: toNumber(row.HighestPrice),
    low: toNumber(row.LowestPrice),
    close: toNumber(row.ClosingPrice),
    volume: toNumber(row.TradeVolume),
    change: toNumber(row.Change),
  };
}

/**
 * 正規化 TPEx（上櫃）資料。
 *
 * 注意：TPEx OpenAPI 的實際欄位名稱尚未在此環境驗證成功（該網域有防爬蟲機制擋下請求），
 * 這裡先用「候選欄位名稱表」做防禦性寫法：依序嘗試常見的欄位命名，
 * 部署到 Netlify 後第一次執行時，若欄位對不上，會丟出清楚的錯誤內容（印出原始 keys），
 * 方便快速修正，而不是默默算出錯誤數字。
 */
const TPEX_FIELD_CANDIDATES = {
  code: ['SecuritiesCompanyCode', 'Code', 'CompanyCode', 'StockCode'],
  name: ['CompanyName', 'Name'],
  open: ['Open', 'OpeningPrice'],
  high: ['High', 'HighestPrice'],
  low: ['Low', 'LowestPrice'],
  close: ['Close', 'ClosingPrice'],
  volume: ['TradingShares', 'TradeVolume', 'Volume'],
  change: ['Change', 'Diff'],
};

function pickField(row, candidates) {
  for (const key of candidates) {
    if (row[key] !== undefined) return row[key];
  }
  return undefined;
}

export function normalizeTpexRow(row) {
  const missing = [];
  const get = (field) => {
    const val = pickField(row, TPEX_FIELD_CANDIDATES[field]);
    if (val === undefined) missing.push(field);
    return val;
  };

  const code = get('code');
  const name = get('name');
  const open = get('open');
  const high = get('high');
  const low = get('low');
  const close = get('close');
  const volume = get('volume');
  const change = get('change');

  if (missing.length > 0) {
    // 不要靜默失敗：把原始 row 的 keys 印出來，方便對照真實欄位名稱後修正 TPEX_FIELD_CANDIDATES
    throw new Error(
      `TPEx 欄位對應失敗，缺少欄位: [${missing.join(', ')}]。` +
      `該筆原始資料的實際欄位為: [${Object.keys(row).join(', ')}]。` +
      `請依實際欄位更新 TPEX_FIELD_CANDIDATES。`
    );
  }

  return {
    market: 'TPEx',
    code,
    name,
    open: toNumber(open),
    high: toNumber(high),
    low: toNumber(low),
    close: toNumber(close),
    volume: toNumber(volume),
    change: toNumber(change),
  };
}

/**
 * 正規化 TWSE 歷史資料端點（www.twse.com.tw/rwd/.../STOCK_DAY_ALL）回傳的 CSV 列。
 * 該端點欄位為中文，已用即時抓到的樣本資料驗證過（見 _test-csv.mjs / _test-fetch-daily-quotes.mjs）。
 */
export function normalizeTwseCsvRow(row) {
  return {
    market: 'TWSE',
    code: row['證券代號'],
    name: row['證券名稱'],
    open: toNumber(row['開盤價']),
    high: toNumber(row['最高價']),
    low: toNumber(row['最低價']),
    close: toNumber(row['收盤價']),
    volume: toNumber(row['成交股數']),
    change: toNumber(row['漲跌價差']),
  };
}

/**
 * 從 CSV 列取出「日期」欄位，格式為民國年 YYYMMDD（例如 1150707 = 2026-07-07），
 * 轉成西元 YYYY-MM-DD，方便跟預期日期比對，偵測 date 參數是否真的生效。
 */
export function extractDateFromCsvRow(row) {
  const raw = row['日期'];
  if (!raw || raw.length !== 7) return null;
  const rocYear = parseInt(raw.slice(0, 3), 10);
  const month = raw.slice(3, 5);
  const day = raw.slice(5, 7);
  const year = rocYear + 1911;
  return `${year}-${month}-${day}`;
}

/**
 * 過濾掉當日無交易（volume = 0）或明顯異常（close = 0）的資料列，
 * 這些多半是當日暫停交易、剛下市，或 ETF 尚未開始交易的標的，不適合拿來算因子。
 */
export function isTradableRow(normalizedRow) {
  return normalizedRow.volume > 0 && normalizedRow.close > 0;
}
