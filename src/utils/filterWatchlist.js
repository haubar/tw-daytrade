// src/utils/filterWatchlist.js
//
// 觀察榜的篩選邏輯，拆成跟 Vue 無關的純函式（跟後端 factors.mjs／screen.mjs 的設計哲學一致：
// 核心邏輯獨立出來，才能用簡單的 node 直接測試，不用架一個瀏覽器/元件測試環境）。
//
// 篩選條件裡任何值是 null／undefined，代表「這個條件不限制」。
// 千元以上的股票則是這個當沖參考工具的固定排除條件，不會因為按下
// 「清除篩選」而重新出現在榜單中。

export const HIGH_PRICE_STOCK_LIMIT = 1000;

// 使用者提供的價格帶，以及每個價格帶建議先略過的檔數。
export const PRICE_BANDS = [
  { min: 370, max: 500, skipCount: 3 },
  { min: 184, max: 370, skipCount: 2 },
  { min: 100, max: 184, skipCount: 1 },
  { min: 75, max: 100, skipCount: 3 },
  { min: 50, max: 74, skipCount: 2 },
  { min: 38, max: 50, skipCount: 3 },
  { min: 18, max: 37, skipCount: 2 },
  { min: 11, max: 18, skipCount: 1 },
  { min: 3.7, max: 10, skipCount: 2 },
  { min: 0, max: 3.6, skipCount: 1 },
];

/**
 * 取得股價所屬的操作參考價格帶。500 元以上、未達千元的股票不套用
 * 使用者提供的略過檔數；千元股由 filterWatchlist 固定排除。
 */
export function getPriceBand(price) {
  if (!Number.isFinite(price) || price < 0 || price >= HIGH_PRICE_STOCK_LIMIT) return null;
  return PRICE_BANDS.find((band, index) => price >= band.min && price <= getPriceBandUpperBound(index)) ?? null;
}

// 原始分段之間有 0.5 元等正常台股跳動價格（例如 74.5、37.5）。上個價格帶的
// 起點視為本帶的實際上界，讓這類股票不會意外落在任何一帶之外。
export function getPriceBandUpperBound(index) {
  return index === 0 ? PRICE_BANDS[0].max : PRICE_BANDS[index - 1].min;
}

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
    if (item.close >= HIGH_PRICE_STOCK_LIMIT) return false;
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
