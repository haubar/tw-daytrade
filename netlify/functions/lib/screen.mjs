// netlify/functions/lib/screen.mjs
//
// 整合流程：今日行情 + 歷史成交量 + 法人買賣超 → 四大因子 → 綜合評分 → 多方/空方觀察榜
// 這一層負責「串接」，實際計算邏輯都委派給 factors.mjs（已個別測試過）。

import {
  computeVolumeRatio,
  computeGapPercent,
  computeRelativeStrength,
  computeInstitutionalRatio,
  computeMarketChangeProxy,
  computeCompositeScores,
} from './factors.mjs';

/**
 * 把單一股票的今日行情 + 歷史成交量 + 法人買賣超，轉成候選股物件（含四大因子的原始值）
 */
function buildCandidate(quote, volumeHistory, institutionalNetBuy, marketChangePercent) {
  const prevClose = quote.close - quote.change;
  const changePercent = prevClose > 0 ? (quote.change / prevClose) * 100 : 0;
  const pastVolumes = volumeHistory.get(quote.code) || [];
  // 沒有法人買賣超資料的股票（例如上櫃股票，目前這個資料源只涵蓋上市），視為 0（中性，沒有法人訊號），
  // 不像量能異常因子那樣直接排除，因為「沒有法人資料」跟「量能異常算不出來」的意義不同：
  // 前者只是這個因子沒有訊號，後者是分母（均量）本身就沒有意義。
  const netBuyShares = institutionalNetBuy.get(quote.code) ?? 0;

  return {
    code: quote.code,
    name: quote.name,
    market: quote.market,
    close: quote.close,
    changePercent,
    volume: quote.volume, // 原始成交股數，給前端做「成交量過濾」用（跟 volumeRatio 不同，volumeRatio 是倍數不是絕對量）
    volumeRatio: computeVolumeRatio(quote.volume, pastVolumes),
    gapPercent: computeGapPercent(quote.open, prevClose),
    relativeStrength: computeRelativeStrength(changePercent, marketChangePercent),
    institutionalRatio: computeInstitutionalRatio(netBuyShares, quote.volume),
    hasHistory: pastVolumes.length > 0,
  };
}

/**
 * 主要進入點：產生今日的多方／空方觀察榜。
 *
 * @param {Array} todayQuotes 今日正規化後的行情（normalize.mjs 的輸出）
 * @param {Map<string, number[]>} volumeHistory 過去 N 日成交量歷史（history.mjs 的輸出）
 * @param {Map<string, number>} [institutionalNetBuy] 三大法人買賣超股數（institutional.mjs 的輸出），可省略（視為全部無資料）
 * @param {Object} [options]
 * @param {number} [options.topN=100] 多方／空方各取幾檔（拉大到 100 是為了讓前端篩選功能有足夠的候選池可以篩，不然 Top 30 篩一篩可能剩沒幾檔）
 * @param {Object} [options.weights] 因子權重，傳給 computeCompositeScores
 * @returns {{marketChangePercent: number, longWatchlist: Array, shortWatchlist: Array, totalCandidates: number, excludedNoHistory: number}}
 */
export function screenWatchlists(todayQuotes, volumeHistory, institutionalNetBuy = new Map(), options = {}) {
  const { topN = 100, weights } = options;

  const marketChangePercent = computeMarketChangeProxy(todayQuotes);

  const allCandidates = todayQuotes.map((q) => buildCandidate(q, volumeHistory, institutionalNetBuy, marketChangePercent));

  // 沒有歷史成交量資料的股票（例如新股），量能異常因子沒有意義，排除在評分之外。
  // 篩選完後順手把 hasHistory 這個「只是拿來篩選用」的內部標記拿掉，不要讓它外洩到最終輸出——
  // 前端不需要知道這個實作細節，多一個用不到的欄位只會讓資料結構變得不乾淨。
  const candidates = allCandidates.filter((c) => c.hasHistory).map(({ hasHistory, ...rest }) => rest);
  const excludedNoHistory = allCandidates.length - candidates.length;

  // 多方觀察榜：量能異常、跳空向上、相對強勢、法人買超，四者都是「越高越強」
  const longScored = computeCompositeScores(candidates, weights);

  // 空方觀察榜：量能異常「越高越明顯」（不管方向，爆量都代表有資金介入），
  // 但跳空、相對強弱、法人買賣超要反過來——越是跳空向下、越弱勢、法人賣超越多，才是越明確的空方訊號。
  // 不能直接把多方分數倒過來排序，那樣「量能低、沒什麼動作」的股票會被誤判成空方候選，
  // 但那其實只是平淡，不是「主動走弱」。
  const shortScored = computeCompositeScores(
    candidates.map((c) => ({
      ...c,
      gapPercent: -c.gapPercent,
      relativeStrength: -c.relativeStrength,
      institutionalRatio: -c.institutionalRatio,
    })),
    weights
  );
  // shortScored 的因子值被反轉過，排序完後換回原始的候選股物件（用 code 對應），避免顯示出反轉後的假數字，
  // 但因子貢獻度要保留 shortScored 算出來的，因為那才是「這檔股票為什麼上空方榜」的真正解釋。
  const candidateByCode = new Map(candidates.map((c) => [c.code, c]));
  const shortWatchlist = shortScored.slice(0, topN).map((s) => ({
    ...candidateByCode.get(s.code),
    score: s.score,
    volumeContribution: s.volumeContribution,
    gapContribution: s.gapContribution,
    relativeStrengthContribution: s.relativeStrengthContribution,
    institutionalContribution: s.institutionalContribution,
  }));

  return {
    marketChangePercent,
    longWatchlist: longScored.slice(0, topN),
    shortWatchlist,
    totalCandidates: candidates.length,
    excludedNoHistory,
  };
}
