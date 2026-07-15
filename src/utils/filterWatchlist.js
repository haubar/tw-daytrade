// src/utils/filterWatchlist.js
//
// 觀察榜的篩選邏輯，拆成跟 Vue 無關的純函式（跟後端 factors.mjs／screen.mjs 的設計哲學一致：
// 核心邏輯獨立出來，才能用簡單的 node 直接測試，不用架一個瀏覽器/元件測試環境）。
//
// 篩選條件裡任何值是 null／undefined，代表「這個條件不限制」。

/**
 * @typedef {Object} WatchlistFilters
 * @property {number|null} minPrice 最低股價（收盤價），null 代表不限制
 * @property {number|null} maxPrice 最高股價（收盤價），null 代表不限制
 * @property {number|null} minVolume 最小成交量（股數），null 代表不限制
 * @property {number|null} minGainPercent 最小漲跌幅度（取絕對值，讓多方/空方觀察榜可以共用同一個篩選條件：
 *   多方看漲幅有沒有超過這個門檻，空方看跌幅有沒有超過這個門檻），null 代表不限制
 */

/**
 * 依照篩選條件過濾觀察榜項目。
 * @param {Array} items 觀察榜項目（每筆需要有 close／volume／changePercent 欄位）
 * @param {WatchlistFilters} filters
 * @returns {Array}
 */
export function filterWatchlist(items, filters) {
  const { minPrice, maxPrice, minVolume, minGainPercent } = filters ?? {};

  return items.filter((item) => {
    if (minPrice != null && item.close < minPrice) return false;
    if (maxPrice != null && item.close > maxPrice) return false;
    if (minVolume != null && item.volume < minVolume) return false;
    if (minGainPercent != null && Math.abs(item.changePercent) < minGainPercent) return false;
    return true;
  });
}

/**
 * 判斷目前的篩選條件是不是「全部都沒設定」（等於沒有在篩選）。
 * 給前端顯示「目前有沒有套用篩選」的提示用。
 * @param {WatchlistFilters} filters
 * @returns {boolean}
 */
export function isFilterActive(filters) {
  if (!filters) return false;
  return [filters.minPrice, filters.maxPrice, filters.minVolume, filters.minGainPercent].some(
    (v) => v != null && v !== ''
  );
}
