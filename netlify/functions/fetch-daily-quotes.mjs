// netlify/functions/fetch-daily-quotes.mjs
//
// 這支 function 目前功能：抓取「今天」TWSE + TPEx 全市場日行情，正規化成統一格式。
// 之後的因子計算（量能異常/跳空/相對強弱/隔日沖）會在下一階段疊加上去，
// 這一版先專注在「資料抓得到、格式對得上」。
//
// 部署到 Netlify 後可直接用瀏覽器打開 /.netlify/functions/fetch-daily-quotes 測試。

import { normalizeTwseRow, normalizeTpexRow, isTradableRow, isWarrant } from './lib/normalize.mjs';

const TWSE_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
// TPEx 端點待實際部署後確認確切路徑與欄位（見下方 fetchTpexQuotes 註解）
const TPEX_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes';

async function fetchTwseQuotes() {
  const res = await fetch(TWSE_URL);
  if (!res.ok) {
    throw new Error(`TWSE API 回應錯誤: HTTP ${res.status}`);
  }
  const rows = await res.json();
  const normalized = [];
  const errors = [];
  let warrantCount = 0;
  for (const row of rows) {
    try {
      const n = normalizeTwseRow(row);
      if (!isTradableRow(n)) continue;
      if (isWarrant(n)) { warrantCount++; continue; }
      normalized.push(n);
    } catch (e) {
      errors.push({ code: row.Code, message: e.message });
    }
  }
  return { normalized, errors, warrantCount };
}

async function fetchTpexQuotes() {
  // 注意：這個網域在我方測試環境有防爬蟲機制擋下請求，實際欄位名稱未能於此驗證。
  // 部署到 Netlify（有完整網路權限）後，第一次執行若欄位對不上，
  // normalizeTpexRow 會丟出包含「原始欄位名稱」的錯誤訊息，屆時依實際欄位
  // 更新 lib/normalize.mjs 裡的 TPEX_FIELD_CANDIDATES 即可，不需要重寫邏輯。
  const res = await fetch(TPEX_URL);
  if (!res.ok) {
    throw new Error(`TPEx API 回應錯誤: HTTP ${res.status}`);
  }
  const rows = await res.json();
  const normalized = [];
  const errors = [];
  let warrantCount = 0;
  for (const row of rows) {
    try {
      const n = normalizeTpexRow(row);
      if (!isTradableRow(n)) continue;
      if (isWarrant(n)) { warrantCount++; continue; }
      normalized.push(n);
    } catch (e) {
      errors.push({ raw: row, message: e.message });
      // TPEx 欄位對應目前尚未驗證過，第一筆失敗就停止，避免洗版一樣的錯誤訊息
      break;
    }
  }
  return { normalized, errors, warrantCount };
}

export default async (req) => {
  try {
    const [twse, tpex] = await Promise.allSettled([
      fetchTwseQuotes(),
      fetchTpexQuotes(),
    ]);

    const result = {
      fetchedAt: new Date().toISOString(),
      twse: twse.status === 'fulfilled'
        ? { count: twse.value.normalized.length, errorCount: twse.value.errors.length, warrantCount: twse.value.warrantCount, sample: twse.value.normalized.slice(0, 3) }
        : { error: twse.reason.message },
      tpex: tpex.status === 'fulfilled'
        ? { count: tpex.value.normalized.length, errorCount: tpex.value.errors.length, warrantCount: tpex.value.warrantCount, sample: tpex.value.normalized.slice(0, 3), firstError: tpex.value.errors[0] }
        : { error: tpex.reason.message },
    };

    return new Response(JSON.stringify(result, null, 2), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
};
