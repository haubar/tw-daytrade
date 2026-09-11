import { buildSectorFlow, buildSectorReplay } from '../../netlify/functions/lib/sector-flow.mjs';
import { filterSectorsByCodes } from '../../netlify/functions/lib/sector-classification.mjs';

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

const sectors = [{ id: 'test', name: '測試板塊', codes: ['2330', '2317'] }];
const flow = buildSectorFlow([
  { date: '2026-09-01', records: [{ code: '2330', netBuyShares: 100, close: 1000, name: '台積電' }] },
  { date: '2026-09-02', records: [{ code: '2330', netBuyShares: -20, close: 1000, name: '台積電' }, { code: '2317', netBuyShares: 10, close: 100, name: '鴻海' }] },
  { date: '2026-09-03', records: [{ code: '2330', netBuyShares: 50, close: 1000, name: '台積電' }, { code: '2317', netBuyShares: 10, close: 100, name: '鴻海' }] },
], { sectors });

const item = flow.sectors[0];
assertEqual(item.recent20NetBuyAmount, 132000, '板塊資金應以法人股數乘收盤價估算');
assertEqual(item.recent5BuyCount, 4, '板塊應統計買超紀錄數');
assertEqual(item.recent5SellCount, 1, '板塊應統計賣超紀錄數');
assertEqual(item.state, 'surge', '流入且近況高於平均時應標示漲潮');
assertEqual(item.leaders[0].code, '2330', '板塊主力股票應依資金絕對值排序');
assertEqual(flow.classificationVersion, 1, '回應應帶有板塊分類版本');

const missingClose = buildSectorFlow([
  { date: '2026-09-04', records: [{ code: '2330', netBuyShares: 100, close: null }] },
], { sectors });
assertEqual(missingClose.sectors[0].coveredRecords, 0, '缺收盤價時不應把法人股數誤算成資金金額');

const replay = buildSectorReplay([
  { date: '2026-09-01', records: [{ code: '2330', netBuyShares: 10, close: 100 }] },
  { date: '2026-09-02', records: [{ code: '2330', netBuyShares: 20, close: 100 }] },
], { sectors });
assertEqual(replay.length, 2, '回放應為每個交易日建立一個 frame');
assertEqual(replay[1].date, '2026-09-02', '回放 frame 應依日期排序');
assertEqual(replay[1].sectors[0].recent5NetBuyAmount, 3000, '回放應使用截至當日的滾動資金統計');
assertEqual(filterSectorsByCodes(sectors, ['2317']).map((sector) => sector.id), ['test'], '自選股篩選應保留包含自選股的板塊');
assertEqual(filterSectorsByCodes(sectors, ['9999']), [], '沒有自選股落在板塊時應回傳空板塊清單');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
