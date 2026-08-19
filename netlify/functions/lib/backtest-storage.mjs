import { getStore } from '@netlify/blobs';

const STORE_NAME = 'backtest-results';
const INDEX_KEY = 'index';
const LATEST_KEY = 'latest';
const MAX_RESULTS = 260; // 約一個交易年度

function defaultStore() {
  return getStore(STORE_NAME);
}

/** 儲存一個訊號日的回測結果；重跑同一訊號日只會覆蓋，不會重複計入。 */
export async function saveBacktestResult(result, store = defaultStore()) {
  const signalDate = result?.signalDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(signalDate ?? '')) throw new Error('backtest result 缺少合法的 signalDate');

  await store.setJSON(`by-signal-date/${signalDate}`, result);
  await store.setJSON(LATEST_KEY, result);
  const index = (await store.get(INDEX_KEY, { type: 'json' })) ?? [];
  const updated = [signalDate, ...index.filter((date) => date !== signalDate)];
  await store.setJSON(INDEX_KEY, updated.slice(0, MAX_RESULTS));
}

export async function getLatestBacktestResult(store = defaultStore()) {
  return (await store.get(LATEST_KEY, { type: 'json' })) ?? null;
}
