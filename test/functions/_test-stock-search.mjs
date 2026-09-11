import { findQuoteByCode, searchQuotes } from '../../netlify/functions/lib/stock-search.mjs';

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

const quotes = [
  { code: '2330', name: '台積電', market: 'TWSE', close: 1000, change: 10, volume: 1000000 },
  { code: '2303', name: '聯電', market: 'TWSE', close: 50, change: 1, volume: 500000 },
  { code: '6488', name: '環球晶', market: 'TPEx', close: 400, change: -5, volume: 200000 },
];

assertEqual(searchQuotes(quotes, '2330').map((item) => item.code), ['2330'], '應可用完整股號搜尋');
assertEqual(searchQuotes(quotes, '台積').map((item) => item.code), ['2330'], '應可用部分名稱搜尋');
assertEqual(searchQuotes(quotes, 'twse').map((item) => item.code), [], '不應用市場名稱誤配股票');
assertEqual(searchQuotes(quotes, '').length, 0, '空搜尋字串應回傳空結果');
assertEqual(searchQuotes(quotes, '23').map((item) => item.code), ['2303', '2330'], '股號前綴應可搜尋並排序');
assertEqual(findQuoteByCode(quotes, '2330', 'TWSE')?.name, '台積電', '加入前應能依代碼與市場確認行情');
assertEqual(findQuoteByCode(quotes, '2330', 'TPEx'), null, '市場不符時不可通過確認');

if (failed > 0) {
  console.error(`\n測試結果：${passed} 通過, ${failed} 失敗`);
  process.exit(1);
}
console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
