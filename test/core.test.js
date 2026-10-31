import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExpenses, parseAmount, csvCell } from '../src/csv.js';
import { ruleHint, summon } from '../src/categorize.js';
import { assignDemons } from '../src/story.js';
import { buildReport, decisionsCsv, validateDecisions } from '../src/report.js';

test('parseAmount reads currency symbols and separators', () => {
  assert.equal(parseAmount('$1,299.50'), 1299.5);
  assert.equal(parseAmount('₹649'), 649);
  assert.equal(parseAmount('abc'), 0);
});

test('parseExpenses reads optional columns and skips bad lines', () => {
  const rows = parseExpenses('date,merchant,amount,note\n2026-10-02,"AMAZON.COM",$42.19,\nbad,,5,x\n2026-10-03,GitHub,4,"seat, copilot"');
  assert.deepEqual(rows.map((r) => [r.merchant, r.amount, r.date, r.note]), [['AMAZON.COM', 42.19, '2026-10-02', ''], ['GitHub', 4, '2026-10-03', 'seat, copilot']]);
  assert.equal(parseExpenses('merchant,amount\nX,1')[0].date, '');
});

test('parseExpenses rejects bad headers and empty input', () => {
  assert.throws(() => parseExpenses('a,b\n1,2'), /Header must include/);
  assert.throws(() => parseExpenses('merchant,amount'), /header row/);
  assert.throws(() => parseExpenses(42), TypeError);
});

test('csvCell blocks formula injection and quotes commas', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('a,b'), '"a,b"');
});

test('ruleHint gives sensible omens', () => {
  assert.equal(ruleHint('GitHub'), 'work');
  assert.equal(ruleHint('Netflix'), 'personal');
  assert.equal(ruleHint('AMAZON.COM'), 'unknown');
  assert.equal(ruleHint('Sephora', 'birthday gift'), 'personal');
});

test('assignDemons scales tiers to the ledger, in any currency', () => {
  const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100].map((amount, i) => ({ id: i + 1, amount }));
  const tiers = assignDemons(rows).map((r) => r.demon);
  assert.equal(tiers[0], 'imp');
  assert.equal(tiers[9], 'arch-fiend');
});

test('summon prefers valid AI output and survives AI failure', async () => {
  const rows = [{ id: 1, merchant: 'AMAZON.COM', amount: 42, note: '', date: '', row: 0 }, { id: 2, merchant: 'GitHub', amount: 4, note: '', date: '', row: 0 }];
  const out = await summon(rows, async () => ({ 1: { hint: 'personal', tale: 'It hums.' }, 2: { hint: 'bogus', tale: 42 } }));
  assert.deepEqual(out.map((r) => [r.hint, r.tale === 'It hums.']), [['personal', true], ['work', false]]);
  const fallback = await summon(rows, async () => { throw new Error('boom'); });
  assert.equal(fallback[0].hint, 'unknown');
  assert.ok(fallback[0].tale.length > 10);
});

test('validateDecisions rejects malformed data; buildReport totals categories', () => {
  assert.throws(() => validateDecisions([]), RangeError);
  assert.throws(() => validateDecisions([{ id: 1, merchant: 'x', amount: 5, category: 'hax' }]), RangeError);
  const d = validateDecisions([
    { id: 1, merchant: 'GitHub', amount: 4, category: 'work', date: '2026-10-03' },
    { id: 2, merchant: 'AMAZON.COM', amount: 42.19, category: 'unknown' },
    { id: 3, merchant: 'Netflix', amount: 15.49, category: 'personal' },
  ]);
  const r = buildReport(d);
  assert.deepEqual(r.by.work, { count: 1, total: 4 });
  assert.deepEqual(r.flagged, [{ merchant: 'AMAZON.COM', amount: 42.19 }]);
  assert.match(decisionsCsv(d), /2026-10-03,GitHub,4,Work,Submitted/);
  assert.match(decisionsCsv(d), /AMAZON\.COM,42\.19,Needs review,Flagged/);
});
