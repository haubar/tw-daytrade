// netlify/functions/lib/volume-archive.mjs
//
// 把「每天的成交量快照」累積存進 Netlify Blobs，取代原本 history.mjs 那種
// 「每次執行都現場跟 TWSE 要好幾天份歷史資料」的做法。
//
// 為什麼要改：部署到 Netlify 後實測發現，現場抓多天歷史資料是整個 scan.mjs 裡最花時間的部分，
// 很容易讓執行時間超過 Netlify Scheduled Function 30 秒的硬性上限。改成「每天執行時只抓當天、
// 順便把當天資料存起來累積」，往後的每次執行就只需要讀 Blobs（快，不用等外部網路），
// 不用再現場跟 TWSE 要好幾天份資料。
//
// 代價：剛開始使用（或剛清空 Blobs）的前幾天，累積的歷史天數不夠，量能異常因子會先是中性值，
// 需要幾個交易日才能「暖機」到有完整資料。可以用 backfill-history.mjs 手動補資料加速這個過程。

import { getStore } from '@netlify/blobs';

const STORE_NAME = 'volume-archive';
const INDEX_KEY = 'index';
const MAX_ARCHIVED_DAYS = 15; // 保留最近 15 個交易日，避免 Blobs 裡的資料無限增長

function defaultStore() {
  return getStore(STORE_NAME);
}

function snapshotKey(dateStr) {
  return `snapshot:${dateStr}`;
}

/**
 * 把某一天的行情快照（只需要 code 跟 volume）存進 Blobs，並更新日期索引。
 * 如果該日期已經存在，會直接覆蓋（同一天重複執行不會產生重複天數）。
 *
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {Array<{code: string, volume: number}>} quotes
 * @param {Object} [store] 可注入的假 store（測試用）
 */
export async function appendDailySnapshot(dateStr, quotes, store = defaultStore()) {
  const snapshot = {};
  for (const q of quotes) {
    snapshot[q.code] = q.volume;
  }
  await store.setJSON(snapshotKey(dateStr), snapshot);

  const index = (await store.get(INDEX_KEY, { type: 'json' })) ?? [];
  const withoutDate = index.filter((d) => d !== dateStr);
  const updatedIndex = [dateStr, ...withoutDate]; // 最新日期放最前面

  const kept = updatedIndex.slice(0, MAX_ARCHIVED_DAYS);
  const pruned = updatedIndex.slice(MAX_ARCHIVED_DAYS); // 超過保留天數的舊資料

  await store.setJSON(INDEX_KEY, kept);

  // 把被淘汰的舊快照也刪掉，避免 Blobs 裡累積用不到的資料。
  // 刪除失敗不影響主要流程（頂多是留著沒清乾淨的舊資料，不影響正確性）。
  await Promise.allSettled(pruned.map((d) => store.delete(snapshotKey(d))));
}

/**
 * 讀取最近 N 個已存的交易日快照，組成 code -> volumes[] 的 map
 * （跟原本 history.mjs 的 fetchVolumeHistory 回傳格式完全一致，screen.mjs 不用改）。
 *
 * @param {number} daysNeeded 想要的天數
 * @param {string} [excludeDate] 排除某個日期（防禦性用途：避免同一天重複執行時把「今天」自己算進歷史裡）
 * @param {Object} [store] 可注入的假 store（測試用）
 * @returns {Promise<{volumeHistory: Map<string, number[]>, datesUsed: string[]}>}
 */
export async function getRecentVolumeHistory(daysNeeded, excludeDate = null, store = defaultStore()) {
  const index = (await store.get(INDEX_KEY, { type: 'json' })) ?? [];
  const datesUsed = index.filter((d) => d !== excludeDate).slice(0, daysNeeded);

  const snapshots = await Promise.all(
    datesUsed.map(async (d) => {
      const snap = await store.get(snapshotKey(d), { type: 'json' });
      return snap ?? {};
    })
  );

  const volumeHistory = new Map();
  snapshots.forEach((snap) => {
    for (const [code, volume] of Object.entries(snap)) {
      if (!volumeHistory.has(code)) volumeHistory.set(code, []);
      volumeHistory.get(code).push(volume);
    }
  });

  return { volumeHistory, datesUsed };
}
