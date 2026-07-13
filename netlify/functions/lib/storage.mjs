// netlify/functions/lib/storage.mjs
//
// 把「今日候選名單」結果存進 Netlify Blobs，以及讀取最新一筆結果。
//
// 設計重點：store 是可以被覆寫的參數（依賴注入），預設用真正的 getStore()，
// 但測試時可以傳入一個假的 store 物件，不需要真的連到 Netlify 的 Blobs 環境就能測試邏輯。

import { getStore } from '@netlify/blobs';

const STORE_NAME = 'scan-results';
const LATEST_KEY = 'latest';

function defaultStore() {
  return getStore(STORE_NAME);
}

/**
 * 儲存最新一筆掃描結果。同時額外存一份「依日期」的備份，方便之後回顧歷史。
 * @param {Object} result scan.mjs 產出的完整結果物件
 * @param {Object} [store] 可注入的假 store（測試用）
 */
export async function saveLatestScan(result, store = defaultStore()) {
  await store.setJSON(LATEST_KEY, result);

  const dateStr = typeof result.generatedAt === 'string' ? result.generatedAt.slice(0, 10) : 'unknown-date';
  await store.setJSON(`by-date/${dateStr}`, result);
}

/**
 * 讀取最新一筆掃描結果。如果從未存過任何結果，回傳 null。
 * @param {Object} [store] 可注入的假 store（測試用）
 */
export async function getLatestScan(store = defaultStore()) {
  const result = await store.get(LATEST_KEY, { type: 'json' });
  return result ?? null;
}

/**
 * 讀取某一天的歷史掃描結果（key 格式：by-date/YYYY-MM-DD）
 * @param {string} dateStr 格式 YYYY-MM-DD
 * @param {Object} [store] 可注入的假 store（測試用）
 */
export async function getScanByDate(dateStr, store = defaultStore()) {
  const result = await store.get(`by-date/${dateStr}`, { type: 'json' });
  return result ?? null;
}
