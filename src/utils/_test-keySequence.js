// src/utils/_test-keySequence.js
// 執行方式：node src/utils/_test-keySequence.js

import { advanceSequence } from './keySequence.js';

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`✅ ${label}`);
  } else {
    failed++;
    console.log(`❌ ${label}`);
    console.log('   期望:', JSON.stringify(expected));
    console.log('   實際:', JSON.stringify(actual));
  }
}

const SEQ = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

// ---- 依序按對，應該逐步推進，最後一步完成並歸零 ----
let progress = 0;
let step;

step = advanceSequence('ArrowUp', progress, SEQ);
assertEqual(step, { progress: 1, completed: false }, '第1步按對（上）：progress應該推進到1，還沒完成');
progress = step.progress;

step = advanceSequence('ArrowDown', progress, SEQ);
assertEqual(step, { progress: 2, completed: false }, '第2步按對（下）：progress應該推進到2，還沒完成');
progress = step.progress;

step = advanceSequence('ArrowLeft', progress, SEQ);
assertEqual(step, { progress: 3, completed: false }, '第3步按對（左）：progress應該推進到3，還沒完成');
progress = step.progress;

step = advanceSequence('ArrowRight', progress, SEQ);
assertEqual(step, { progress: 0, completed: true }, '第4步按對（右）：完成序列，completed=true，progress歸零準備下一輪');

// ---- 按錯時應該歸零，除非按錯的剛好是序列第一個鍵（視為重新開始）----
assertEqual(advanceSequence('ArrowDown', 0, SEQ), { progress: 0, completed: false }, '一開始（progress=0）按下「下」而不是「上」：不符合序列開頭，應該歸零（本來就是0）');
assertEqual(advanceSequence('ArrowDown', 2, SEQ), { progress: 0, completed: false }, '按到第3步（期望「左」）時卻按了「下」：不符合期望、也不是序列第一鍵，應該歸零重來');
assertEqual(advanceSequence('ArrowUp', 2, SEQ), { progress: 1, completed: false }, '按到第3步時按錯，但按的剛好是「上」（序列第一鍵）：應視為重新開始，progress=1而不是0');

// ---- 完整走錯一輪，確認不會卡在中間狀態 ----
let p2 = 0;
p2 = advanceSequence('ArrowUp', p2, SEQ).progress; // 1
p2 = advanceSequence('ArrowUp', p2, SEQ).progress; // 按錯，但又是「上」，視為重新開始 → 1
assertEqual(p2, 1, '連續按兩次「上」：第二次視為重新開始，progress應該還是1，不是0也不是2');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
