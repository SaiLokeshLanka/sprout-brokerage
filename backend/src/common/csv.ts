/** Paise → "1234.50" for spreadsheet columns. */
export const csvRupees = (paise: number | bigint | null | undefined) =>
  paise === null || paise === undefined ? '' : (Number(paise) / 100).toFixed(2);

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Spreadsheets run cells starting with = + @ as formulas ("CSV injection"); neutralise text cells.
  if (typeof value === 'string' && /^[=+@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Builds an RFC 4180 CSV (CRLF line endings, quoted where needed). */
export function toCsv(headers: string[], rows: unknown[][]) {
  return [headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
