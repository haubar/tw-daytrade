import {
  addToSharedWatchlist,
  emptyWatchlist,
  getSharedWatchlist,
  removeFromSharedWatchlist,
} from '../lib/watchlist.mjs';

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
    console.log(`✅ ${label}`);
  } else {
    failed++;
    console.log(`❌ ${label}`);
    console.log('   期望:', JSON.stringify(expected));
    console.log('   實際:', JSON.stringify(actual));
  }
}

function createFakeStore(initial) {
  const data = new Map(initial ? [['current', initial]] : []);
  return {
    async setJSON(key, value) { data.set(key, value); },
    async get(key) { return data.get(key) ?? null; },
  };
}

const fixedNow = () => '2026-09-11T00:00:00.000Z';

const store = createFakeStore();
const initial = await getSharedWatchlist(store);
assertEqual(initial.items, [], '空 store 應回傳空自選股清單');

const afterAdd = await addToSharedWatchlist({ code: '2330', name: '台積電', market: 'TWSE' }, store, fixedNow);
assertEqual(afterAdd.items[0].code, '2330', '加入股票後應出現在清單');
assertEqual(afterAdd.items[0].name, '台積電', '加入股票後應保存名稱');
assertEqual(afterAdd.audit[0].action, 'add', '加入操作應寫入 audit');

const afterDuplicate = await addToSharedWatchlist({ code: '2330', name: '台積電' }, store, fixedNow);
assertEqual(afterDuplicate.items.length, 1, '重複加入不應產生重複項目');
assertEqual(afterDuplicate.items[0].addCount, 2, '重複加入應累加加入次數');

const removed = await removeFromSharedWatchlist('2330', store, fixedNow);
assertEqual(removed.watchlist.items, [], '移除股票後清單應為空');
assertEqual(removed.removed.code, '2330', '移除結果應回傳被移除股票');
assertEqual(removed.watchlist.audit.at(-1).action, 'remove', '移除操作應寫入 audit');

let invalidRejected = false;
try {
  await addToSharedWatchlist({ code: 'ABC' }, store, fixedNow);
} catch {
  invalidRejected = true;
}
assertEqual(invalidRejected, true, '不合法股票代碼應拒絕');

assertEqual(emptyWatchlist('2026-09-11T00:00:00.000Z').schemaVersion, 1, '新資料應帶有 schemaVersion');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
