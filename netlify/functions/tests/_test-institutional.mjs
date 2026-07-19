// netlify/functions/_test-institutional.mjs
// 執行方式：npm run test:institutional

import { parseInstitutionalHtml, extractReportDate } from '../lib/institutional.mjs';

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

// 真實樣本（來自 www.twse.com.tw/fund/T86，2026-05-11 台泥/幸福/亞泥），
// 欄位與數字都是實際請求拿到的資料，重建成 HTML table 結構來測試解析邏輯。
const sampleHtml = `
<html><body>
<table>
  <tr>
    <th>證券代號</th><th>證券名稱</th>
    <th>外陸資買進股數(不含外資自營商)</th><th>外陸資賣出股數(不含外資自營商)</th><th>外陸資買賣超股數(不含外資自營商)</th>
    <th>外資自營商買進股數</th><th>外資自營商賣出股數</th><th>外資自營商買賣超股數</th>
    <th>投信買進股數</th><th>投信賣出股數</th><th>投信買賣超股數</th>
    <th>自營商買賣超股數</th>
    <th>自營商買進股數(自行買賣)</th><th>自營商賣出股數(自行買賣)</th><th>自營商買賣超股數(自行買賣)</th>
    <th>自營商買進股數(避險)</th><th>自營商賣出股數(避險)</th><th>自營商買賣超股數(避險)</th>
    <th>三大法人買賣超股數</th>
  </tr>
  <tr>
    <td>1101</td><td>台泥</td>
    <td>14,785,200</td><td>6,450,725</td><td>8,334,475</td>
    <td>0</td><td>0</td><td>0</td>
    <td>0</td><td>3,000</td><td>-3,000</td>
    <td>-99,054</td>
    <td>0</td><td>0</td><td>0</td>
    <td>224,946</td><td>324,000</td><td>-99,054</td>
    <td>8,232,421</td>
  </tr>
  <tr>
    <td>1104</td><td>環泥</td>
    <td>153,000</td><td>397,000</td><td>-244,000</td>
    <td>0</td><td>0</td><td>0</td>
    <td>0</td><td>0</td><td>0</td>
    <td>-6,670</td>
    <td>1,000</td><td>7,670</td><td>-6,670</td>
    <td>0</td><td>0</td><td>0</td>
    <td>-250,670</td>
  </tr>
</table>
</body></html>
`;

const result = parseInstitutionalHtml(sampleHtml);

assertEqual(result.size, 2, '應解析出 2 檔股票的法人買賣超資料');
assertEqual(result.get('1101'), 8232421, '台泥（1101）三大法人買賣超股數應正確解析（買超）');
assertEqual(result.get('1104'), -250670, '環泥（1104）三大法人買賣超股數應正確解析（賣超，含負號）');

// 找不到預期欄位（報表格式跟預期不同）時，應回傳空 map，而不是用錯的欄位算出誤導性數字
const malformedHtml = `<html><body><table><tr><th>證券代號</th><th>某個欄位</th></tr><tr><td>1101</td><td>100</td></tr></table></body></html>`;
const malformedResult = parseInstitutionalHtml(malformedHtml);
assertEqual(malformedResult.size, 0, '報表格式跟預期不同（找不到「三大法人買賣超股數」欄位）時應回傳空結果');

// ---- extractReportDate ----
// 真實樣本：報表標題「115年05月11日 三大法人買賣超日報」
const htmlWithDate = '<html><body><h3>115年05月11日 三大法人買賣超日報</h3><table></table></body></html>';
assertEqual(extractReportDate(htmlWithDate), '2026-05-11', '報表日期擷取：民國 115年05月11日 應轉為西元 2026-05-11');

const htmlWithoutDate = '<html><body><table></table></body></html>';
assertEqual(extractReportDate(htmlWithoutDate), null, '報表日期擷取：找不到日期格式時應回傳 null，而不是拋出例外');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
