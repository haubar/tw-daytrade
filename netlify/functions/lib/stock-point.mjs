import { getStore } from '@netlify/blobs';

const STORE_NAME = 'scan-results';
const MAX_DAYS = 7;

const normalizeCode = (value) => String(value ?? '').trim().toUpperCase();

const getConfig = () => ({
  siteID: String(process.env.STOCK_POINT_SITE_ID ?? '').trim(),
  token: String(process.env.STOCK_POINT_BLOBS_TOKEN ?? '').trim(),
});

const parseScanKey = (key) => {
  const match = String(key ?? '').match(/^(\d{4}-\d{2}-\d{2})_([^_]+)_(\d+)$/);
  if (!match) return null;
  return { key, date: match[1], market: match[2], topN: Number(match[3]) };
};

const normalizeRecord = (date, scan, code) => {
  const result = (scan?.results ?? []).find((item) => normalizeCode(item?.code) === code);
  if (!result) return null;
  const feat = result.feat ?? {};
  return {
    date,
    market: result.market ?? scan?.stats?.market ?? null,
    close: Number.isFinite(Number(feat.cur)) ? Number(feat.cur) : null,
    volatilityPercent: Number.isFinite(Number(feat.histVol)) ? Number(feat.histVol) : null,
    bollingerWidthPercent: Number.isFinite(Number(feat.bbWidth)) ? Number(feat.bbWidth) : null,
    priceToMa60Percent: Number.isFinite(Number(feat.pToMa60)) ? Number(feat.pToMa60) : null,
    roc10Percent: Number.isFinite(Number(feat.roc10)) ? Number(feat.roc10) : null,
    trendStrengthPercent: Number.isFinite(Number(feat.trendStr)) ? Number(feat.trendStr) : null,
    score: Number.isFinite(Number(result.aiScore)) ? Number(result.aiScore) : null,
  };
};

export const parseStockPointScanKey = parseScanKey;

export async function getStockPointHistory(rawCode) {
  const code = normalizeCode(rawCode);
  const { siteID, token } = getConfig();
  if (!siteID || !token) {
    return { enabled: false, records: [], reason: '尚未設定 stock-point 跨專案 Blob 存取設定' };
  }

  try {
    const store = getStore(STORE_NAME, { siteID, token });
    const { blobs = [] } = await store.list();
    const entries = blobs
      .map((blob) => parseScanKey(blob.key))
      .filter(Boolean)
      .sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));

    const recordsByDate = new Map();
    for (const entry of entries) {
      if (recordsByDate.size >= MAX_DAYS) break;
      if (recordsByDate.has(entry.date)) continue;
      const scan = await store.get(entry.key, { type: 'json' });
      const record = normalizeRecord(entry.date, scan, code);
      if (record) recordsByDate.set(entry.date, record);
    }

    return { enabled: true, records: [...recordsByDate.values()] };
  } catch (error) {
    return { enabled: true, records: [], reason: error.message };
  }
}
