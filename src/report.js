import { CATEGORIES, csvCell, normDate } from './csv.js';

const round = (n) => Math.round(n * 100) / 100;
export const LABEL = { work: 'Work', personal: 'Personal', unknown: 'Needs review' };
export const STATUS = { work: 'Submitted', personal: 'Personal - not reimbursed', unknown: 'Flagged' };

/** Validate untrusted decisions from the client; throws RangeError with a user-safe message. */
export function validateDecisions(decisions) {
  if (!Array.isArray(decisions) || decisions.length === 0 || decisions.length > 500) throw new RangeError('Send between 1 and 500 decisions.');
  return decisions.map((d) => {
    const ok =
      d && Number.isInteger(d.id) && d.id > 0 &&
      typeof d.merchant === 'string' && d.merchant.length > 0 && d.merchant.length <= 60 &&
      Number.isFinite(d.amount) && d.amount > 0 && d.amount < 1e9 &&
      CATEGORIES.includes(d.category) &&
      (d.date === undefined || (typeof d.date === 'string' && d.date.length <= 10));
    if (!ok) throw new RangeError('One of the decisions is malformed.');
    return { id: d.id, merchant: d.merchant, amount: round(d.amount), category: d.category, date: normDate(d.date ?? '') };
  });
}

/** Totals per category plus the biggest anomalies still needing a human. */
export function buildReport(decisions) {
  const by = Object.fromEntries(CATEGORIES.map((c) => [c, { count: 0, total: 0 }]));
  for (const d of decisions) { by[d.category].count += 1; by[d.category].total = round(by[d.category].total + d.amount); }
  const flagged = decisions.filter((d) => d.category === 'unknown').sort((a, b) => b.amount - a.amount).slice(0, 10).map(({ merchant, amount }) => ({ merchant, amount }));
  return { reviewed: decisions.length, by, flagged };
}

/** Downloadable record of every decision (works with no Google Sheet connected). */
export const decisionsCsv = (decisions) =>
  ['Date,Merchant,Amount,Category,Status', ...decisions.map((d) =>
    [d.date, d.merchant, d.amount, LABEL[d.category], STATUS[d.category]].map(csvCell).join(','))].join('\n') + '\n';
