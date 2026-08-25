// netlify/functions/tests/_test-data-source-stats.mjs
// 執行方式：node netlify/functions/tests/_test-data-source-stats.mjs

import { classifyStatus, summarizeDataSourceHistory, buildDailyBreakdown, TRACKED_SOURCES } from '../lib/data-source-stats.mjs';

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

// ---- classifyStatus ----
assertEqual(classifyStatus('ok (1325 檔)'), 'ok', '"ok (數字)" 開頭應歸類為 ok');
assertEqual(classifyStatus('ok（使用真實 TAIEX 指數）'), 'ok', '"ok（全形括號）" 開頭應歸類為 ok');
assertEqual(
  classifyStatus('失敗: 法人買賣超資料抓取失敗（本次結果的法人因子將全部視為中性）: The operation was aborted due to timeout'),
  'failed',
  '"失敗" 開頭應歸類為 failed（實際踩過的真實錯誤訊息格式）'
);
assertEqual(classifyStatus('失敗: terminated'), 'failed', '"失敗: terminated" 應歸類為 failed（實際踩過的 TPEx 逾時訊息）');
assertEqual(
  classifyStatus('本次第一輪觀察榜沒有上櫃股票，不需要查詢'),
  'unknown',
  '中性說明文字（沒有必要查詢）應歸類為 unknown，不算成功也不算失敗'
);
assertEqual(classifyStatus(null), 'unknown', '傳入 null 應該安全歸類為 unknown，不拋出例外');
assertEqual(classifyStatus(undefined), 'unknown', '傳入 undefined 應該安全歸類為 unknown，不拋出例外');
assertEqual(classifyStatus(''), 'unknown', '空字串應該歸類為 unknown');

// ---- 真實踩過的措辭不一致問題：scan.mjs 原本有兩處訊息沒有依循 'ok'/'失敗' 開頭慣例，
// 導致這裡把真正的失敗誤判成 unknown。已回頭修正 scan.mjs 的措辭，這裡驗證修正後的
// 訊息格式能被正確分類，不是在分類器裡加特例 ----
assertEqual(
  classifyStatus('失敗（全部無有效資料）（查詢 20 檔上櫃候選，成功 0 檔，空資料 20 檔）'),
  'failed',
  '修正後的 finmindTpexInstitutional 全部無有效資料訊息（原本是「⚠」開頭）應該正確歸類為 failed'
);
assertEqual(
  classifyStatus('失敗（查詢時發生例外，本次上櫃候選股的法人因子維持中性值）: some error'),
  'failed',
  '修正後的 finmindTpexInstitutional 查詢例外訊息（原本是「查詢失敗」開頭）應該正確歸類為 failed'
);
assertEqual(
  classifyStatus('失敗，改用估計值 ⚠ TAIEX 指數抓取失敗'),
  'failed',
  '修正後的 taiex 退回估計值訊息（原本是「改用估計值」開頭）應該正確歸類為 failed'
);
assertEqual(
  classifyStatus('法人買賣超資料抓取成功，但解析結果是空的（可能是非交易日查無資料，或官方報表格式跟預期不同）'),
  'unknown',
  '真正踩過的 bug 修正案例：fetch 成功但解析結果為空時的新訊息（不是「失敗」開頭），' +
    '應該歸類為 unknown（既不是明確成功也不是明確失敗），不能再誤導成「失敗: null」那種看起來很嚴重的措辭'
);

// ---- summarizeDataSourceHistory：用真實踩過的情境組樣本資料 ----
const snapshots = [
  { date: '2026-08-20', dataSourceStatus: { institutional: '失敗: timeout', tpex: '失敗: terminated', twse: 'ok (1325 檔)' } },
  { date: '2026-08-19', dataSourceStatus: { institutional: '失敗: timeout', tpex: 'ok (800 檔)', twse: 'ok (1320 檔)' } },
  { date: '2026-08-18', dataSourceStatus: { institutional: 'ok (987 檔)', tpex: 'ok (802 檔)', twse: 'ok (1322 檔)' } },
  { date: '2026-08-17', dataSourceStatus: { institutional: '失敗: timeout', tpex: 'ok (798 檔)', twse: 'ok (1318 檔)' } },
];
const summary = summarizeDataSourceHistory(snapshots);
assertEqual(summary.daysAnalyzed, 4, 'daysAnalyzed 應該等於傳入的快照筆數');
assertEqual(
  summary.sources.institutional,
  { okCount: 1, failedCount: 3, unknownCount: 0, failureRatePercent: 75 },
  '法人資料（institutional）4天裡3天失敗，失敗率應該是 75%——這是這次要驗證的核心指標'
);
assertEqual(
  summary.sources.twse,
  { okCount: 4, failedCount: 0, unknownCount: 0, failureRatePercent: 0 },
  'TWSE 全部成功，失敗率應該是 0%（不是 null——有資料可以算、算出來是0，跟完全沒資料是兩回事）'
);
assertEqual(
  summary.sources.tpex,
  { okCount: 3, failedCount: 1, unknownCount: 0, failureRatePercent: 25 },
  'TPEx 4天裡1天失敗，失敗率應該是 25%'
);

// ---- unknown 不該影響失敗率分母 ----
const withUnknown = summarizeDataSourceHistory([
  { date: '2026-08-01', dataSourceStatus: { finmindTpexInstitutional: '本次第一輪觀察榜沒有上櫃股票，不需要查詢' } },
  { date: '2026-08-02', dataSourceStatus: { finmindTpexInstitutional: '失敗: timeout' } },
]);
assertEqual(
  withUnknown.sources.finmindTpexInstitutional,
  { okCount: 0, failedCount: 1, unknownCount: 1, failureRatePercent: 100 },
  'unknown 不該算進失敗率的分母：1個unknown+1個failed，分母只有failed本身=1，失敗率應該是100%而不是50%'
);

// ---- 完全沒有可用資料時，failureRatePercent 應該是 null（不是0）----
const allUnknown = summarizeDataSourceHistory([
  { date: '2026-08-01', dataSourceStatus: { institutional: '某種從沒見過的中性文字' } },
]);
assertEqual(
  allUnknown.sources.institutional.failureRatePercent,
  null,
  '完全沒有 ok/failed 資料可以算時，failureRatePercent 應該是 null，代表「沒有資料」而不是「0%失敗」'
);

// ---- 邊界情況 ----
assertEqual(summarizeDataSourceHistory([]).daysAnalyzed, 0, '空陣列應該回傳 daysAnalyzed=0，不拋出例外');
assertEqual(summarizeDataSourceHistory(null).daysAnalyzed, 0, '傳入 null 應該安全回傳，不拋出例外');
assertEqual(
  summarizeDataSourceHistory([{ date: '2026-08-01', dataSourceStatus: undefined }]).sources.institutional.unknownCount,
  1,
  '缺少 dataSourceStatus 欄位的快照，每個資料源應該安全歸類為 unknown，不拋出例外'
);

// ---- buildDailyBreakdown ----
const breakdown = buildDailyBreakdown(snapshots.slice(0, 1));
assertEqual(breakdown[0].date, '2026-08-20', '逐日明細應該保留原始日期');
assertEqual(breakdown[0].statuses.institutional.classification, 'failed', '逐日明細裡每個資料源應該有分類結果');
assertEqual(breakdown[0].statuses.institutional.raw, '失敗: timeout', '逐日明細應該保留原始訊息文字，方便追查細節');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
