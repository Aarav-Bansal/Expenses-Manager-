import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

const ID = 'abcdefghijklmnopqrstuvwxyz123456';
const tagged = [];
const fakeSheets = {
  serviceAccount: 'sa@x.iam.gserviceaccount.com',
  readLedger: async () => [{ id: 1, row: 7, date: '', merchant: 'AMAZON.COM', amount: 42.19, note: '' }],
  tag: async (_id, _tab, tags) => { tagged.push(...tags); return tags.length; },
};
const start = (sheets = fakeSheets) => new Promise((resolve) => { const s = createApp({ lookup: null, sheets }).listen(0, () => resolve(s)); });
const call = (s, path, body) => fetch(`http://127.0.0.1:${s.address().port}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('import then report works end to end', async () => {
  const s = await start();
  try {
    const imp = await call(s, '/api/import', { csv: 'merchant,amount\nAMAZON.COM,42.19\nGitHub,4' });
    const { expenses } = await imp.json();
    assert.equal(imp.status, 200);
    assert.deepEqual(expenses.map((e) => e.hint), ['unknown', 'work']);
    const rep = await call(s, '/api/report', { decisions: expenses.map((e) => ({ id: e.id, merchant: e.merchant, amount: e.amount, category: 'work' })) });
    const body = await rep.json();
    assert.equal(body.summary.by.work.count, 2);
    assert.match(body.csv, /AMAZON\.COM,42\.19,Work,Submitted/);
  } finally { s.close(); }
});

test('bad input gets a 400 and security headers are set', async () => {
  const s = await start();
  try {
    const res = await call(s, '/api/import', { csv: 'nope' });
    assert.equal(res.status, 400);
    assert.ok(res.headers.get('content-security-policy'));
    assert.equal(res.headers.get('x-powered-by'), null);
  } finally { s.close(); }
});

test('sheet import and background tagging', async () => {
  const s = await start();
  try {
    const cfg = await (await call(s, '/api/config')).json();
    assert.deepEqual(cfg.sheets, { enabled: true, serviceAccount: 'sa@x.iam.gserviceaccount.com' });
    const imp = await (await call(s, '/api/sheet/import', { sheet: ID, tab: 'Expenses' })).json();
    assert.equal(imp.expenses[0].row, 7);
    const res = await call(s, '/api/sheet/tag', { sheet: `https://docs.google.com/spreadsheets/d/${ID}/edit`, tab: 'Expenses', tags: [{ row: 7, category: 'work' }] });
    assert.deepEqual(await res.json(), { updated: 1 });
    assert.deepEqual(tagged, [{ row: 7, category: 'work' }]);
  } finally { s.close(); }
});

test('sheet routes validate input and respect a missing integration', async () => {
  const s = await start();
  try {
    assert.equal((await call(s, '/api/sheet/import', { sheet: 'nope' })).status, 400);
    assert.equal((await call(s, '/api/sheet/import', { sheet: ID, tab: "x'!A1" })).status, 400);
    assert.equal((await call(s, '/api/sheet/tag', { sheet: ID, tags: [{ row: 1, category: 'work' }] })).status, 400);
  } finally { s.close(); }
  const off = await start(null);
  try { assert.equal((await call(off, '/api/sheet/import', { sheet: ID })).status, 404); } finally { off.close(); }
});
