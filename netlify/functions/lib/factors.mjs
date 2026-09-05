// netlify/functions/lib/factors.mjs
//
// Phase 1 三大量化因子的計算邏輯。純函式，不做任何網路請求，方便完整測試。

export function computeVolumeRatio(todayVolume, pastVolumes) {
  const validPast = pastVolumes.filter((v) => v > 0);
  if (validPast.length === 0) return 0;
  const avg = validPast.reduce((sum, v) => sum + v, 0) / validPast.length;
  if (avg === 0) return 0;
  return todayVolume / avg;
}

export function computeGapPercent(todayOpen, prevClose) {
  if (!prevClose || prevClose <= 0) return 0;
  return ((todayOpen - prevClose) / prevClose) * 100;
}

export function computeChangePercent(change, prevClose) {
  if (!prevClose || prevClose <= 0) return 0;
  return (change / prevClose) * 100;
}

export function computeRelativeStrength(stockChangePercent, marketChangePercent) {
  return stockChangePercent - marketChangePercent;
}

export function computeMultiDayRelativeStrength(dailyRelativeStrengths) {
  const valid = dailyRelativeStrengths.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (valid.length === 0) return 0;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

export function computeMarketChangeProxy(quotes) {
  let totalValue = 0;
  let weightedChangeSum = 0;
  for (const q of quotes) {
    const value = q.close * q.volume;
    const prevClose = q.close - q.change;
    if (!prevClose || prevClose <= 0 || value <= 0) continue;
    const changePercent = (q.change / prevClose) * 100;
    weightedChangeSum += changePercent * value;
    totalValue += value;
  }
  if (totalValue === 0) return 0;
  return weightedChangeSum / totalValue;
}

export function computeInstitutionalRatio(netBuyShares, todayVolume) {
  if (!todayVolume || todayVolume <= 0) return 0;
  return (netBuyShares / todayVolume) * 100;
}

/**
 * 百分位排名（0~100）。
 * ties 使用 average rank，避免相同因子值因排序位置不同而取得不同分數。
 * 單一樣本或全部同值時回傳中性 50。
 */
export function toPercentileRanks(values) {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [50];

  const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array(n);
  let start = 0;

  while (start < n) {
    let end = start;
    while (end + 1 < n && indexed[end + 1].v === indexed[start].v) end++;

    const averagePosition = (start + end) / 2;
    const percentile = (averagePosition / (n - 1)) * 100;
    for (let pos = start; pos <= end; pos++) {
      ranks[indexed[pos].i] = percentile;
    }
    start = end + 1;
  }

  return ranks;
}

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
