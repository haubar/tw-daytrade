import { evaluateOpenToCloseLong } from '../lib/backtest.mjs';
import { getLatestBacktestResult, saveBacktestResult, getBacktestIndex, getBacktestResultByDate } from '../lib/backtest-storage.mjs';

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

// ---- unavailableMarkets：真實踩過的情境——執行日某個市場整個抓資料失敗時，
// skipped 訊息應該區分「系統性市場資料源問題」跟「個股本身缺資料」----
// 真實案例：昨天多方榜選到的是上櫃股票，今天上櫃端點逾時失敗（tpexResult 整批 reject），
// 今天的 executionQuotes 完全沒有上櫃報價，導致這些股票全部被跳過。
const marketOutageResult = evaluateOpenToCloseLong(
  [
    { code: 'E', market: 'TPEx', dayTradeEligible: true }, // 上櫃，今天上櫃資料源掛了
    { code: 'F', market: 'TWSE', dayTradeEligible: true }, // 上市，個股本身就是沒資料（跟市場層級問題無關）
  ],
  [], // 今天完全沒有任何報價（模擬上櫃端點失敗、上市這邊剛好也沒查到F這檔的邊界情況）
  { commissionRate: 0, taxRate: 0, unavailableMarkets: new Set(['TPEx']) }
);
assertEqual(
  marketOutageResult.skipped.find((s) => s.code === 'E').reason,
  '執行日當天「TPEx」市場資料抓取失敗，非個股本身問題',
  '屬於當天整個市場資料源失敗的股票，skipped 原因應該明確標示是市場層級問題，不是個股異常'
);
assertEqual(
  marketOutageResult.skipped.find((s) => s.code === 'F').reason,
  '缺少有效的隔日開盤或收盤價格',
  '不屬於當天失敗市場的股票，維持原本的通用訊息（避免過度歸因成市場問題，實際上可能真的是個股資料異常）'
);
// 沒有提供 unavailableMarkets 時（原本的呼叫方式），應該完全維持舊行為，不受影響
const noMarketInfoResult = evaluateOpenToCloseLong(
  [{ code: 'G', market: 'TPEx', dayTradeEligible: true }],
  [],
  { commissionRate: 0, taxRate: 0 }
);
assertEqual(
  noMarketInfoResult.skipped[0].reason,
  '缺少有效的隔日開盤或收盤價格',
  '沒有提供 unavailableMarkets 時（向後相容），應維持原本的通用訊息'
);

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

// ---- getBacktestIndex / getBacktestResultByDate：給歷史資料列表用（history-index.mjs）----
const store4 = { setJSON: async (key, value) => data4.set(key, value), get: async (key) => data4.get(key) ?? null };
const data4 = new Map();
await saveBacktestResult({ signalDate: '2026-08-18', executedCount: 5 }, store4);
await saveBacktestResult({ signalDate: '2026-08-17', executedCount: 3 }, store4);
assertEqual(
  await getBacktestIndex(store4),
  ['2026-08-17', '2026-08-18'],
  'getBacktestIndex：回傳的是「寫入順序」（最後寫入的排最前面），不是日期順序——' +
    '正常每日累積時兩者一致（永遠是今天>昨天依序寫入），但呼叫端如果要保證日期排序，' +
    '要自己再排一次，不能假設這個順序已經是新到舊'
);
assertEqual(
  (await getBacktestResultByDate('2026-08-18', store4)).executedCount,
  5,
  'getBacktestResultByDate：應該能拿回指定日期的完整回測結果'
);
assertEqual(
  await getBacktestResultByDate('2099-01-01', store4),
  null,
  'getBacktestResultByDate：查詢沒有資料的日期應該回傳 null，不拋出例外'
);
assertEqual(
  await getBacktestIndex({ get: async () => null }),
  [],
  'getBacktestIndex：完全沒有資料時應該回傳空陣列'
);

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
