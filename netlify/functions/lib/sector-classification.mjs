// 預設熱門板塊分類。這不是官方產業分類，後續由維護者人工增修並版本化。
// 一檔股票可以同時屬於多個板塊，因此不同板塊的金額不能直接相加。

export const SECTOR_CLASSIFICATION_VERSION = 1;

export const DEFAULT_SECTORS = [
  { id: 'semiconductor', name: '半導體', codes: ['2330', '2303', '2454', '3711', '3034', '2379', '6770', '3661', '3443'] },
  { id: 'ai-server', name: 'AI 伺服器', codes: ['2382', '3231', '6669', '2317', '2356', '3017', '2345'] },
  { id: 'memory', name: '記憶體', codes: ['2408', '2344', '3260', '8299', '2337', '5289'] },
  { id: 'pcb', name: 'PCB', codes: ['2313', '3037', '3044', '2367', '4958', '2383'] },
  { id: 'networking', name: '網通', codes: ['2345', '2419', '4904', '6285', '5388'] },
  { id: 'cooling', name: '散熱', codes: ['3324', '3017', '6230', '2421', '3338'] },
  { id: 'ev', name: '電動車', codes: ['2201', '2207', '2317', '1513', '2105'] },
  { id: 'financial', name: '金融', codes: ['2881', '2882', '2883', '2884', '2891', '5880', '2892'] },
  { id: 'shipping', name: '航運', codes: ['2603', '2609', '2615', '2618', '2637'] },
  { id: 'construction', name: '營建', codes: ['2501', '2542', '2548', '2520', '1808'] },
  { id: 'food', name: '食品', codes: ['1216', '1201', '1102', '1227'] },
  { id: 'biotech', name: '生技', codes: ['4743', '6547', '1760', '1795', '4107', '4128'] },
].map((sector) => ({ ...sector, codes: [...new Set(sector.codes)] }));

export function buildCodeToSectors(sectors = DEFAULT_SECTORS) {
  const map = new Map();
  for (const sector of sectors) {
    for (const code of sector.codes ?? []) {
      const list = map.get(code) ?? [];
      list.push(sector.id);
      map.set(code, list);
    }
  }
  return map;
}

export function getSectorById(id, sectors = DEFAULT_SECTORS) {
  return sectors.find((sector) => sector.id === id) ?? null;
}
