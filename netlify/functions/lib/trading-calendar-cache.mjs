// netlify/functions/lib/trading-calendar-cache.mjs
//
// 把 trading-calendar.mjs 抓到的 TWSE 官方交易日曆存進 Netlify Blobs，讓抓取結果可以
// 跨函式執行重複使用，不用每次呼叫都重新打一次 TWSE API。存放方式仿照 volume-archive.mjs：
// 每個年度一筆，key 是 'holidays:2026' 這種格式。
//
// 這是「自動同步」跟「日常使用」之間的橋樑：sync-trading-calendar.mjs（獨立的 Netlify
// Function，可以手動觸發或排程）負責呼叫 fetchExchangeHolidays() 抓最新公告、寫進這裡；
// scan.mjs 在判斷「今天要不要把資料寫進歷史累積庫」時，會讀這裡的快取（見 trading-day.mjs
// 的 isNonTradingDay 新增的 dynamicHolidays 參數），不會每次 scan 都去外部打一次 API。

import { getStore } from '@netlify/blobs';

const STORE_NAME = 'trading-calendar';

function defaultStore() {
  return getStore(STORE_NAME);
}

function yearKey(year) {
  return `holidays:${year}`;
}

/**
 * 存某一年度的休市日集合。
 * @param {number} year 西元年（例如 2026）
 * @param {Set<string>|string[]} holidays 'YYYY-MM-DD' 格式的休市日
 * @param {Object} [store] 可注入的假 store（測試用）
 */
export async function saveExchangeHolidays(year, holidays, store = defaultStore()) {
  await store.setJSON(yearKey(year), [...holidays]);
}

/**
 * 讀某一年度已存的休市日集合。
 * @param {number} year 西元年
 * @param {Object} [store] 可注入的假 store（測試用）
 * @returns {Promise<Set<string>|null>} 沒有存過這個年度的資料時回傳 null（不是空集合——
 *   空集合代表「查過、確定這年沒有休市日」，null 代表「根本沒查過」，兩者意義不同，
 *   呼叫端應該用 null 判斷要不要退回舊的靜態表，而不是誤把「查過但真的沒有」當成「沒查過」）
 */
export async function getExchangeHolidays(year, store = defaultStore()) {
  const raw = await store.get(yearKey(year), { type: 'json' });
  if (raw === null || raw === undefined) return null;
  return new Set(raw);
}

/**
 * 讀取涵蓋多個年度的休市日，合併成單一集合，方便呼叫端不用一個一個年度處理。
 * 沒存過的年度會被跳過（不會讓整批查詢失敗），呼叫端看合併後的集合是否為空、
 * 或另外比對 years 判斷涵蓋度即可。
 * @param {number[]} years
 * @param {Object} [store] 可注入的假 store（測試用）
 * @returns {Promise<Set<string>>}
 */
export async function getExchangeHolidaysForYears(years, store = defaultStore()) {
  const merged = new Set();
  const results = await Promise.all(years.map((y) => getExchangeHolidays(y, store)));
  for (const set of results) {
    if (!set) continue;
    for (const date of set) merged.add(date);
  }
  return merged;
}
