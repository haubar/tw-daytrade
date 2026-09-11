import { buildStockDetail } from '../../netlify/functions/lib/stock-detail.mjs';

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

const detail = buildStockDetail({
  code: '2330',
  sharedItem: { code: '2330', name: '台積電', market: 'TWSE' },
  latestScan: {
    generatedAt: '2026-09-11T06:00:00.000Z',
    longWatchlist: [{ code: '2330', name: '台積電', market: 'TWSE', close: 1000, changePercent: 1.2, volume: 123000, score: 88, dayTradeEligible: true }],
    shortWatchlist: [],
    dataSourceStatus: { twse: 'ok' },
  },
  results: [
    {
      signalDate: '2026-09-10',
      executionDate: '2026-09-11',
      trades: [{ code: '2330', name: '台積電', netReturnPercent: 1 }],
      adv: { trades: [{ code: '2330', name: '台積電', netReturnPercent: -0.5 }] },
      short: { trades: [{ code: '2330', name: '台積電', netReturnPercent: 2 }], adv: { trades: [] } },
    },
    {
      signalDate: '2026-09-09',
      executionDate: '2026-09-10',
      trades: [{ code: '2330', name: '台積電', netReturnPercent: 3 }],
      adv: { trades: [{ code: '2330', name: '台積電', netReturnPercent: 2 }] },
    },
  ],
  daysRequested: 60,
});

assertEqual(detail.name, '台積電', '個股明細應優先使用最新行情名稱');
assertEqual(detail.current.close, 1000, '個股明細應包含最新收盤價');
assertEqual(detail.current.signals.volumeContribution, null, '沒有因子資料時不應自行猜測量能貢獻');
assertEqual(detail.stockPoint, null, '沒有跨專案資料時應保留空值');
assertEqual(detail.strategies.base.trades, 2, '基準策略應彙總交易次數');
assertEqual(detail.strategies.base.winRatePercent, 100, '基準策略勝率應依既有回測交易計算');
assertEqual(detail.strategies.adv.avgNetReturnPercent, 0.75, '高級策略平均報酬應正確計算');
assertEqual(detail.strategies.shortBase.winRatePercent, 100, '空方基準策略應正確計算');
assertEqual(detail.disclaimer.includes('不代表未來上漲機率'), true, '個股明細應帶有勝率限制說明');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
