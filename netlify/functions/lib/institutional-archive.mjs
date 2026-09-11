// 法人歷史資料歸檔。
//
// 這份資料與每日掃描結果分開保存，供後續自選股 5/20 日趨勢與板塊資金流向使用。
// 缺少資料的股票不會被寫成 0；snapshot.records 只包含來源實際回傳的紀錄。

import { getStore } from '@netlify/blobs';

export const INSTITUTIONAL_STORE_NAME = 'institutional-history';
export const INSTITUTIONAL_INDEX_KEY = 'index';
export const INSTITUTIONAL_SCHEMA_VERSION = 1;
export const MAX_INSTITUTIONAL_DAYS = 260;

const defaultStore = () => {
  return getStore(INSTITUTIONAL_STORE_NAME);
}

const snapshotKey = (date) => {
  return `snapshot:${date}`;
}

const isIsoDate = (value) => {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''));
}

const normalizeRecords = (records) => {
  const source = records instanceof Map
    ? [...records.entries()].map(([code, netBuyShares]) => ({ code, netBuyShares }))
    : Array.isArray(records) ? records : [];
  const unique = new Map();

  for (const record of source) {
    const code = String(record?.code ?? '').trim();
    const netBuyShares = Number(record?.netBuyShares);
    if (!/^\d{4,6}$/.test(code) || !Number.isFinite(netBuyShares)) continue;
    unique.set(code, {
      code,
      name: String(record?.name ?? '').trim() || null,
      market: record?.market === 'TPEx' ? 'TPEx' : 'TWSE',
      source: String(record?.source ?? 'unknown'),
      netBuyShares,
      close: Number.isFinite(Number(record?.close)) ? Number(record.close) : null,
    });
  }

  return [...unique.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export function normalizeInstitutionalSnapshot(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    schemaVersion: INSTITUTIONAL_SCHEMA_VERSION,
    date: isIsoDate(source.date) ? source.date : null,
    generatedAt: source.generatedAt ?? null,
    coverage: source.coverage && typeof source.coverage === 'object' ? source.coverage : {},
    records: normalizeRecords(source.records),
  };
}

export async function saveInstitutionalSnapshot(date, records, metadata = {}, store = defaultStore(), clock = () => new Date().toISOString()) {
  if (!isIsoDate(date)) throw new Error('法人歷史資料缺少合法日期');

  const snapshot = {
    schemaVersion: INSTITUTIONAL_SCHEMA_VERSION,
    date,
    generatedAt: clock(),
    coverage: metadata.coverage ?? {},
    records: normalizeRecords(records),
  };

  await store.setJSON(snapshotKey(date), snapshot);
  const index = Array.isArray(await store.get(INSTITUTIONAL_INDEX_KEY, { type: 'json' }))
    ? await store.get(INSTITUTIONAL_INDEX_KEY, { type: 'json' })
    : [];
  const updated = [...new Set([date, ...index.filter(isIsoDate)])].sort((a, b) => b.localeCompare(a));
  const kept = updated.slice(0, MAX_INSTITUTIONAL_DAYS);
  await store.setJSON(INSTITUTIONAL_INDEX_KEY, kept);

  if (typeof store.delete === 'function') {
    await Promise.all(updated.slice(MAX_INSTITUTIONAL_DAYS).map((oldDate) => store.delete(snapshotKey(oldDate))));
  }
  return snapshot;
}

export async function getInstitutionalSnapshot(date, store = defaultStore()) {
  if (!isIsoDate(date)) return null;
  const value = await store.get(snapshotKey(date), { type: 'json' });
  return value ? normalizeInstitutionalSnapshot(value) : null;
}

export async function getArchivedInstitutionalDates(store = defaultStore()) {
  const index = await store.get(INSTITUTIONAL_INDEX_KEY, { type: 'json' });
  return Array.isArray(index) ? index.filter(isIsoDate).sort((a, b) => b.localeCompare(a)) : [];
}

export async function getRecentInstitutionalHistory(days = 20, excludeDate = null, store = defaultStore()) {
  const limit = Math.min(Math.max(Number.parseInt(days, 10) || 20, 1), MAX_INSTITUTIONAL_DAYS);
  const dates = (await getArchivedInstitutionalDates(store)).filter((date) => date !== excludeDate).slice(0, limit);
  const snapshots = await Promise.all(dates.map((date) => getInstitutionalSnapshot(date, store)));
  return snapshots.filter(Boolean);
}
