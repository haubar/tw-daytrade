// src/utils/format.js
//
// 共用的格式化函式。原本 formatPercent／formatPrice／formatDateTime
// 在 WatchlistPanel.vue 跟 StatusBar.vue 裡各寫了一份，抽出來共用一份。

// 有些數值天生就可能是 null（不是計算出來的「剛好是0」，而是「今天根本沒有可以計算的資料」，
// 例如回測當天 executedCount 是 0 時，grossReturnPercent／netReturnPercent／winRatePercent
// 都會是 null）。這種情況呼叫 .toFixed() 會直接拋出例外把整個畫面弄壞，所以要先擋掉。
export function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function formatPrice(value) {
  return value.toFixed(value >= 1000 ? 0 : 2);
}

export function formatVolume(shares) {
  // 台股慣例用「張」（1張 = 1,000股）表示成交量，比原始股數直覺
  const lots = Math.round(shares / 1000);
  return `${lots.toLocaleString('zh-TW')} 張`;
}

export function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
