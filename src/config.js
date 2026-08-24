// src/config.js
//
// 集中放置跨站連結等設定值，方便日後修改，不用到處找散落在各元件裡的網址字串。

// stock_view（另一個股市觀測站，haubar/stock_view）的網址。
export const STOCK_VIEW_BASE_URL = 'https://stock-vvv.netlify.app';

/**
 * 組出連到 stock_view、顯示某檔股票歷史資料的網址。
 * stock_view 那邊會讀取 `code` 這個查詢參數，自動帶入搜尋框並觸發查詢
 * （見 stock_view 的 src/App.vue：applyQueryParamStock()）。
 * @param {string} code 股票代碼
 * @returns {string}
 */
export function buildStockViewUrl(code) {
  return `${STOCK_VIEW_BASE_URL}/?code=${encodeURIComponent(code)}`;
}
