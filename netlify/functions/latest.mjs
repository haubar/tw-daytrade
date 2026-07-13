// netlify/functions/latest.mjs
//
// 給前端 Dashboard 呼叫的輕量 function：直接讀 Netlify Blobs 裡最新一筆結果，
// 不會重新抓資料或重新計算（那是 scan.mjs 排程在做的事）。回應速度快，適合前端頻繁呼叫。

import { getLatestScan } from './lib/storage.mjs';

export default async (req) => {
  try {
    const latest = await getLatestScan();

    if (!latest) {
      return new Response(
        JSON.stringify({ error: '目前還沒有任何掃描結果，可能是排程還沒執行過第一次。' }),
        { status: 404, headers: { 'content-type': 'application/json; charset=utf-8' } }
      );
    }

    return new Response(JSON.stringify(latest, null, 2), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
};
