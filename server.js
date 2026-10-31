import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseExpenses } from './src/csv.js';
import { summon } from './src/categorize.js';
import { makeGeminiLookup } from './src/gemini.js';
import { buildReport, decisionsCsv, validateDecisions } from './src/report.js';
import { makeSheetsFromEnv, extractSheetId, validateTags, SheetsError, TAB_RE } from './src/sheets.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ lookup = makeGeminiLookup(), sheets = makeSheetsFromEnv() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Cloud Run terminates TLS in front of us
  app.use(helmet());
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 120 }), express.json({ limit: '1mb' }));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.get('/api/config', (_req, res) => res.json({ aiEnabled: Boolean(lookup), sheets: { enabled: Boolean(sheets), serviceAccount: sheets?.serviceAccount ?? null } }));

  app.post('/api/import', async (req, res, next) => {
    let rows;
    try { rows = parseExpenses(req.body?.csv); } catch (e) { return res.status(400).json({ error: e.message }); }
    try { res.json({ expenses: await summon(rows, lookup) }); } catch (e) { next(e); }
  });

  /** Resolve and validate the sheet + tab from a request body, or answer 400/404. */
  const target = (req, res) => {
    const id = extractSheetId(req.body?.sheet);
    const tab = req.body?.tab ?? 'Expenses';
    if (!sheets) { res.status(404).json({ error: 'Google Sheets is not configured on this server.' }); return null; }
    if (!id) { res.status(400).json({ error: 'That does not look like a Google Sheets link or id.' }); return null; }
    if (typeof tab !== 'string' || !TAB_RE.test(tab)) { res.status(400).json({ error: 'Tab names can use letters, numbers, spaces, dots, dashes and underscores.' }); return null; }
    return { id, tab };
  };
  const sheetFail = (res, next) => (e) => (e instanceof SheetsError ? res.status(e.status).json({ error: e.message }) : next(e));

  app.post('/api/sheet/import', async (req, res, next) => {
    const t = target(req, res);
    if (!t) return;
    try { res.json({ expenses: await summon(await sheets.readLedger(t.id, t.tab), lookup) }); } catch (e) { sheetFail(res, next)(e); }
  });

  // Called in the background while the player fights: writes Category + Status back to the sheet.
  app.post('/api/sheet/tag', async (req, res, next) => {
    const t = target(req, res);
    if (!t) return;
    let tags;
    try { tags = validateTags(req.body?.tags); } catch (e) { return res.status(400).json({ error: e.message }); }
    try { res.json({ updated: await sheets.tag(t.id, t.tab, tags) }); } catch (e) { sheetFail(res, next)(e); }
  });

  app.post('/api/report', (req, res) => {
    let decisions;
    try { decisions = validateDecisions(req.body?.decisions); } catch (e) { return res.status(400).json({ error: e.message }); }
    res.json({ summary: buildReport(decisions), csv: decisionsCsv(decisions) });
  });

  app.use(express.static(path.join(here, 'public')));
  app.use((err, _req, res, _next) => res.status(err.status === 400 ? 400 : 500).json({ error: 'Request failed. Please try again.' }));
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT || 8080;
  createApp().listen(port, () => console.log(`Expense Exorcist listening on ${port}`));
}
