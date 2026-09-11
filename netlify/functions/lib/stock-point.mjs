import { getStore } from '@netlify/blobs';

const STORE_NAME = 'scan-results';
const LOCAL_TRIGGER_STORE_NAME = 'stock-point-trigger-cache';
const MAX_DAYS = 7;

const normalizeCode = (value) => String(value ?? '').trim().toUpperCase();

const getConfig = () => ({
  siteID: String(process.env.STOCK_POINT_SITE_ID ?? '').trim(),
  token: String(process.env.STOCK_POINT_BLOBS_TOKEN ?? '').trim(),
  analyzeUrl: String(process.env.STOCK_POINT_ANALYZE_URL ?? '').trim(),
  analyzeSecret: String(process.env.STOCK_POINT_ANALYZE_SECRET ?? '').trim(),
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

const normalizeOnDemandRecord = (record) => {
  const features = record?.features ?? {};
  return {
    date: record?.date ?? null,
    market: null,
    close: Number.isFinite(Number(features.cur)) ? Number(features.cur) : null,
    volatilityPercent: Number.isFinite(Number(features.histVol)) ? Number(features.histVol) : null,
    bollingerWidthPercent: Number.isFinite(Number(features.bbWidth)) ? Number(features.bbWidth) : null,
    priceToMa60Percent: Number.isFinite(Number(features.pToMa60)) ? Number(features.pToMa60) : null,
    roc10Percent: Number.isFinite(Number(features.roc10)) ? Number(features.roc10) : null,
    trendStrengthPercent: Number.isFinite(Number(features.trendStr)) ? Number(features.trendStr) : null,
    score: Number.isFinite(Number(record?.score)) ? Number(record.score) : null,
    scoreNote: record?.scoreNote ?? null,
  };
};

const triggerOnDemandAnalysis = async (code, analyzeUrl, analyzeSecret) => {
  if (!analyzeUrl || !analyzeSecret) return null;
  const separator = analyzeUrl.includes('?') ? '&' : '?';
  const response = await fetch(`${analyzeUrl}${separator}code=${encodeURIComponent(code)}`, {
    headers: { 'x-stock-point-secret': analyzeSecret },
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `stock-point 分析回應錯誤：HTTP ${response.status}`);
  return body.record ? normalizeOnDemandRecord(body.record) : null;
};

export async function getStockPointHistory(rawCode) {
  const code = normalizeCode(rawCode);
  const { siteID, token, analyzeUrl, analyzeSecret } = getConfig();
  if (!siteID || !token) {
    const missing = [
      !siteID ? 'STOCK_POINT_SITE_ID' : null,
      !token ? 'STOCK_POINT_BLOBS_TOKEN' : null,
    ].filter(Boolean);
    return { enabled: false, records: [], reason: `尚未設定：${missing.join('、')}` };
  }

  try {
    const localStore = getStore(LOCAL_TRIGGER_STORE_NAME);
    const today = new Date().toISOString().slice(0, 10);
    const localCached = await localStore.get(`${today}_${code}`, { type: 'json', consistency: 'strong' });
    if (localCached) return { enabled: true, triggered: false, records: [localCached] };

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

    if (recordsByDate.size === 0) {
      const analysisStore = getStore('watchlist-analysis', { siteID, token });
      const todayCached = await analysisStore.get(`${today}_${code}`, { type: 'json', consistency: 'strong' });
      if (todayCached) recordsByDate.set(todayCached.date, normalizeOnDemandRecord(todayCached));
    }

    if (recordsByDate.size === 0) {
      const analysisStore = getStore('watchlist-analysis', { siteID, token });
      const { blobs: analysisBlobs = [] } = await analysisStore.list();
      const matching = analysisBlobs
        .filter((blob) => new RegExp(`^\\d{4}-\\d{2}-\\d{2}_${code}$`).test(blob.key))
        .sort((a, b) => b.key.localeCompare(a.key));
      if (matching[0]) {
        const cached = await analysisStore.get(matching[0].key, { type: 'json' });
        if (cached) recordsByDate.set(cached.date, normalizeOnDemandRecord(cached));
      }
    }

    if (recordsByDate.size === 0) {
      const triggered = await triggerOnDemandAnalysis(code, analyzeUrl, analyzeSecret);
      if (triggered) {
        await localStore.setJSON(`${triggered.date}_${code}`, triggered);
        return { enabled: true, triggered: true, records: [triggered] };
      }
    }

    return {
      enabled: true,
      triggered: false,
      records: [...recordsByDate.values()],
      reason: recordsByDate.size === 0 && (!analyzeUrl || !analyzeSecret)
        ? `尚未設定：${[
            !analyzeUrl ? 'STOCK_POINT_ANALYZE_URL' : null,
            !analyzeSecret ? 'STOCK_POINT_ANALYZE_SECRET' : null,
          ].filter(Boolean).join('、')}`
        : undefined,
    };
  } catch (error) {
    return { enabled: true, records: [], reason: error.message };
  }
}
