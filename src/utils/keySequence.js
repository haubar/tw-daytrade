// src/utils/keySequence.js
//
// HistoryPanel.vue 用到的按鍵序列比對邏輯，拆成純函式方便測試（不用真的模擬 DOM 事件）。

/**
 * 判斷按下的按鍵是否讓序列往前推進一步。
 * @param {string} key 例如 'ArrowUp'
 * @param {number} progress 目前已經按對到第幾步（0 代表還沒開始）
 * @param {string[]} sequence 完整要求的序列，例如 ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight']
 * @returns {{progress: number, completed: boolean}}
 *   completed 為 true 時，progress 一定會是 0（完成後重新歸零，準備接受下一輪）
 */
export function advanceSequence(key, progress, sequence) {
  if (key === sequence[progress]) {
    const nextProgress = progress + 1;
    if (nextProgress === sequence.length) {
      return { progress: 0, completed: true };
    }
    return { progress: nextProgress, completed: false };
  }
  // 按錯的那一鍵剛好是序列的第一個鍵時，視為「重新開始」而不是「這次不算」，
  // 讓使用者不用等一拍再重按，符合一般人「按錯就從頭來」的直覺操作方式。
  if (key === sequence[0]) {
    return { progress: 1, completed: false };
  }
  return { progress: 0, completed: false };
}
