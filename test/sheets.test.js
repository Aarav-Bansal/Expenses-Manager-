import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSheets, extractSheetId, colLetter, validateTags, SheetsError } from '../src/sheets.js';

const ID = 'abcdefghijklmnopqrstuvwxyz123456';
const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const HEADER = ['Date', 'Merchant', 'Amount', 'Category', 'Status', 'Reviewed At'];

const make = (handler) => {
  const calls = [];
  const sheets = makeSheets({ getToken: async () => 'tok', serviceAccount: 'sa@x.iam.gserviceaccount.com', now: () => new Date('2026-10-31T10:00:00Z'),
    fetchImpl: async (url, init = {}) => { calls.push({ url: decodeURIComponent(url), init }); return handler(decodeURIComponent(url), init); } });
  return { sheets, calls };
};

test('extractSheetId, colLetter and validateTags', () => {
  assert.equal(extractSheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`), ID);
  assert.equal(extractSheetId(ID), ID);
  assert.equal(extractSheetId('nope'), null);
  assert.deepEqual([0, 25, 26].map(colLetter), ['A', 'Z', 'AA']);
  assert.throws(() => validateTags([{ row: 1, category: 'work' }]), RangeError);
  assert.throws(() => validateTags([{ row: 5, category: 'evil' }]), RangeError);
  assert.deepEqual(validateTags([{ row: 5, category: 'work', extra: 1 }]), [{ row: 5, category: 'work' }]);
});

test('readLedger returns only unreviewed rows with their sheet row numbers', async () => {
  const { sheets } = make(async () => json({ values: [HEADER,
    ['2026-10-02', 'AMAZON.COM', '$42.19', '', ''],
    ['2026-10-03', 'GitHub', '4', 'Work', 'Submitted'],
    ['2026-10-04', 'Netflix', '15.49', '', '']] }));
  const rows = await sheets.readLedger(ID, 'Expenses');
  assert.deepEqual(rows.map((r) => [r.merchant, r.row, r.amount]), [['AMAZON.COM', 2, 42.19], ['Netflix', 4, 15.49]]);
});

test('readLedger explains missing columns and empty ledgers', async () => {
  await assert.rejects(() => make(async () => json({ values: [['Merchant', 'Amount']] })).sheets.readLedger(ID, 'Expenses'), /category, status/);
  await assert.rejects(() => make(async () => json({ values: [HEADER] })).sheets.readLedger(ID, 'Expenses'), /No unreviewed/);
});

test('tag writes Category, Status and Reviewed At for each row in one batch', async () => {
  const { sheets, calls } = make(async (url) => (url.includes('batchUpdate') ? json({}) : json({ values: [HEADER] })));
  assert.equal(await sheets.tag(ID, 'Expenses', [{ row: 2, category: 'work' }, { row: 4, category: 'unknown' }]), 2);
  const body = JSON.parse(calls.at(-1).init.body);
  assert.equal(body.valueInputOption, 'RAW');
  assert.deepEqual(body.data.map((d) => [d.range, d.values[0][0]]), [
    ["'Expenses'!D2", 'Work'], ["'Expenses'!E2", 'Submitted'], ["'Expenses'!F2", '2026-10-31'],
    ["'Expenses'!D4", 'Needs review'], ["'Expenses'!E4", 'Flagged'], ["'Expenses'!F4", '2026-10-31'],
  ]);
});

test('access errors tell the user to share the sheet with the service account', async () => {
  const { sheets } = make(async () => json({}, 403));
  await assert.rejects(() => sheets.readLedger(ID, 'Expenses'), (e) => e instanceof SheetsError && e.status === 400 && /sa@x\.iam/.test(e.message));
});
