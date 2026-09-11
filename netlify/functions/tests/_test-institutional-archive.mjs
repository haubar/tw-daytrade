import {
  getArchivedInstitutionalDates,
  getInstitutionalSnapshot,
  getRecentInstitutionalHistory,
  saveInstitutionalSnapshot,
} from '../lib/institutional-archive.mjs';

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

function createFakeStore() {
  const data = new Map();
  return {
    async setJSON(key, value) { data.set(key, value); },
    async get(key) { return data.get(key) ?? null; },
    async delete(key) { data.delete(key); },
    _raw: data,
  };
}

const store = createFakeStore();
const fixedNow = () => '2026-09-11T10:00:00.000Z';
await saveInstitutionalSnapshot('2026-09-10', [
  { code: '2330', name: '台積電', close: 1000, market: 'TWSE', source: 'TWSE-T86', netBuyShares: 1000 },
  { code: '6488', market: 'TPEx', source: 'FinMind', netBuyShares: -200 },
  { code: '999', netBuyShares: 'not-a-number' },
], { coverage: { twse: 1, tpex: 1, tpexIsCandidateOnly: true } }, store, fixedNow);

const snapshot = await getInstitutionalSnapshot('2026-09-10', store);
assertEqual(snapshot.records.length, 2, '快照只應保存合法且實際存在的法人紀錄');
assertEqual(snapshot.records[0].code, '2330', '法人快照應依股票代碼排序');
assertEqual(snapshot.records[1].source, 'FinMind', '法人快照應保存資料來源');
assertEqual(snapshot.records[0].close, 1000, '法人快照應保存收盤價供金額換算');
assertEqual(snapshot.records[0].name, '台積電', '法人快照應保存股票名稱');
assertEqual(snapshot.coverage.tpexIsCandidateOnly, true, '法人快照應保存涵蓋範圍限制');

await saveInstitutionalSnapshot('2026-09-11', [{ code: '2330', netBuyShares: 2000 }], {}, store, fixedNow);
assertEqual(await getArchivedInstitutionalDates(store), ['2026-09-11', '2026-09-10'], '索引應依日期新到舊排列');
const history = await getRecentInstitutionalHistory(2, null, store);
assertEqual(history.length, 2, '應能讀取最近法人歷史快照');
assertEqual(history[0].records[0].netBuyShares, 2000, '最近快照應包含最新數字');

const excluded = await getRecentInstitutionalHistory(2, '2026-09-11', store);
assertEqual(excluded[0].date, '2026-09-10', 'excludeDate 應排除指定日期');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
