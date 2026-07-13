// src/utils/format.js
//
// 共用的格式化函式。原本 formatPercent／formatPrice／formatDateTime
// 在 WatchlistPanel.vue 跟 StatusBar.vue 裡各寫了一份，抽出來共用一份。

export function formatPercent(value) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function formatPrice(value) {
  return value.toFixed(value >= 1000 ? 0 : 2);
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
