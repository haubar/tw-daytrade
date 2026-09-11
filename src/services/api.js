// 前端 API service：集中管理對 Netlify Functions 的請求，讓 View／Component 不需要知道 URL 與錯誤格式。

const requestJson = async (path, options = {}) => {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `伺服器回應錯誤: HTTP ${response.status}`);
  return body;
};

const get = (path) => requestJson(path);

export const fetchLatestScan = () => get('/.netlify/functions/latest');
export const fetchSharedWatchlist = () => get('/.netlify/functions/shared-watchlist');
export const fetchHistoryIndex = () => get('/.netlify/functions/history-index');
export const fetchStockWinRate = (strategy) => get(`/.netlify/functions/stock-win-rate?strategy=${encodeURIComponent(strategy)}&minTrades=3&limit=20`);
export const fetchBackfillStatus = (days = 10) => get(`/.netlify/functions/backfill-status?days=${days}`);
export const runBackfillBacktest = (signalDate) => get(`/.netlify/functions/backfill-backtest?signalDate=${encodeURIComponent(signalDate)}`);

export const searchStocks = (query) => get(`/.netlify/functions/stock-search?q=${encodeURIComponent(query)}`);

export const addSharedWatchlistItem = (item) => {
  return requestJson('/.netlify/functions/shared-watchlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(item),
  });
};

export const removeSharedWatchlistItem = (code) => {
  return requestJson('/.netlify/functions/shared-watchlist', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
};

export const fetchStockDetail = (code, days = 60) => get(`/.netlify/functions/stock-detail?code=${encodeURIComponent(code)}&days=${days}`);

export const fetchSectorFlow = ({ days = 20, watchlistOnly = false } = {}) => get(`/.netlify/functions/sector-flow?days=${days}${watchlistOnly ? '&watchlistOnly=1' : ''}`);

export const fetchSectorReplay = ({ days = 20, watchlistOnly = false } = {}) => get(`/.netlify/functions/sector-replay?days=${days}${watchlistOnly ? '&watchlistOnly=1' : ''}`);
