import { getStore } from '@netlify/blobs';

const STORE_NAME = 'backtest-results';
const INDEX_KEY = 'index';
const LATEST_KEY = 'latest';
const MAX_RESULTS = 260; // 約一個交易年度

function defaultStore() {
  return getStore(STORE_NAME);
}

/**
 * 儲存一個訊號日的回測結果；重跑同一訊號日只會覆蓋，不會重複計入。
 *
 * 「latest」只會被「比目前存的 latest 更新（或一樣新）的訊號日」覆蓋，不是無條件覆寫。
 * 這是為了因應 backfill-backtest.mjs 的呼叫順序：它一次處理好幾個訊號日，且是「由近到遠」
 * 依序呼叫這個函式（見 backfill-backtest.mjs 的 buildHistoricalBacktestWindows 排序），
 * 如果每次都無條件覆寫 latest，迴圈跑完後 latest 會停在這批裡「最舊」的那一天，
 * 而不是真正最新的一天——等於補歷史資料這個動作，會把 scan.mjs 每天寫入的最新結果
 * 悄悄蓋成一筆過期的舊資料，使用者查 /backtest-latest 看到的會是錯的。
 */
export async function saveBacktestResult(result, store = defaultStore()) {
  const signalDate = result?.signalDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(signalDate ?? '')) throw new Error('backtest result 缺少合法的 signalDate');

  await store.setJSON(`by-signal-date/${signalDate}`, result);

  const currentLatest = await store.get(LATEST_KEY, { type: 'json' });
  if (!currentLatest || !currentLatest.signalDate || signalDate >= currentLatest.signalDate) {
    await store.setJSON(LATEST_KEY, result);
  }

  const index = (await store.get(INDEX_KEY, { type: 'json' })) ?? [];
  const updated = [signalDate, ...index.filter((date) => date !== signalDate)];
  await store.setJSON(INDEX_KEY, updated.slice(0, MAX_RESULTS));
}

export async function getLatestBacktestResult(store = defaultStore()) {
  return (await store.get(LATEST_KEY, { type: 'json' })) ?? null;
}

/**
 * 讀取已存的回測訊號日清單。給歷史資料列表用，見 history-index.mjs。
 *
 * 注意：回傳的順序是「寫入順序」（最後寫入的排最前面），不是保證的日期順序。
 * 正常每日累積時兩者是一致的（永遠是今天寫入、比昨天新），但如果呼叫端混用過
 * backfill-backtest（由近到遠依序寫入）跟 scan.mjs（每天寫入今天），順序可能
 * 跟日期大小對不上。需要保證日期排序的呼叫端請自行再排序一次。
 *
 * @param {Object} [store] 可注入的假 store（測試用）
 * @returns {Promise<string[]>}
 */
export async function getBacktestIndex(store = defaultStore()) {
  return (await store.get(INDEX_KEY, { type: 'json' })) ?? [];
}

/**
 * 讀取單一訊號日的回測結果。
 * @param {string} signalDate 'YYYY-MM-DD'
 * @param {Object} [store] 可注入的假 store（測試用）
 * @returns {Promise<Object|null>}
 */
export async function getBacktestResultByDate(signalDate, store = defaultStore()) {
  return (await store.get(`by-signal-date/${signalDate}`, { type: 'json' })) ?? null;
}
