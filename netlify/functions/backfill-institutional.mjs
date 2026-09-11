import { fetchOneDay } from './lib/history.mjs';
import { fetchInstitutionalNetBuy } from './lib/institutional.mjs';
import { getExchangeHolidaysForYears } from './lib/trading-calendar-cache.mjs';
import { formatIsoDate, getPastTradingDayCandidates } from './lib/trading-day.mjs';
import { getArchivedInstitutionalDates, saveInstitutionalSnapshot } from './lib/institutional-archive.mjs';
import { errorResponse, jsonResponse } from './lib/http.mjs';

const MAX_DAYS = 20;
const MAX_CANDIDATES = 45;

const parseDays = (value) => Math.min(Math.max(Number.parseInt(value, 10) || MAX_DAYS, 1), MAX_DAYS);

const loadDynamicHolidays = async () => {
  try {
    const now = new Date();
    return await getExchangeHolidaysForYears([now.getFullYear(), now.getFullYear() - 1]);
  } catch {
    return new Set();
  }
};

const buildRecords = (institutional, quotes) => {
  const quoteByCode = new Map(quotes.map((quote) => [quote.code, quote]));
  return [...institutional.netBuyByCode.entries()].map(([code, netBuyShares]) => ({
    code,
    name: quoteByCode.get(code)?.name ?? null,
    close: quoteByCode.get(code)?.close ?? null,
    market: 'TWSE',
    source: 'TWSE-T86-backfill',
    netBuyShares,
  }));
};

export default async (req) => {
  if (req.method !== 'GET') return jsonResponse({ error: '只支援 GET' }, 405);

  try {
    const url = new URL(req.url);
    const targetDays = parseDays(url.searchParams.get('days'));
    const archived = new Set(await getArchivedInstitutionalDates());
    const holidays = await loadDynamicHolidays();
    const candidates = getPastTradingDayCandidates(new Date(), MAX_CANDIDATES, holidays);
    const debugInfo = [];
    const saved = [];

    for (const candidate of candidates) {
      if (saved.length >= targetDays) break;
      const requestedDate = formatIsoDate(candidate);
      if (archived.has(requestedDate)) continue;

      try {
        const market = await fetchOneDay(candidate);
        if (!market.actualDate || market.quotes.length === 0) {
          debugInfo.push({ requestedDate, status: 'skip', reason: '沒有有效上市行情' });
          continue;
        }
        const institutional = await fetchInstitutionalNetBuy(candidate);
        if (institutional.netBuyByCode.size === 0) {
          debugInfo.push({ requestedDate, actualDate: institutional.actualDate, status: 'skip', reason: '法人資料為空' });
          continue;
        }
        await saveInstitutionalSnapshot(institutional.actualDate, buildRecords(institutional, market.quotes), {
          coverage: { twse: institutional.netBuyByCode.size, tpex: 0, tpexIsCandidateOnly: true, backfilled: true },
        });
        archived.add(institutional.actualDate);
        saved.push(institutional.actualDate);
        debugInfo.push({ requestedDate, actualDate: institutional.actualDate, status: 'saved', recordCount: institutional.netBuyByCode.size });
      } catch (error) {
        debugInfo.push({ requestedDate, status: 'failed', error: error.message });
      }
    }

    return jsonResponse({ targetDays, savedDays: saved.length, saved, debugInfo });
  } catch (error) {
    return errorResponse(error);
  }
};
