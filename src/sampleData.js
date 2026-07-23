// src/sampleData.js
//
// 範例資料，格式跟 scan.mjs / latest.mjs 真實回傳的 JSON 完全一致，
// 只是內容是編造的（雖然股票代號/名稱是真實存在的台股，但數字是編的，不代表真實行情）。
// 給本機開發、還沒部署到 Netlify 或還沒接上真實資料源時，先看到完整 UI 長什麼樣子用。

export const isSampleData = true;

export const sampleScanResult = {
  generatedAt: '2026-07-07T06:10:00.000Z',
  elapsedMs: 8421,
  dataSourceStatus: {
    twse: 'ok (1023 檔)',
    tpex: 'ok (812 檔)',
    institutional: 'ok (987 檔)',
    historyArchive: 'ok（累積 3/3 天，天數足夠）',
    taiex: 'ok（使用真實 TAIEX 指數）',
    finmindTpexInstitutional: 'ok（查詢 4 檔上櫃候選，成功 4 檔）',
  },
  historicalDatesUsed: ['2026-07-06', '2026-07-03', '2026-07-02', '2026-07-01', '2026-06-30'],
  marketChangePercent: 0.82,
  marketChangePercentIsEstimate: false,
  totalCandidates: 1748,
  twseCandidatesWithHistory: 980,
  tpexCandidatesWithHistory: 768,
  excludedNoHistory: 12,
  longWatchlist: [
    {
      code: '2408', name: '南亞科', market: 'TWSE', close: 445.5, changePercent: 10.62, volume: 48000000,
      volumeRatio: 4.8, gapPercent: 8.2, relativeStrength: 9.8, institutionalRatio: 12.4,
      volumeContribution: 28.8, gapContribution: 19.4, relativeStrengthContribution: 19.6, institutionalContribution: 27.9, score: 95.7,
    },
    {
      code: '3037', name: '欣興', market: 'TWSE', close: 168.0, changePercent: 7.35, volume: 32000000,
      volumeRatio: 3.9, gapPercent: 5.1, relativeStrength: 6.9, institutionalRatio: 8.1,
      volumeContribution: 25.5, gapContribution: 17.5, relativeStrengthContribution: 18.5, institutionalContribution: 24.2, score: 85.7,
    },
    {
      code: '6488', name: '環球晶', market: 'TWSE', close: 512.0, changePercent: 6.02, volume: 21000000,
      volumeRatio: 3.2, gapPercent: 4.4, relativeStrength: 5.5, institutionalRatio: 5.6,
      volumeContribution: 22.2, gapContribution: 16.0, relativeStrengthContribution: 16.7, institutionalContribution: 19.8, score: 74.7,
    },
    {
      code: '5347', name: '世界', market: 'TPEx', close: 158.5, changePercent: 5.15, volume: 15000000,
      volumeRatio: 2.6, gapPercent: 3.0, relativeStrength: 4.3, institutionalRatio: 0,
      volumeContribution: 16.7, gapContribution: 12.6, relativeStrengthContribution: 14.0, institutionalContribution: 6.0, score: 49.3,
    },
    {
      code: '3231', name: '緯創', market: 'TWSE', close: 112.0, changePercent: 4.28, volume: 12000000,
      volumeRatio: 2.1, gapPercent: 2.2, relativeStrength: 3.1, institutionalRatio: 2.0,
      volumeContribution: 13.1, gapContribution: 9.5, relativeStrengthContribution: 11.1, institutionalContribution: 12.0, score: 45.7,
    },
  ],
  shortWatchlist: [
    {
      code: '3661', name: '世芯-KY', market: 'TWSE', close: 2680.0, changePercent: -8.84, volume: 9500000,
      volumeRatio: 4.1, gapPercent: -7.6, relativeStrength: -9.2, institutionalRatio: -10.8,
      volumeContribution: 25.2, gapContribution: 19.2, relativeStrengthContribution: 20.1, institutionalContribution: 26.4, score: 90.9,
    },
    {
      code: '8069', name: '元太', market: 'TPEx', close: 186.0, changePercent: -6.98, volume: 18000000,
      volumeRatio: 3.5, gapPercent: -5.8, relativeStrength: -6.7, institutionalRatio: 0,
      volumeContribution: 22.4, gapContribution: 16.9, relativeStrengthContribution: 17.6, institutionalContribution: 6.0, score: 62.9,
    },
    {
      code: '6669', name: '緯穎', market: 'TWSE', close: 2210.0, changePercent: -5.44, volume: 8200000,
      volumeRatio: 2.9, gapPercent: -4.1, relativeStrength: -5.0, institutionalRatio: -4.9,
      volumeContribution: 18.8, gapContribution: 13.8, relativeStrengthContribution: 14.9, institutionalContribution: 18.1, score: 65.6,
    },
    {
      code: '2454', name: '聯發科', market: 'TWSE', close: 3850.0, changePercent: -4.2, volume: 6100000,
      volumeRatio: 2.3, gapPercent: -3.0, relativeStrength: -3.6, institutionalRatio: -3.2,
      volumeContribution: 14.9, gapContribution: 11.0, relativeStrengthContribution: 12.0, institutionalContribution: 13.5, score: 51.4,
    },
    {
      code: '3596', name: '智易', market: 'TPEx', close: 45.6, changePercent: -3.1, volume: 5300000,
      volumeRatio: 1.9, gapPercent: -2.1, relativeStrength: -2.4, institutionalRatio: 0,
      volumeContribution: 11.3, gapContribution: 8.1, relativeStrengthContribution: 8.9, institutionalContribution: 6.0, score: 34.3,
    },
  ],
  disclaimer: '本結果僅供參考，不構成投資建議。當沖有資格與風險限制，請自行評估。',
};
