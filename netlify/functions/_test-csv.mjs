// netlify/functions/_test-csv.mjs
// 執行方式：npm run test:csv

import { parseCsv } from './lib/csv.mjs';

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

// 真實樣本（來自 www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY_ALL，2026-07-07 台泥）
const sampleCsv = `日期,證券代號,證券名稱,成交股數,成交金額,開盤價,最高價,最低價,收盤價,漲跌價差,成交筆數
"1150707","1101","台泥","33225864","778330046","23.65","23.70","23.25","23.40","-0.3000","8414"
"1150707","2330","台積電","31400854","77617188273","2480.00","2500.00","2440.00","2440.00","-20.0000","132943"`;

const parsed = parseCsv(sampleCsv);

assertEqual(parsed.length, 2, 'CSV 解析：兩筆資料列應解析出兩筆物件');
assertEqual(
  parsed[0],
  {
    '日期': '1150707',
    '證券代號': '1101',
    '證券名稱': '台泥',
    '成交股數': '33225864',
    '成交金額': '778330046',
    '開盤價': '23.65',
    '最高價': '23.70',
    '最低價': '23.25',
    '收盤價': '23.40',
    '漲跌價差': '-0.3000',
    '成交筆數': '8414',
  },
  'CSV 解析：台泥該筆資料每個欄位都對應正確'
);
assertEqual(parsed[1]['證券代號'], '2330', 'CSV 解析：第二筆資料（台積電）代號正確');

// 空白/格式不完整的行應被跳過
const csvWithJunk = `日期,證券代號,證券名稱
"1150707","1101","台泥"

junk line with wrong field count`;
const parsedWithJunk = parseCsv(csvWithJunk);
assertEqual(parsedWithJunk.length, 1, 'CSV 解析：空行與欄位數不符的行應被跳過');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
