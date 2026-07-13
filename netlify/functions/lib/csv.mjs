// netlify/functions/lib/csv.mjs
//
// 輕量 CSV 解析器，專門處理 TWSE 歷史資料端點回傳的格式：
// 第一行是標題列，之後每行都是雙引號包住的欄位，用逗號分隔。
// 不引入額外套件（如 papaparse），因為格式簡單且固定，手寫可控性更高。

/**
 * 解析一行 CSV（處理雙引號包住的欄位）
 */
function parseLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * 把 CSV 文字轉成物件陣列，用第一行當作欄位名稱（key）
 * @param {string} text
 * @returns {Array<Object>}
 */
export function parseCsv(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const headers = parseLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseLine(lines[i]);
    if (fields.length !== headers.length) continue; // 跳過格式不完整的行（例如尾端說明文字）
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = fields[idx];
    });
    rows.push(row);
  }

  return rows;
}
