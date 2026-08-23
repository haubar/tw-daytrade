// netlify/functions/lib/data-source-stats.mjs
//
// 統計歷史掃描結果裡，各個資料源（法人買賣超、TPEx、TAIEX...）實際的成功/失敗比例。
// 對應使用者的疑慮：「institutionalDataMissing 這個標示做完後，才發現幾乎每天法人
// 資料都抓失敗，不是只有上櫃股票的問題」——與其憑印象判斷，先寫工具把真實數字算出來。

// scan.mjs 寫入 dataSourceStatus 時的既有字串慣例：成功訊息開頭是 'ok'，
// 失敗訊息開頭是 '失敗'（見 scan.mjs 裡每個 dataSourceStatus 欄位的組字邏輯）。
// 少數欄位（例如 finmindTpexInstitutional 在「這輪沒有上櫃候選」時）會是其他中性說明文字，
// 這種歸類成 'unknown'，不算成功也不算失敗，避免把「沒有必要做」誤判成「失敗」。
const OK_PREFIX = 'ok';
const FAIL_PREFIX = '失敗';

/**
 * 把單一資料源狀態字串分類成 'ok' | 'failed' | 'unknown'。
 * @param {string|undefined|null} statusString
 * @returns {'ok'|'failed'|'unknown'}
 */
export function classifyStatus(statusString) {
  const str = String(statusString ?? '').trim();
  if (str.startsWith(OK_PREFIX)) return 'ok';
  if (str.startsWith(FAIL_PREFIX)) return 'failed';
  return 'unknown';
}

// 要統計的資料源欄位，對應 scan.mjs 的 dataSourceStatus 物件 key。
export const TRACKED_SOURCES = [
  'twse',
  'tpex',
  'institutional',
  'taiex',
  'finmindTpexInstitutional',
  'dayTradeEligibility',
  'historyArchive',
  'relativeStrengthWindow',
];

/**
 * 統計一批歷史快照裡，各資料源的成功/失敗次數與失敗率。
 * @param {Array<{date: string, dataSourceStatus: Object}>} snapshots
 * @returns {{daysAnalyzed: number, sources: Record<string, {okCount:number, failedCount:number, unknownCount:number, failureRatePercent:number|null}>}}
 *   failureRatePercent 的分母只算「ok + failed」（排除 unknown，例如「這輪沒有上櫃候選
 *   不需要查詢」這種中性情況不該拉低或墊高失敗率）；分母是0時（例如整批都是unknown）回傳null，
 *   不是0——0%失敗率意味著「有查過而且都成功」，跟「根本沒有可以拿來算的資料」意義不同。
 */
export function summarizeDataSourceHistory(snapshots) {
  const sources = {};
  for (const key of TRACKED_SOURCES) {
    sources[key] = { okCount: 0, failedCount: 0, unknownCount: 0, failureRatePercent: null };
  }

  for (const snap of snapshots ?? []) {
    for (const key of TRACKED_SOURCES) {
      const classification = classifyStatus(snap?.dataSourceStatus?.[key]);
      sources[key][`${classification}Count`] += 1;
    }
  }

  for (const key of TRACKED_SOURCES) {
    const s = sources[key];
    const denominator = s.okCount + s.failedCount;
    s.failureRatePercent = denominator > 0 ? Math.round((s.failedCount / denominator) * 1000) / 10 : null;
  }

  return { daysAnalyzed: (snapshots ?? []).length, sources };
}

/**
 * 組出每一天的明細（給想看逐日原始資料的人用，不只是彙總數字）。
 * @param {Array<{date: string, dataSourceStatus: Object}>} snapshots
 * @returns {Array<{date: string, statuses: Record<string, {classification: string, raw: string}>}>}
 */
export function buildDailyBreakdown(snapshots) {
  return (snapshots ?? []).map((snap) => ({
    date: snap.date,
    statuses: Object.fromEntries(
      TRACKED_SOURCES.map((key) => [
        key,
        { classification: classifyStatus(snap?.dataSourceStatus?.[key]), raw: snap?.dataSourceStatus?.[key] ?? null },
      ])
    ),
  }));
}
