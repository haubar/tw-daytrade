import { buildCodeToSectors, DEFAULT_SECTORS, SECTOR_CLASSIFICATION_VERSION } from './sector-classification.mjs';

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function recordAmount(record) {
  if (!Number.isFinite(record?.netBuyShares) || !Number.isFinite(record?.close)) return null;
  return record.netBuyShares * record.close;
}

function classifyState(recentFiveAmount, recentTwentyAmount, availableFiveDays, availableTwentyDays) {
  const fiveDaily = availableFiveDays > 0 ? recentFiveAmount / availableFiveDays : 0;
  const twentyDaily = availableTwentyDays > 0 ? recentTwentyAmount / availableTwentyDays : 0;
  const accelerating = fiveDaily >= twentyDaily;
  if (recentFiveAmount > 0) return accelerating ? 'surge' : 'rotation';
  return accelerating ? 'watch' : 'ebb';
}

/**
 * 以法人買賣超股數 × 當日收盤價估算板塊資金流向。
 * 一檔股票若屬於多個板塊，會分別計入各板塊；因此板塊間不可直接加總。
 */
export function buildSectorFlow(snapshots, options = {}) {
  const sectors = options.sectors ?? DEFAULT_SECTORS;
  const codeToSectors = buildCodeToSectors(sectors);
  const orderedSnapshots = [...(snapshots ?? [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const lastFive = orderedSnapshots.slice(-5);
  const lastTwenty = orderedSnapshots.slice(-20);

  const result = sectors.map((sector) => {
    const codeSet = new Set(sector.codes ?? []);
    const aggregate = (days) => {
      let amount = 0;
      let buyCount = 0;
      let sellCount = 0;
      let coveredRecords = 0;
      const byCode = new Map();
      for (const snapshot of days) {
        for (const record of snapshot.records ?? []) {
          if (!codeSet.has(record.code) || !codeToSectors.get(record.code)?.includes(sector.id)) continue;
          const value = recordAmount(record);
          if (value == null) continue;
          amount += value;
          coveredRecords += 1;
          byCode.set(record.code, (byCode.get(record.code) ?? 0) + value);
          if (value > 0) buyCount += 1;
          if (value < 0) sellCount += 1;
        }
      }
      const leaders = [...byCode.entries()]
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 3)
        .map(([code, netBuyAmount]) => ({ code, netBuyAmount }));
      return { amount, buyCount, sellCount, coveredRecords, leaders };
    };

    const five = aggregate(lastFive);
    const twenty = aggregate(lastTwenty);
    const state = classifyState(five.amount, twenty.amount, lastFive.length, lastTwenty.length);
    return {
      id: sector.id,
      name: sector.name,
      constituentCount: sector.codes.length,
      recent5NetBuyAmount: five.amount,
      recent20NetBuyAmount: twenty.amount,
      recent5BuyCount: five.buyCount,
      recent5SellCount: five.sellCount,
      coveredRecords: twenty.coveredRecords,
      state,
      leaders: five.leaders,
    };
  });

  return {
    schemaVersion: 1,
    classificationVersion: SECTOR_CLASSIFICATION_VERSION,
    datesUsed: orderedSnapshots.map((snapshot) => snapshot.date),
    fiveDayDates: lastFive.map((snapshot) => snapshot.date),
    sectors: result,
    disclaimer: '板塊資金為法人買賣超股數乘當日收盤價的估算；板塊分類由本專案維護，不代表官方分類或投資建議。',
  };
}
