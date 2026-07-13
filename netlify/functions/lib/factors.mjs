// netlify/functions/lib/factors.mjs
//
// Phase 1 三大量化因子的計算邏輯。純函式，不做任何網路請求，方便完整測試。

/**
 * 量能異常分數：當日成交量 ÷ 過去 N 日均量
 * @param {number} todayVolume
 * @param {number[]} pastVolumes 過去 N 日的成交量（不含當日）
 * @returns {number} 倍數，例如 3.5 代表當日量是均量的 3.5 倍
 */
export function computeVolumeRatio(todayVolume, pastVolumes) {
  const validPast = pastVolumes.filter((v) => v > 0);
  if (validPast.length === 0) return 0; // 沒有歷史資料可比較（例如新股）
  const avg = validPast.reduce((sum, v) => sum + v, 0) / validPast.length;
  if (avg === 0) return 0;
  return todayVolume / avg;
}

/**
 * 開盤跳空幅度（%）：(當日開盤 - 前一日收盤) / 前一日收盤 × 100
 * 正值代表向上跳空，負值代表向下跳空
 */
export function computeGapPercent(todayOpen, prevClose) {
  if (!prevClose || prevClose <= 0) return 0;
  return ((todayOpen - prevClose) / prevClose) * 100;
}

/**
 * 相對大盤強弱勢（%）：個股當日漲跌幅 - 大盤當日漲跌幅
 * @param {number} stockChangePercent 個股漲跌幅（%），例如 3.2
 * @param {number} marketChangePercent 大盤漲跌幅（%）
 */
export function computeRelativeStrength(stockChangePercent, marketChangePercent) {
  return stockChangePercent - marketChangePercent;
}

/**
 * 用「成交值加權平均漲跌幅」近似大盤漲跌幅，作為沒有另外接大盤指數 API 時的替代方案。
 * 之後若要接真正的加權指數（TAIEX），可以直接替換這個函式的呼叫端，不影響其他邏輯。
 *
 * @param {Array<{change: number, close: number, volume: number}>} quotes
 * @returns {number} 近似大盤漲跌幅（%）
 */
export function computeMarketChangeProxy(quotes) {
  let totalValue = 0;
  let weightedChangeSum = 0;
  for (const q of quotes) {
    const value = q.close * q.volume; // 成交值近似值
    const prevClose = q.close - q.change;
    if (!prevClose || prevClose <= 0 || value <= 0) continue;
    const changePercent = (q.change / prevClose) * 100;
    weightedChangeSum += changePercent * value;
    totalValue += value;
  }
  if (totalValue === 0) return 0;
  return weightedChangeSum / totalValue;
}

/**
 * 法人買賣超比例（%）：三大法人（外資+投信+自營商）當日買賣超股數 ÷ 當日成交量 × 100
 * 用「佔當日成交量的比例」而不是原始股數，是為了讓大型股（成交量本來就大）跟小型股可以公平比較，
 * 不然像台積電這種股本大的股票，買賣超股數的絕對值永遠會蓋過其他股票。
 *
 * @param {number} netBuyShares 三大法人買賣超股數（正值代表買超，負值代表賣超）
 * @param {number} todayVolume 當日成交股數
 */
export function computeInstitutionalRatio(netBuyShares, todayVolume) {
  if (!todayVolume || todayVolume <= 0) return 0;
  return (netBuyShares / todayVolume) * 100;
}

/**
 * 把一組數值轉成百分位排名（0~100），排名越高分數越高。
 * 用百分位而不是原始數值，是為了讓「量能倍數」「跳空%」「相對強弱%」
 * 這種量級完全不同的因子可以放在同一個加權公式裡。
 *
 * @param {number[]} values
 * @returns {number[]} 對應每個 value 的百分位分數（0~100），順序與輸入相同
 */
export function toPercentileRanks(values) {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [100];

  // 依數值排序，取得每個原始 index 對應的名次
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);

  const ranks = new Array(n);
  indexed.forEach((item, sortedPos) => {
    ranks[item.i] = (sortedPos / (n - 1)) * 100;
  });
  return ranks;
}

/**
 * 綜合評分：三大量化因子依權重加總（百分位分數 × 權重）
 * 預設權重：量能異常 40% + 跳空幅度 30% + 相對強弱 30%
 * （隔日沖因子屬於 Phase 2，需要候選名單出爐後才查得到分點資料，不在這裡計算）
 *
 * @param {Array<{volumeRatio: number, gapPercent: number, relativeStrength: number}>} candidates
 * @param {{volumeRatio: number, gapPercent: number, relativeStrength: number}} [weights]
 * @returns {Array} 原始 candidates 陣列，每筆加上 score 欄位，並依 score 由高到低排序
 */
/**
 * 綜合評分：四大因子依權重加總（百分位分數 × 權重）
 * 預設權重：量能異常 30% + 跳空幅度 20% + 相對強弱 20% + 法人買賣超 30%
 * （法人買賣超權重拉高，是原本規劃「隔日沖分點」因子的替代方案——
 * 分點查詢系統有驗證碼保護，改用免費且可完全自動化的三大法人買賣超日報）
 *
 * @param {Array<{volumeRatio: number, gapPercent: number, relativeStrength: number, institutionalRatio: number}>} candidates
 * @param {{volumeRatio: number, gapPercent: number, relativeStrength: number, institutionalRatio: number}} [weights]
 */
export function computeCompositeScores(
  candidates,
  weights = { volumeRatio: 0.3, gapPercent: 0.2, relativeStrength: 0.2, institutionalRatio: 0.3 }
) {
  if (candidates.length === 0) return [];

  const volumeRatioRanks = toPercentileRanks(candidates.map((c) => c.volumeRatio));
  const gapPercentRanks = toPercentileRanks(candidates.map((c) => c.gapPercent));
  const relativeStrengthRanks = toPercentileRanks(candidates.map((c) => c.relativeStrength));
  const institutionalRanks = toPercentileRanks(candidates.map((c) => c.institutionalRatio));

  const scored = candidates.map((c, i) => {
    // 個別因子對總分的貢獻（已乘上權重），供前端畫「因子解剖條」用，
    // 讓使用者一眼看出「這檔股票的分數主要是被哪個因子推高的」，而不只是一個總分數字。
    const volumeContribution = volumeRatioRanks[i] * weights.volumeRatio;
    const gapContribution = gapPercentRanks[i] * weights.gapPercent;
    const relativeStrengthContribution = relativeStrengthRanks[i] * weights.relativeStrength;
    const institutionalContribution = institutionalRanks[i] * weights.institutionalRatio;

    return {
      ...c,
      volumeContribution,
      gapContribution,
      relativeStrengthContribution,
      institutionalContribution,
      score: volumeContribution + gapContribution + relativeStrengthContribution + institutionalContribution,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}
