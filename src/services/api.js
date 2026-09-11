// 前端 API service：集中管理對 Netlify Functions 的請求，讓 View／Component 不需要知道 URL 與錯誤格式。

async function requestJson(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `伺服器回應錯誤: HTTP ${response.status}`);
  return body;
}

export function fetchLatestScan() {
  return requestJson('/.netlify/functions/latest');
}

export function fetchSharedWatchlist() {
  return requestJson('/.netlify/functions/shared-watchlist');
}

export function addSharedWatchlistItem(item) {
  return requestJson('/.netlify/functions/shared-watchlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(item),
  });
}

export function removeSharedWatchlistItem(code) {
  return requestJson('/.netlify/functions/shared-watchlist', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
}

export function fetchStockDetail(code, days = 60) {
  return requestJson(`/.netlify/functions/stock-detail?code=${encodeURIComponent(code)}&days=${days}`);
}

export function fetchSectorFlow({ days = 20, watchlistOnly = false } = {}) {
  return requestJson(`/.netlify/functions/sector-flow?days=${days}${watchlistOnly ? '&watchlistOnly=1' : ''}`);
}

export function fetchSectorReplay({ days = 20, watchlistOnly = false } = {}) {
  return requestJson(`/.netlify/functions/sector-replay?days=${days}${watchlistOnly ? '&watchlistOnly=1' : ''}`);
}
