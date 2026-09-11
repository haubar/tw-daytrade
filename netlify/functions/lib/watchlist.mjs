// 共用自選股的資料層。
//
// 這份清單是所有使用者共用，沒有帳號或個人權限。資料與掃描結果分開存放，
// 避免修改自選股時影響每日行情快照。audit 只保留有限筆數，防止共享文件無限增長。

import { getStore } from '@netlify/blobs';

export const WATCHLIST_STORE_NAME = 'shared-watchlist';
export const WATCHLIST_KEY = 'current';
export const WATCHLIST_SCHEMA_VERSION = 1;
export const MAX_AUDIT_ENTRIES = 500;

const defaultStore = () => {
  return getStore(WATCHLIST_STORE_NAME);
}

const nowIso = () => {
  return new Date().toISOString();
}

const normalizeCode = (value) => {
  return String(value ?? '').trim().toUpperCase();
}

const normalizeName = (value, code) => {
  const name = String(value ?? '').trim();
  return name || code;
}

const normalizeMarket = (value) => {
  return value === 'TPEx' ? 'TPEx' : 'TWSE';
}

export function emptyWatchlist(now = nowIso()) {
  return {
    schemaVersion: WATCHLIST_SCHEMA_VERSION,
    updatedAt: now,
    items: [],
    audit: [],
  };
}

export function normalizeWatchlist(value) {
  const source = value && typeof value === 'object' ? value : {};
  const items = Array.isArray(source.items)
    ? source.items
        .map((item) => {
          const code = normalizeCode(item?.code);
          if (!code) return null;
          return {
            code,
            name: normalizeName(item?.name, code),
            market: normalizeMarket(item?.market),
            addedAt: item?.addedAt || null,
            updatedAt: item?.updatedAt || item?.addedAt || null,
            addCount: Number.isFinite(Number(item?.addCount)) ? Math.max(1, Number(item.addCount)) : 1,
          };
        })
        .filter(Boolean)
    : [];

  const unique = new Map();
  for (const item of items) unique.set(item.code, item);

  const audit = Array.isArray(source.audit)
    ? source.audit
        .filter((entry) => entry && (entry.action === 'add' || entry.action === 'remove') && entry.code)
        .slice(-MAX_AUDIT_ENTRIES)
    : [];

  return {
    schemaVersion: WATCHLIST_SCHEMA_VERSION,
    updatedAt: source.updatedAt || null,
    items: [...unique.values()].sort((a, b) => a.code.localeCompare(b.code)),
    audit,
  };
}

export async function getSharedWatchlist(store = defaultStore()) {
  const value = await store.get(WATCHLIST_KEY, { type: 'json' });
  return normalizeWatchlist(value ?? emptyWatchlist());
}

const saveSharedWatchlist = async (value, store) => {
  const normalized = normalizeWatchlist(value);
  normalized.updatedAt = nowIso();
  await store.setJSON(WATCHLIST_KEY, normalized);
  return normalized;
}

export async function addToSharedWatchlist(input, store = defaultStore(), clock = nowIso) {
  const code = normalizeCode(input?.code);
  if (!/^\d{4,6}$/.test(code)) throw new Error('股票代碼必須是 4 到 6 碼數字');

  const current = await getSharedWatchlist(store);
  const timestamp = clock();
  const existing = current.items.find((item) => item.code === code);
  if (existing) {
    existing.name = normalizeName(input?.name, existing.name || code);
    existing.market = normalizeMarket(input?.market || existing.market);
    existing.updatedAt = timestamp;
    existing.addCount += 1;
  } else {
    current.items.push({
      code,
      name: normalizeName(input?.name, code),
      market: normalizeMarket(input?.market),
      addedAt: timestamp,
      updatedAt: timestamp,
      addCount: 1,
    });
  }

  current.audit.push({ action: 'add', code, at: timestamp });
  current.audit = current.audit.slice(-MAX_AUDIT_ENTRIES);
  return saveSharedWatchlist(current, store);
}

export async function removeFromSharedWatchlist(codeInput, store = defaultStore(), clock = nowIso) {
  const code = normalizeCode(codeInput);
  if (!/^\d{4,6}$/.test(code)) throw new Error('股票代碼必須是 4 到 6 碼數字');

  const current = await getSharedWatchlist(store);
  const removed = current.items.find((item) => item.code === code) ?? null;
  current.items = current.items.filter((item) => item.code !== code);
  const timestamp = clock();
  current.audit.push({
    action: 'remove',
    code,
    name: removed?.name ?? code,
    market: removed?.market ?? 'TWSE',
    at: timestamp,
  });
  current.audit = current.audit.slice(-MAX_AUDIT_ENTRIES);
  return { watchlist: await saveSharedWatchlist(current, store), removed };
}
