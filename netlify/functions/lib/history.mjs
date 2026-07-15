// netlify/functions/lib/history.mjs
//
// 抓取過去 N 個交易日的市場快照，組成「每檔股票的成交量歷史」，供量能異常因子使用。
// 這支模組的即時多天抓取邏輯目前只被 backfill-history.mjs 使用（scan.mjs 已改成讀
// volume-archive.mjs 的 Blobs 累積庫，見階段 15 的架構調整）。
//
// 端點沿革（重要，記錄走過的彎路避免以後重踩）：
// 一開始用的是 www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY_ALL?date=YYYYMMDD，
// 實測發現不管 date 參數送哪一天，回傳的資料永遠是同一天（最新的），研判是 CDN 快取
// 沒有把 date 算進快取鍵值，導致這個端點事實上沒辦法查詢特定歷史日期。
//
// 改用 www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=YYYYMMDD&type=ALLBUT0999NOTIND
// ——已用真實請求驗證過，date 參數確實有效（回傳資料的標題會標明對應的日期，
// 跟送出去的 date 參數吻合）。這是坊間多篇教學文章使用的端點，格式穩定。
//
// 交易日判斷（跳過週六日）的邏輯抽到 trading-day.mjs，這裡重新匯出方便舊有呼叫端跟測試沿用。

import { toNumber, isTradableRow } from './normalize.mjs';
import { extractReportDate } from './institutional.mjs'; // 重用「民國年日期字串」解析邏輯，跟 T86 端點是同一種日期格式
import { formatDateParam, getPastTradingDayCandidates } from './trading-day.mjs';

export { formatDateParam, getPastTradingDayCandidates };

const HISTORY_URL_BASE = 'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX';

/**
 * MI_INDEX 端點的「漲跌(+/-)」欄位是一段 HTML（例如 <p style= color:green>-</p>），
 * 用顏色代表漲跌方向，實際漲跌幅度是另一個獨立欄位（永遠是正數）。
 * 把顏色轉成正負號：綠色代表跌（台股慣例），紅色代表漲，其餘（無色/X 標記，
 * 通常是無比價的情況，例如除權息、新上市）預設當正號處理——這種情況下
 * 漲跌價差本身通常也是 0，所以正負號不影響結果。
 * @param {string} colorHtml
 * @returns {1 | -1}
 */
function parseChangeSign(colorHtml) {
  if (typeof colorHtml !== 'string') return 1;
  if (colorHtml.includes('color:green')) return -1;
  if (colorHtml.includes('color:red')) return 1;
  return 1;
}

/**
 * 解析 MI_INDEX 端點回傳的 JSON 文字，轉成正規化後的行情資料 + 資料本身標示的實際日期。
 * 拆成獨立函式方便用固定的樣本資料測試，不用每次都真的連網路。
 *
 * MI_INDEX 的回應結構是 { tables: [ {}, {}, ..., { title, fields, data } ] }，
 * 裡面有好幾個空表格（其他報表類型用的），真正的每日收盤行情表格要用 fields 裡
 * 有沒有「證券代號」來找，不能寫死陣列位置（不同 type 參數或未來改版，表格順序可能不同）。
 *
 * @param {string} jsonText
 * @returns {{actualDate: string|null, quotes: Array}}
 */
export function parseMiIndexResponse(jsonText) {
  let body;
  try {
    body = JSON.parse(jsonText);
  } catch (e) {
    return { actualDate: null, quotes: [] };
  }

  const table = (body.tables || []).find((t) => Array.isArray(t.fields) && t.fields.includes('證券代號'));
  if (!table) {
    return { actualDate: null, quotes: [] };
  }

  const fieldIndex = (name) => table.fields.indexOf(name);
  const col = {
    code: fieldIndex('證券代號'),
    name: fieldIndex('證券名稱'),
    volume: fieldIndex('成交股數'),
    open: fieldIndex('開盤價'),
    high: fieldIndex('最高價'),
    low: fieldIndex('最低價'),
    close: fieldIndex('收盤價'),
    sign: fieldIndex('漲跌(+/-)'),
    change: fieldIndex('漲跌價差'),
  };

  const quotes = (table.data || [])
    .map((row) => ({
      market: 'TWSE',
      code: row[col.code],
      name: row[col.name],
      open: toNumber(row[col.open]),
      high: toNumber(row[col.high]),
      low: toNumber(row[col.low]),
      close: toNumber(row[col.close]),
      volume: toNumber(row[col.volume]),
      change: parseChangeSign(row[col.sign]) * toNumber(row[col.change]),
    }))
    .filter(isTradableRow);

  const actualDate = extractReportDate(table.title || '');

  return { actualDate, quotes };
}

/**
 * 抓取單一候選日期的市場快照，回傳正規化後的資料 + 資料本身標示的實際日期。
 * 加上請求逾時保護（8 秒）跟快取破解參數（見上方端點沿革說明）。
 * 開放匯出給 backfill-history.mjs 使用。
 * @param {Date} dateParam
 */
export async function fetchOneDay(dateParam) {
  const cacheBuster = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const url = `${HISTORY_URL_BASE}?date=${formatDateParam(dateParam)}&type=ALLBUT0999NOTIND&response=json&_=${cacheBuster}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
  });
  if (!res.ok) {
    throw new Error(`歷史資料端點回應錯誤: HTTP ${res.status}`);
  }
  const text = await res.text();
  return parseMiIndexResponse(text);
}

/**
 * 抓取過去 N 個「獨立交易日」的成交量歷史，組成 code -> volumes[] 的 map。
 * 候選日期全部平行發出（見階段 14 的教訓：序列抓取很容易逾時）。
 *
 * @param {number} targetDays 想要蒐集到的獨立交易日數量（預設 3）
 * @param {Date} [referenceDate] 參考日（預設今天），主要方便測試時固定日期
 * @param {number} [maxAttempts] 最多嘗試幾個候選日期（預設 6）
 * @returns {Promise<{volumeHistory: Map<string, number[]>, datesUsed: string[]}>}
 */
export async function fetchVolumeHistory(targetDays = 3, referenceDate = new Date(), maxAttempts = 6) {
  const candidates = getPastTradingDayCandidates(referenceDate, maxAttempts);

  const settledResults = await Promise.allSettled(candidates.map((candidate) => fetchOneDay(candidate)));

  const volumeHistory = new Map();
  const datesUsed = [];

  for (const settled of settledResults) {
    if (datesUsed.length >= targetDays) break;
    if (settled.status !== 'fulfilled') continue;

    const result = settled.value;
    if (!result.actualDate || datesUsed.includes(result.actualDate)) continue;

    datesUsed.push(result.actualDate);
    for (const q of result.quotes) {
      if (!volumeHistory.has(q.code)) volumeHistory.set(q.code, []);
      volumeHistory.get(q.code).push(q.volume);
    }
  }

  return { volumeHistory, datesUsed };
}
