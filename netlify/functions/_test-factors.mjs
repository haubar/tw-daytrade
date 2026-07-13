// netlify/functions/_test-factors.mjs
// 執行方式：npm run test:factors

import {
  computeVolumeRatio,
  computeGapPercent,
  computeRelativeStrength,
  computeInstitutionalRatio,
  computeMarketChangeProxy,
  toPercentileRanks,
  computeCompositeScores,
} from './lib/factors.mjs';

let passed = 0;
let failed = 0;

function assertClose(actual, expected, label, epsilon = 0.0001) {
  const ok = Math.abs(actual - expected) < epsilon;
  if (ok) {
    passed++;
    console.log(`✅ ${label}`);
  } else {
    failed++;
    console.log(`❌ ${label} — 期望 ${expected}, 實際 ${actual}`);
  }
}

function assertDeepClose(actual, expected, label) {
  const ok = actual.length === expected.length && actual.every((v, i) => Math.abs(v - expected[i]) < 0.0001);
  if (ok) {
    passed++;
    console.log(`✅ ${label}`);
  } else {
    failed++;
    console.log(`❌ ${label}`);
    console.log('   期望:', expected);
    console.log('   實際:', actual);
  }
}

// ---- computeVolumeRatio ----
assertClose(computeVolumeRatio(1000, [200, 200, 200, 200, 200]), 5, '量能異常：當日量是均量 5 倍');
assertClose(computeVolumeRatio(1000, [0, 0, 0]), 0, '量能異常：過去皆無交易時回傳 0（避免除以 0）');
assertClose(computeVolumeRatio(1000, []), 0, '量能異常：無歷史資料（新股）回傳 0');

// ---- computeGapPercent ----
assertClose(computeGapPercent(110, 100), 10, '跳空幅度：開盤 110 較前收 100 高，跳空 +10%');
assertClose(computeGapPercent(90, 100), -10, '跳空幅度：開盤 90 較前收 100 低，跳空 -10%');
assertClose(computeGapPercent(100, 0), 0, '跳空幅度：前收為 0（異常資料）時回傳 0');

// ---- computeRelativeStrength ----
assertClose(computeRelativeStrength(5, 1), 4, '相對強弱：個股漲 5% 大盤漲 1%，相對強弱 +4');
assertClose(computeRelativeStrength(-2, 1), -3, '相對強弱：個股跌 2% 大盤漲 1%，相對強弱 -3（弱勢股）');

// ---- computeInstitutionalRatio ----
assertClose(computeInstitutionalRatio(50000, 1000000), 5, '法人買賣超比例：買超 5 萬股佔成交量 100 萬股的 5%');
assertClose(computeInstitutionalRatio(-30000, 1000000), -3, '法人買賣超比例：賣超應為負值');
assertClose(computeInstitutionalRatio(50000, 0), 0, '法人買賣超比例：當日成交量為 0（異常資料）時回傳 0，避免除以 0');

// ---- computeMarketChangeProxy ----
// 兩檔股票：A 漲 10%、成交值大；B 跌 10%、成交值小 → 加權後應偏向 A（正值）
const marketQuotes = [
  { change: 10, close: 110, volume: 1000000 }, // prevClose=100, changePercent=10%, value≈1.1億
  { change: -1, close: 99, volume: 100 },      // prevClose=100, changePercent=-1%, value≈9900（極小）
];
const proxy = computeMarketChangeProxy(marketQuotes);
if (proxy > 5) {
  passed++;
  console.log(`✅ 大盤漲跌幅近似值：成交值大的股票影響力較大 (得到 ${proxy.toFixed(2)}%)`);
} else {
  failed++;
  console.log(`❌ 大盤漲跌幅近似值不符預期: ${proxy}`);
}

// ---- toPercentileRanks ----
assertDeepClose(toPercentileRanks([10, 20, 30]), [0, 50, 100], '百分位排名：三個遞增值應為 0/50/100');
assertDeepClose(toPercentileRanks([30, 10, 20]), [100, 0, 50], '百分位排名：順序打亂也要對應正確的原始 index');
assertDeepClose(toPercentileRanks([5]), [100], '百分位排名：只有一筆資料應回傳 100');

// ---- computeCompositeScores ----
const candidates = [
  { code: 'A', volumeRatio: 5, gapPercent: 8, relativeStrength: 6, institutionalRatio: 4 },  // 各項都最強
  { code: 'B', volumeRatio: 1, gapPercent: 1, relativeStrength: 1, institutionalRatio: 1 },  // 各項都最弱
  { code: 'C', volumeRatio: 3, gapPercent: 4, relativeStrength: 3, institutionalRatio: 2.5 },  // 中間
];
const scored = computeCompositeScores(candidates);
if (scored[0].code === 'A' && scored[1].code === 'C' && scored[2].code === 'B') {
  passed++;
  console.log('✅ 綜合評分：四項因子都最強的 A 排第一，都最弱的 B 排最後');
} else {
  failed++;
  console.log('❌ 綜合評分排序不符預期:', scored.map((s) => s.code));
}

// 因子貢獻度加總應該等於總分（不能悄悄漏算或多算）
const allContributionsSumCorrectly = scored.every(
  (s) =>
    Math.abs(
      s.volumeContribution + s.gapContribution + s.relativeStrengthContribution + s.institutionalContribution - s.score
    ) < 0.0001
);
if (allContributionsSumCorrectly) {
  passed++;
  console.log('✅ 綜合評分：每檔股票的四個因子貢獻度加總都等於總分');
} else {
  failed++;
  console.log('❌ 因子貢獻度加總與總分對不起來:', scored);
}

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
