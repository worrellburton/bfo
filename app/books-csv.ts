// Bank CSV parsing for the Books import dialog. Pure functions, no DOM.

/** One normalized import row. */
export type CsvRow = { date: string; description: string; amount: number };

/** Tiny CSV parser: quoted fields, commas, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

/** "8/7/2025" | "2025-08-07" → "2025-08-07" (null if unparseable). */
export function toIsoDate(s: string): string | null {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${yyyy}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/**
 * Normalize a parsed CSV into {date, description, amount} rows. Understands
 * Wells Fargo's headerless export (Date, Amount, *, blank, Description) and
 * any headered file with date/amount/description-ish columns.
 */
export function normalizeCsv(rows: string[][]): CsvRow[] {
  if (!rows.length) return [];
  const first = rows[0].map((v) => v.trim().toLowerCase());
  const hasHeader = first.some((v) => /date|amount|description|memo|payee/.test(v)) && !toIsoDate(rows[0][0] ?? "");
  const body = hasHeader ? rows.slice(1) : rows;
  let di = 0, ai = 1, ti = 4; // Wells Fargo default layout
  if (hasHeader) {
    di = first.findIndex((v) => v.includes("date"));
    ai = first.findIndex((v) => v.includes("amount"));
    ti = first.findIndex((v) => /description|memo|payee|name/.test(v));
    if (di < 0 || ai < 0) return [];
    if (ti < 0) ti = first.length - 1;
  }
  return body.flatMap((r) => {
    const date = toIsoDate(r[di] ?? "");
    const amount = Number(String(r[ai] ?? "").replace(/[$,]/g, ""));
    const description = (r[ti] ?? "").trim();
    if (!date || !Number.isFinite(amount) || amount === 0) return [];
    return [{ date, description, amount }];
  });
}
