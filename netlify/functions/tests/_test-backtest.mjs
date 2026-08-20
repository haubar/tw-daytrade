import { evaluateOpenToCloseLong } from '../lib/backtest.mjs';
import { getLatestBacktestResult, saveBacktestResult } from '../lib/backtest-storage.mjs';

let passed = 0;
let failed = 0;
function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   期望: ${JSON.stringify(expected)}\n   實際: ${JSON.stringify(actual)}`); }
}
function assertClose(actual, expected, label) {
  if (typeof actual === 'number' && Math.abs(actual - expected) < 1e-9) { passed++; console.log(`✅ ${label}`); }
  else { failed++; console.log(`❌ ${label}\n   期望: ${expected}\n   實際: ${actual}`); }
}

const result = evaluateOpenToCloseLong(
  [{ code: 'A', name: '甲', dayTradeEligible: true }, { code: 'B', name: '乙', dayTradeEligible: false }, { code: 'C', name: '丙', dayTradeEligible: null }],
  [{ code: 'A', open: 100, close: 110 }, { code: 'C', open: 100, close: 90 }],
  { topN: 3, commissionRate: 0.001, taxRate: 0.002 }
);
assertEqual(result.selectedCount, 2, '明確不可當沖的股票不應進入基準策略');
assertEqual(result.executedCount, 2, '有有效隔日價格的候選應執行');
assertClose(result.grossReturnPercent, 0, '兩檔等權重 +10%/-10% 的平均毛報酬應為 0%');
assertClose(result.trades[0].netReturnPercent, ((110 * 0.997) / (100 * 1.001) - 1) * 100, '淨報酬應正確扣除買進手續費、賣出手續費與交易稅');
assertEqual(result.winRatePercent, 50, '一贏一輸的勝率應為 50%');

const missingQuote = evaluateOpenToCloseLong([{ code: 'D' }], [], { commissionRate: 0, taxRate: 0 });
assertEqual(missingQuote.executedCount, 0, '缺少執行日行情時不應產生假交易');
assertEqual(missingQuote.skipped[0].code, 'D', '缺少行情的股票應列入 skipped 診斷資訊');

const data = new Map();
const store = { setJSON: async (key, value) => data.set(key, value), get: async (key) => data.get(key) ?? null };
await saveBacktestResult({ signalDate: '2026-08-18', executionDate: '2026-08-19' }, store);
await saveBacktestResult({ signalDate: '2026-08-18', executionDate: '2026-08-19', rerun: true }, store);
assertEqual(await getLatestBacktestResult(store), { signalDate: '2026-08-18', executionDate: '2026-08-19', rerun: true }, '重跑同一訊號日應覆蓋最新回測結果');
assertEqual(data.get('index'), ['2026-08-18'], '重跑同一訊號日不應重複加入索引');

// ---- 迴歸測試：backfill-backtest.mjs 依「訊號日由近到遠」依序呼叫 saveBacktestResult 時，
// latest 指標不能被中途處理到的舊訊號日覆蓋（真實發生過的 bug：迴圈跑完後 latest
// 停在這批裡最舊的一天，而不是最新的一天）----
const store2 = { setJSON: async (key, value) => data2.set(key, value), get: async (key) => data2.get(key) ?? null };
const data2 = new Map();
await saveBacktestResult({ signalDate: '2026-08-14' }, store2); // 最新
await saveBacktestResult({ signalDate: '2026-08-13' }, store2);
await saveBacktestResult({ signalDate: '2026-08-12' }, store2); // 最舊，最後處理
assertEqual(
  (await getLatestBacktestResult(store2)).signalDate,
  '2026-08-14',
  'backfill 依「由近到遠」順序處理多個訊號日後，latest 應該還是最新的那一天，不能被後處理到的舊日期覆蓋'
);

// 反過來：如果先存了新的（例如 scan.mjs 當天寫入），之後才跑 backfill 補到更舊的資料，
// latest 也不該被那些更舊的補檔結果蓋掉。
const store3 = { setJSON: async (key, value) => data3.set(key, value), get: async (key) => data3.get(key) ?? null };
const data3 = new Map();
await saveBacktestResult({ signalDate: '2026-08-19' }, store3); // scan.mjs 當天寫入的最新結果
await saveBacktestResult({ signalDate: '2026-08-10' }, store3); // 之後才跑的歷史回填，比較舊
assertEqual(
  (await getLatestBacktestResult(store3)).signalDate,
  '2026-08-19',
  '之後才寫入的歷史回填資料（更舊的訊號日）不應該覆蓋掉已經存在的、更新的 latest'
);

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
