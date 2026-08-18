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

// 量能異常因子實際使用的歷史窗口天數。原本是 3 天，但 3 天的均量基準很容易被單一天的
// 異常量能干擾（例如除權息、法說會等一次性事件造成的單日爆量，會讓接下來兩天都被拉高
// 均量基準，量能異常因子因此失真）。拉長到 5 天可以稀釋單一天雜訊的影響，同時不用等
// 太久才能暖機完成（MAX_ARCHIVED_DAYS=15 天保留空間還有餘裕，之後想再拉到 10 天也不用
// 改這裡以外的地方）。scan.mjs、backfill-history.mjs 都從這裡引用，只有一個地方需要改。
export const DEFAULT_HISTORY_WINDOW_DAYS = 5;

function defaultStore() {
  return getStore(STORE_NAME);
}

function snapshotKey(dateStr) {
  return `snapshot:${dateStr}`;
}

const MARKET_KEY = '__market'; // 存在快照物件裡的特殊 key，跟股票代碼（純數字）不會撞名

/**
 * 把某一天的行情快照存進 Blobs，並更新日期索引。
 * 如果該日期已經存在，會直接覆蓋（同一天重複執行不會產生重複天數）。
 *
 * 每一檔股票存 { volume, changePercent }（changePercent 可省略，沒給就存 null）。
 * changePercent 是為了「多日相對強弱」因子（見 factors.mjs 的 computeMultiDayRelativeStrength）
 * 準備的：只存 volume 沒辦法回頭算出過去某一天的漲跌幅，所以額外存一份。
 *
 * 注意：這個 store 在部署前就已經有真實資料，舊資料是「code -> volume（純數字）」的扁平格式，
 * 不會有 changePercent，讀取端（getRecentVolumeHistory / getRecentChangeHistory）都要能同時
 * 認得新舊兩種格式，不能讓舊資料在升級後直接讀不到或報錯。
 *
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {Array<{code: string, volume: number, changePercent?: number}>} quotes
 * @param {Object} [store] 可注入的假 store（測試用）
 * @param {Object} [options]
 * @param {number} [options.marketChangePercent] 當天的大盤漲跌幅（%），用來給多日相對強弱因子
 *   當比較基準。可省略（例如舊呼叫端還沒升級），該天就視為沒有大盤資料。
 */
export async function appendDailySnapshot(dateStr, quotes, store = defaultStore(), { marketChangePercent = null } = {}) {
  const snapshot = {};
  for (const q of quotes) {
    snapshot[q.code] = { volume: q.volume, changePercent: q.changePercent ?? null };
  }
  if (marketChangePercent !== null && marketChangePercent !== undefined) {
    snapshot[MARKET_KEY] = marketChangePercent;
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
 * 讀取目前已經存進 Blobs 累積庫的日期清單（新到舊排序），
 * 給 backfill-history.mjs 判斷「哪些天已經有資料了，不用重複補」用。
 * @param {Object} [store] 可注入的假 store（測試用）
 * @returns {Promise<string[]>}
 */
export async function getArchivedDates(store = defaultStore()) {
  return (await store.get(INDEX_KEY, { type: 'json' })) ?? [];
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
    for (const [code, entry] of Object.entries(snap)) {
      if (code === MARKET_KEY) continue;
      // 相容新舊兩種格式：舊資料是純數字（volume 本身），新資料是 { volume, changePercent }
      const volume = typeof entry === 'number' ? entry : entry?.volume;
      if (!volumeHistory.has(code)) volumeHistory.set(code, []);
      volumeHistory.get(code).push(volume);
    }
  });

  return { volumeHistory, datesUsed };
}

/**
 * 讀取最近 N 個已存的交易日快照，組成 code -> changePercent[] 的 map，
 * 給多日相對強弱因子（factors.mjs 的 computeMultiDayRelativeStrength）當輸入。
 *
 * 只有新格式（{volume, changePercent}）的快照才有 changePercent；讀到舊格式（純數字）
 * 或 changePercent 是 null 的天數，該股票那一天就跳過不放進陣列——這代表這檔股票在
 * 那一天的資料「不能用於多日相對強弱」，但不影響其他天的資料，呼叫端（screen.mjs）
 * 應該優雅處理「這檔股票的多日資料不夠、退回用單日相對強弱」的情況，而不是整個候選排除。
 *
 * @param {number} daysNeeded
 * @param {string} [excludeDate]
 * @param {Object} [store] 可注入的假 store（測試用）
 * @returns {Promise<Map<string, number[]>>}
 */
export async function getRecentChangeHistory(daysNeeded, excludeDate = null, store = defaultStore()) {
  const index = (await store.get(INDEX_KEY, { type: 'json' })) ?? [];
  const datesUsed = index.filter((d) => d !== excludeDate).slice(0, daysNeeded);

  const snapshots = await Promise.all(
    datesUsed.map(async (d) => {
      const snap = await store.get(snapshotKey(d), { type: 'json' });
      return snap ?? {};
    })
  );

  const changeHistory = new Map();
  snapshots.forEach((snap) => {
    for (const [code, entry] of Object.entries(snap)) {
      if (code === MARKET_KEY) continue;
      if (typeof entry !== 'object' || entry === null) continue; // 舊格式（純數字），沒有 changePercent 可用
      if (typeof entry.changePercent !== 'number') continue; // 沒存、或存的時候是 null
      if (!changeHistory.has(code)) changeHistory.set(code, []);
      changeHistory.get(code).push(entry.changePercent);
    }
  });

  return changeHistory;
}

/**
 * 讀取最近 N 個已存的交易日的大盤漲跌幅，給多日相對強弱因子當比較基準
 * （個股的多日相對強弱 = 個股每日漲跌幅 - 對應那天的大盤漲跌幅，見 screen.mjs）。
 *
 * 沒有存大盤漲跌幅的天數（例如舊資料，或 appendDailySnapshot 呼叫時沒帶 marketChangePercent）
 * 會直接跳過，不會補 0 進去——补 0 等於假裝「大盤那天完全不動」，是錯誤的資料，
 * 寧可讓那一天在計算多日相對強弱時被排除，也不要用假資料混進去。
 *
 * @param {number} daysNeeded
 * @param {string} [excludeDate]
 * @param {Object} [store] 可注入的假 store（測試用）
 * @returns {Promise<number[]>}
 */
export async function getRecentMarketChangeHistory(daysNeeded, excludeDate = null, store = defaultStore()) {
  const index = (await store.get(INDEX_KEY, { type: 'json' })) ?? [];
  const datesUsed = index.filter((d) => d !== excludeDate).slice(0, daysNeeded);

  const snapshots = await Promise.all(
    datesUsed.map(async (d) => {
      const snap = await store.get(snapshotKey(d), { type: 'json' });
      return snap ?? {};
    })
  );

  return snapshots
    .map((snap) => snap[MARKET_KEY])
    .filter((v) => typeof v === 'number');
}
