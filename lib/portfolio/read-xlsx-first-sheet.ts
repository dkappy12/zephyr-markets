import ExcelJS from "exceljs";

function normalizeCell(cell: ExcelJS.Cell): string | number | boolean {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("richText" in o && Array.isArray(o.richText)) {
      return (o.richText as { text: string }[]).map((x) => x.text).join("");
    }
    if ("result" in o && o.result !== undefined && o.result !== null) {
      const r = o.result;
      if (typeof r === "number" || typeof r === "boolean") return r;
      if (r instanceof Date) return r.toISOString();
      return String(r);
    }
    if ("text" in o && typeof o.text === "string") return o.text;
  }
  return String(v);
}

/**
 * Reads the first worksheet as row objects (first row = headers).
 * Used for broker Excel exports; `.xlsx` only (no legacy `.xls`).
 */
export async function readFirstSheetAsObjects(
  buffer: ArrayBuffer,
): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) {
    return { headers: [], rows: [] };
  }

  const matrix: Array<Array<string | number | boolean>> = [];

  sheet.eachRow((row) => {
    let maxCol = 0;
    row.eachCell({ includeEmpty: true }, (_cell, colNumber) => {
      maxCol = Math.max(maxCol, colNumber);
    });
    const cols: Array<string | number | boolean> = [];
    for (let c = 1; c <= maxCol; c++) {
      const cell = row.getCell(c);
      cols[c - 1] = normalizeCell(cell);
    }
    matrix.push(cols);
  });

  if (matrix.length === 0) {
    return { headers: [], rows: [] };
  }

  const headerRow = matrix[0]!.map((h) => String(h ?? "").trim());
  const rows: Record<string, unknown>[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r]!;
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < headerRow.length; c++) {
      const key = headerRow[c] || `column_${c + 1}`;
      obj[key] = line[c] ?? "";
    }
    rows.push(obj);
  }

  return { headers: headerRow, rows };
}
