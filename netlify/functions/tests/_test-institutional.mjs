// netlify/functions/_test-institutional.mjs
// 執行方式：npm run test:institutional

import { parseInstitutionalJson, formatT86Date, extractReportDate, fetchInstitutionalNetBuy } from '../lib/institutional.mjs';

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

// ---- parseInstitutionalJson ----
// 真實樣本（來自 www.twse.com.tw/rwd/zh/fund/T86?response=json，2026-08-21 實際請求拿到的
// 回應，只挑幾筆代表性資料，欄位跟數字都是真的，不是憑空編的）
const samplePayload = {
  stat: 'OK',
  date: '20260821',
  title: '115年08月21日 三大法人買賣超日報',
  fields: [
    '證券代號', '證券名稱',
    '外陸資買進股數(不含外資自營商)', '外陸資賣出股數(不含外資自營商)', '外陸資買賣超股數(不含外資自營商)',
    '外資自營商買進股數', '外資自營商賣出股數', '外資自營商買賣超股數',
    '投信買進股數', '投信賣出股數', '投信買賣超股數',
    '自營商買賣超股數',
    '自營商買進股數(自行買賣)', '自營商賣出股數(自行買賣)', '自營商買賣超股數(自行買賣)',
    '自營商買進股數(避險)', '自營商賣出股數(避險)', '自營商買賣超股數(避險)',
    '三大法人買賣超股數',
  ],
  data: [
    ['1101', '台泥            ', '22,198,312', '20,818,849', '1,379,463', '0', '0', '0', '0', '0', '0', '9,582', '91,000', '13,000', '78,000', '213,397', '281,815', '-68,418', '1,389,045'],
    ['1104', '環泥            ', '190,000', '466,235', '-276,235', '0', '0', '0', '0', '0', '0', '6,944', '7,000', '56', '6,944', '0', '0', '0', '-269,291'],
  ],
};

const result = parseInstitutionalJson(samplePayload);
assertEqual(result.size, 2, '應解析出 2 檔股票的法人買賣超資料');
assertEqual(result.get('1101'), 1389045, '台泥（1101）三大法人買賣超股數應正確解析（買超，取最後一個彙總欄位，不自己加總子項目）');
assertEqual(result.get('1104'), -269291, '環泥（1104）三大法人買賣超股數應正確解析（賣超，含負號）');

// ---- 找不到預期欄位（官方格式又變了）時，應回傳空 map，不是用錯的欄位算出誤導性數字 ----
const malformedPayload = { stat: 'OK', fields: ['證券代號', '某個欄位'], data: [['1101', '100']] };
assertEqual(parseInstitutionalJson(malformedPayload).size, 0, '格式跟預期不同（找不到「三大法人買賣超股數」欄位）時應回傳空結果');

// ---- stat !== 'OK'（非交易日或查無資料）：回傳空 map 是正確行為，不是解析失敗 ----
// 真實踩過的案例：這是原本 HTML 版本一直沒被抓到的 bug 根源——沒有明確的 stat 可以判斷，
// 導致「技術上成功但空結果」跟「真的沒資料」混在一起，這裡明確驗證這個情境。
assertEqual(parseInstitutionalJson({ stat: '查無資料' }).size, 0, 'stat 不是 OK 時（非交易日/查無資料）應回傳空 map');
assertEqual(parseInstitutionalJson(null).size, 0, '傳入 null 應該安全回傳空 map，不拋出例外');
assertEqual(parseInstitutionalJson(undefined).size, 0, '傳入 undefined 應該安全回傳空 map，不拋出例外');
assertEqual(parseInstitutionalJson({ stat: 'OK', fields: null, data: [] }).size, 0, 'fields 不是陣列時應該安全回傳空 map');
assertEqual(
  parseInstitutionalJson({ stat: 'OK', fields: ['證券代號', '三大法人買賣超股數'], data: ['not-an-array-row', ['1101', '100']] }).size,
  1,
  'data 裡混入不是陣列的列時，應該跳過該列、繼續處理其他正常的列，不拋出例外（防呆，理論上官方不會回這種格式）'
);

// ---- formatT86Date ----
assertEqual(formatT86Date('20260821'), '2026-08-21', '八碼純數字日期應轉為西元 YYYY-MM-DD 格式（T86 JSON 版本用純西元年，不是民國年）');
assertEqual(formatT86Date(20260821), '2026-08-21', '傳入數字型別也應正確轉換');
assertEqual(formatT86Date(''), null, '空字串應回傳 null');
assertEqual(formatT86Date(null), null, '傳入 null 應回傳 null，不拋出例外');
assertEqual(formatT86Date('2026-08-21'), null, '已經是 YYYY-MM-DD 格式（非預期輸入）應回傳 null，不誤判成合法的八碼格式');

// ---- extractReportDate：這個函式現在只給 history.mjs 用（另一個端點的日期還是包在 HTML 裡），
// T86 本身已經改用 formatT86Date，這裡的測試維持不變，確保 history.mjs 沒有被連帶影響 ----
const htmlWithDate = '<html><body><h3>115年05月11日 三大法人買賣超日報</h3><table></table></body></html>';
assertEqual(extractReportDate(htmlWithDate), '2026-05-11', '報表日期擷取：民國 115年05月11日 應轉為西元 2026-05-11');

const htmlWithoutDate = '<html><body><table></table></body></html>';
assertEqual(extractReportDate(htmlWithoutDate), null, '報表日期擷取：找不到日期格式時應回傳 null，而不是拋出例外');

// ---- fetchInstitutionalNetBuy 是否存在且可呼叫（實際網路請求無法在測試環境驗證，
// 只確認函式簽名沒有在重構過程中意外壞掉）----
assertEqual(typeof fetchInstitutionalNetBuy, 'function', 'fetchInstitutionalNetBuy 應該正常匯出為函式');

console.log(`\n測試結果：${passed} 通過, ${failed} 失敗`);
process.exit(failed > 0 ? 1 : 0);
