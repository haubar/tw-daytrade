// netlify/functions/sync-trading-calendar.mjs
//
// 一次性手動同步工具：抓取 TWSE 官方公告的交易日曆（見 trading-calendar.mjs），
// 存進 Netlify Blobs（見 trading-calendar-cache.mjs），取代原本 trading-day.mjs 裡
// EXCHANGE_HOLIDAYS_BY_YEAR 手動維護、每年要記得更新的靜態表。對應《後續修改清單》
// P4「交易日曆自動化」。
//
// 這支 function 刻意不加排程設定，只給你手動打開網址觸發。TWSE 通常在年底前就會公告
// 下一年度的交易日曆，建議每年年底手動觸發一次同步即可，不需要天天跑。
//
// 用法：部署後打開 https://你的站台.netlify.app/.netlify/functions/sync-trading-calendar
//
// 行為：抓一次 holidaySchedule 端點（涵蓋該端點回傳的所有年度資料，不用自己指定年份），
// 依 ISO 日期字串的年份分組，一次寫入多個年度的 Blobs 快取。scan.mjs 之後判斷「今天要不要
// 寫入歷史累積庫」時，會優先參考這裡同步下來的資料（見 trading-day.mjs 的 isNonTradingDay
// 新增的 dynamicHolidays 參數），靜態表只在這裡還沒同步過、或同步失敗時當備援。

import { fetchExchangeHolidays } from './lib/trading-calendar.mjs';
import { saveExchangeHolidays } from './lib/trading-calendar-cache.mjs';

export default async () => {
  try {
    const holidays = await fetchExchangeHolidays();

    // 依年份分組：一個 holidaySchedule 回應通常涵蓋不只一個年度（例如年底常會同時公告
    // 明年上半年的資料），分開存成每年一筆，讓 getExchangeHolidays(year) 可以精準地
    // 只讀需要的那個年度，不用每次都整批讀出來再自己過濾。
    const holidaysByYear = new Map();
    for (const dateStr of holidays) {
      const year = Number(dateStr.slice(0, 4));
      if (!holidaysByYear.has(year)) holidaysByYear.set(year, new Set());
      holidaysByYear.get(year).add(dateStr);
    }

    if (holidaysByYear.size === 0) {
      return new Response(
        JSON.stringify({ error: 'TWSE 交易日曆端點回應了，但解析不出任何休市日，先不寫入 Blobs（避免用空資料覆蓋掉舊的、可能還有效的快取）' }, null, 2),
        { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' } }
      );
    }

    await Promise.all(
      [...holidaysByYear.entries()].map(([year, dates]) => saveExchangeHolidays(year, dates))
    );

    return new Response(
      JSON.stringify(
        {
          message: `同步完成，共 ${holidaysByYear.size} 個年度、${holidays.size} 個休市日已存入 Blobs`,
          years: [...holidaysByYear.keys()].sort(),
          holidaysByYear: Object.fromEntries(
            [...holidaysByYear.entries()].map(([year, dates]) => [year, [...dates].sort()])
          ),
        },
        null,
        2
      ),
      { headers: { 'content-type': 'application/json; charset=utf-8' } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
};
