export const MAX_ROWS = 500;
export const CATEGORIES = ['work', 'personal', 'unknown'];

/** Split one CSV line, honouring quoted fields and "" escapes. */
export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** "$1,299.50", "₹649", "42.19" -> number (always positive, 2 dp); 0 if unreadable. */
export function parseAmount(raw) {
  const n = Math.abs(Number(String(raw ?? '').replace(/[^0-9.]/g, ''))) || 0;
  return n < 1e9 ? Math.round(n * 100) / 100 : 0;
}

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const normDate = (s) => (DATE_RE.test(String(s).trim().slice(0, 10)) ? String(s).trim().slice(0, 10) : '');

/** Shape one expense from raw cells; null when it has no merchant or amount. */
export function makeRow({ merchant, amount, date, note }, id, row = 0) {
  const m = clean(merchant, 60);
  const a = parseAmount(amount);
  if (!m || !a) return null;
  return { id, row, date: normDate(date), merchant: m, amount: a, note: clean(note, 80) };
}

/** Parse an expense CSV: date (optional), merchant, amount, note (optional). */
export function parseExpenses(text) {
  if (typeof text !== 'string') throw new TypeError('CSV must be sent as text.');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new RangeError('CSV needs a header row and at least one expense.');
  if (lines.length - 1 > MAX_ROWS) throw new RangeError(`CSV is limited to ${MAX_ROWS} rows.`);
  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (...names) => header.findIndex((h) => names.includes(h));
  const [d, m, a, n] = [col('date'), col('merchant', 'vendor', 'description'), col('amount', 'total'), col('note', 'notes', 'memo')];
  if (m === -1 || a === -1) throw new RangeError('Header must include: merchant, amount (date and note are optional).');
  const rows = [];
  for (const line of lines.slice(1)) {
    const f = parseCsvLine(line);
    const row = makeRow({ merchant: f[m], amount: f[a], date: d === -1 ? '' : f[d], note: n === -1 ? '' : f[n] }, rows.length + 1);
    if (row) rows.push(row);
  }
  if (!rows.length) throw new RangeError('No valid expenses found in that file.');
  return rows;
}

/** Neutralise spreadsheet formula injection and quote a CSV cell. */
export const csvCell = (v) => {
  const s = String(v ?? '');
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
