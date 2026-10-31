import { W, H, LINE_Y, PLAYER_Y, createGame, step, select, endGame } from './engine.js';

const $ = (id) => document.getElementById(id);
const ctx = $('stage').getContext('2d');
const SYNC_DELAY = 1500;
const NAME = { work: 'Work', personal: 'Personal', unknown: 'Unknown' };
const ROW = { work: 'Work', personal: 'Personal', unknown: 'Needs review' };
const COLOR = { work: '#6bd5ff', personal: '#ff7b7b', unknown: '#e8c95c' };
const GLYPH = { work: 'W', personal: 'P', unknown: '?' };
const BODY = { imp: '#6a3b7a', specter: '#4b4a8a', wraith: '#2f5f7a', 'arch-fiend': '#7a2330' };
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SAMPLE = `date,merchant,amount,note
2026-10-02,AMAZON.COM,42.19,
2026-10-03,GitHub,4.00,Copilot seat
2026-10-04,Netflix,15.49,
2026-10-05,Uber,23.80,airport ride
2026-10-06,Delta Airlines,412.60,client visit
2026-10-07,DoorDash,31.25,
2026-10-08,Slack,87.50,
2026-10-09,Sephora,64.00,birthday gift
2026-10-10,Staples,18.99,printer paper
2026-10-12,Steam,59.99,
2026-10-14,Marriott,289.00,conference stay
2026-10-15,ACME HOLDINGS LLC,1250.00,
2026-10-17,Starbucks,6.45,`;

const S = { g: null, fmt: null, running: false, paused: false, started: false, last: 0, raf: 0, keys: new Set(),
  fx: [], shake: 0, calm: false, sheet: null, queue: [], synced: 0, syncError: '', flushing: false, timer: 0 };

const show = (name) => ['setup', 'game', 'done'].forEach((id) => { $(id).hidden = id !== name; });
const say = (msg) => { $('status').textContent = msg; };

async function api(path, body) {
  const res = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function formatter() {
  const currency = $('currency').value;
  const f = new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency });
  return (n) => f.format(n);
}

function hud() {
  const g = S.g;
  $('banished').textContent = `${g.banished} / ${g.total}`;
  $('sanity').textContent = '☠'.repeat(Math.max(0, g.health)) + '·'.repeat(g.maxHealth - Math.max(0, g.health));
  $('sanity').setAttribute('aria-label', `Sanity ${Math.max(0, g.health)} of ${g.maxHealth}`);
  $('score').textContent = g.score;
  $('sync').textContent = !S.sheet ? 'Offline' : S.syncError ? 'Retrying' : `${S.synced} saved`;
}

// ---- Setup -> game ----
async function begin(load, sheet = null) {
  $('error').textContent = '';
  try {
    const { expenses } = await load();
    S.calm = $('calm').checked;
    document.body.classList.toggle('calm', S.calm);
    Object.assign(S, { g: createGame(expenses, { calm: S.calm }), fmt: formatter(), sheet, queue: [], synced: 0, syncError: '', flushing: false,
      fx: [], shake: 0, paused: false, started: false, running: true, last: performance.now() });
    S.keys.clear();
    setSpell('work');
    $('pause').textContent = 'Pause';
    $('caption').textContent = '';
    show('game');
    hud();
    say(`${expenses.length} demons haunt the ledger. Press Space or Cast to begin.`);
    cancelAnimationFrame(S.raf);
    S.raf = requestAnimationFrame(loop);
  } catch (e) { $('error').textContent = e.message; }
}

function setSpell(cat) {
  if (!S.g) return;
  select(S.g, cat);
  document.querySelectorAll('.spellbar button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === cat)));
}

// ---- Effects ----
const burst = (x, y, color, n) => { if (S.calm || REDUCED) return; for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, v = 40 + Math.random() * 160; S.fx.push({ k: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ttl: 0.6, color }); } };
const floater = (x, y, text, color) => S.fx.push({ k: 'text', x, y, vy: -40, ttl: 1, text, color });

function onEvents() {
  for (const ev of S.g.events.splice(0)) {
    if (ev.type === 'spawn') $('caption').textContent = ev.demon.e.tale;
    else if (ev.type === 'hit') burst(ev.x, ev.y, '#fff', 3);
    else if (ev.type === 'resist') floater(ev.demon.x, ev.demon.y, 'Resists!', '#f3ebe0');
    else if (ev.type === 'banish') {
      const d = ev.demon;
      burst(d.x, d.y + d.h / 2, COLOR[ev.category], 18);
      floater(d.x, d.y, `+${ev.points}`, COLOR[ev.category]);
      say(`Banished ${d.e.merchant} as ${NAME[ev.category]}.${ev.matched ? ' The omens agreed.' : ''}`);
      if (S.sheet && d.e.row) { S.queue.push({ row: d.e.row, category: ev.category }); scheduleSync(); }
      hud();
    } else if (ev.type === 'slip') {
      if (!S.calm && !REDUCED) S.shake = 0.35;
      if (!S.calm && !REDUCED) S.fx.push({ k: 'flash', ttl: 0.25 });
      say(`${ev.demon.e.merchant} crossed the Ledger Line. ${ev.demon.slips === 0 ? 'It retreats into the ledger and will return.' : 'It stays unreviewed.'}`);
      hud();
    } else if (ev.type === 'over') { finish(); }
  }
}

// ---- Drawing ----
function ghost(d, t) {
  const { x, y, w, h } = d;
  const left = x - w / 2, top = y;
  ctx.fillStyle = BODY[d.e.demon] ?? BODY.specter;
  ctx.beginPath();
  ctx.moveTo(left, top + h);
  ctx.lineTo(left, top + h * 0.4);
  ctx.quadraticCurveTo(left, top, x, top);
  ctx.quadraticCurveTo(left + w, top, left + w, top + h * 0.4);
  ctx.lineTo(left + w, top + h);
  const bumps = 5, bw = w / bumps, wob = Math.sin(t * 5 + d.phase) * 3;
  for (let i = bumps - 1; i >= 0; i--) ctx.quadraticCurveTo(left + bw * (i + 0.5), top + h - 10 + (i % 2 ? wob : -wob), left + bw * i, top + h);
  ctx.closePath();
  ctx.fill();
  if (d.cat) { ctx.lineWidth = 3; ctx.strokeStyle = COLOR[d.cat]; ctx.stroke(); }
  if (d.e.demon === 'imp' || d.e.demon === 'arch-fiend') { // horns
    ctx.fillStyle = '#e8d9c4';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x + s * (w / 2 - 22), top + 6); ctx.lineTo(x + s * (w / 2 - 10), top - 14); ctx.lineTo(x + s * (w / 2 - 36), top + 2); ctx.fill(); }
  }
  ctx.fillStyle = d.cat ? '#fff' : '#ffe27a'; // eyes
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(x + s * 20, top + 20, 6, 8, 0, 0, 6.28); ctx.fill(); }
  ctx.fillStyle = '#1c1410';
  for (const s of [-1, 1]) ctx.fillRect(x + s * 20 - 1.5, top + 18, 3, 6);
  // label plate
  ctx.fillStyle = '#efe6d2';
  ctx.fillRect(left + 8, top + 34, w - 16, 34);
  ctx.fillStyle = '#1c1410';
  ctx.textAlign = 'left';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillText(d.e.merchant.slice(0, 16), left + 13, top + 48);
  ctx.font = '12px ui-monospace, monospace';
  ctx.fillText(S.fmt(d.e.amount), left + 13, top + 62);
  if (d.cat) { ctx.font = 'bold 18px system-ui, sans-serif'; ctx.fillStyle = COLOR[d.cat]; ctx.strokeStyle = '#1c1410'; ctx.lineWidth = 3; ctx.textAlign = 'right'; ctx.strokeText(GLYPH[d.cat], left + w - 12, top + 63); ctx.fillText(GLYPH[d.cat], left + w - 12, top + 63); }
  if (d.maxHp > 1) { for (let i = 0; i < d.maxHp; i++) { ctx.fillStyle = i < d.hp ? '#ff6b6b' : 'rgba(255,255,255,.25)'; ctx.fillRect(left + w / 2 - d.maxHp * 7 + i * 14, top - 8, 11, 5); } }
  if (!d.cat && d.y > H * 0.33) { // the omen reveals itself as the demon nears the line
    const c = COLOR[d.e.hint];
    ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.globalAlpha = 0.35 + 0.25 * Math.sin(t * 6);
    ctx.strokeRect(left - 4, top - 4, w + 8, h + 8);
    ctx.globalAlpha = 1; ctx.fillStyle = c; ctx.font = 'bold 13px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`omen: ${GLYPH[d.e.hint]}`, x, top - 10);
  }
}

function exorcist(p, t) {
  const c = COLOR[p.cat], y = PLAYER_Y;
  ctx.fillStyle = '#1a1226'; // cloak
  ctx.beginPath(); ctx.moveTo(p.x - 24, y + 24); ctx.lineTo(p.x - 12, y - 8); ctx.lineTo(p.x + 12, y - 8); ctx.lineTo(p.x + 24, y + 24); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#2b1d40'; ctx.beginPath(); ctx.arc(p.x, y - 14, 12, 0, 6.28); ctx.fill(); // hood
  ctx.fillStyle = '#0b0708'; ctx.beginPath(); ctx.arc(p.x, y - 12, 7, 0, 6.28); ctx.fill();
  ctx.fillStyle = '#efe6d2'; ctx.fillRect(p.x - 4, y - 14, 3, 3); ctx.fillRect(p.x + 1, y - 14, 3, 3);
  ctx.strokeStyle = '#b8a58a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(p.x + 18, y + 22); ctx.lineTo(p.x + 18, y - 22); ctx.stroke(); // staff
  ctx.fillStyle = c; ctx.shadowColor = c; ctx.shadowBlur = 14 + Math.sin(t * 6) * 4; ctx.beginPath(); ctx.arc(p.x + 18, y - 26, 6, 0, 6.28); ctx.fill(); ctx.shadowBlur = 0;
}

function bolt(b) {
  ctx.fillStyle = COLOR[b.cat]; ctx.shadowColor = COLOR[b.cat]; ctx.shadowBlur = 10;
  ctx.beginPath();
  if (b.cat === 'work') { ctx.moveTo(b.x, b.y - 9); ctx.lineTo(b.x + 6, b.y); ctx.lineTo(b.x, b.y + 9); ctx.lineTo(b.x - 6, b.y); } // diamond
  else if (b.cat === 'personal') ctx.arc(b.x, b.y, 6, 0, 6.28); // circle
  else { ctx.moveTo(b.x, b.y - 9); ctx.lineTo(b.x + 7, b.y + 6); ctx.lineTo(b.x - 7, b.y + 6); } // triangle
  ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
}

function overlay(lines) {
  ctx.fillStyle = 'rgba(8,3,5,.72)'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.fillStyle = '#f3ebe0';
  lines.forEach(([text, size, color], i) => { ctx.font = `${size}px Metamorphous, Georgia, serif`; ctx.fillStyle = color ?? '#f3ebe0'; ctx.fillText(text, W / 2, H / 2 - 70 + i * 34); });
}

function draw() {
  const g = S.g, t = g.t;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (S.shake > 0) ctx.translate((Math.random() - 0.5) * 10 * S.shake * 3, (Math.random() - 0.5) * 10 * S.shake * 3);
  ctx.fillStyle = 'rgba(255,240,220,.9)'; ctx.shadowColor = '#ffe9c4'; ctx.shadowBlur = 30; ctx.beginPath(); ctx.arc(390, 70, 26, 0, 6.28); ctx.fill(); ctx.shadowBlur = 0; // moon
  ctx.fillStyle = 'rgba(234,241,239,.08)';
  for (let i = 0; i < 4; i++) ctx.fillRect(((t * (8 + i * 3) + i * 170) % (W + 200)) - 200, 120 + i * 130, 200, 26); // drifting fog
  ctx.fillStyle = '#0b0708'; // gravestones
  for (let i = 0; i < 9; i++) { const gx = i * 56 + 6; ctx.fillRect(gx, H - 40 - (i % 3) * 8, 26, 60); ctx.beginPath(); ctx.arc(gx + 13, H - 40 - (i % 3) * 8, 13, Math.PI, 0); ctx.fill(); }
  ctx.strokeStyle = 'rgba(255,107,107,.8)'; ctx.lineWidth = 2; ctx.setLineDash([10, 8]); ctx.beginPath(); ctx.moveTo(0, LINE_Y); ctx.lineTo(W, LINE_Y); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255,107,107,.85)'; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('THE LEDGER LINE', 8, LINE_Y - 6);
  g.demons.forEach((d) => ghost(d, t));
  g.bolts.forEach(bolt);
  exorcist(g.player, t);
  for (const f of S.fx) {
    if (f.k === 'spark') { ctx.globalAlpha = Math.max(0, f.ttl / 0.6); ctx.fillStyle = f.color; ctx.fillRect(f.x, f.y, 4, 4); ctx.globalAlpha = 1; }
    else if (f.k === 'text') { ctx.globalAlpha = Math.min(1, f.ttl); ctx.fillStyle = f.color; ctx.font = '16px Metamorphous, Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText(f.text, f.x, f.y); ctx.globalAlpha = 1; }
    else if (f.k === 'flash') { ctx.fillStyle = `rgba(255,60,60,${f.ttl})`; ctx.fillRect(0, 0, W, H); }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (!S.started) overlay([['Ledger Manor', 34, '#ff6b6b'], [`${g.total} unreviewed charges haunt the books.`, 15], ['Pick a spell: 1 Work, 2 Personal, 3 Unknown.', 15], ['Hit a demon to decide what it is.', 15], ['Press Space or Cast to begin', 18, '#e8c95c']]);
  else if (S.paused) overlay([['Paused', 34, '#e8c95c'], ['Press P or Pause to resume', 16]]);
}

function updateFx(dt) {
  for (const f of S.fx) { f.ttl -= dt; if (f.k === 'spark') { f.x += f.vx * dt; f.y += f.vy * dt; } else if (f.k === 'text') f.y += f.vy * dt; }
  S.fx = S.fx.filter((f) => f.ttl > 0);
  S.shake = Math.max(0, S.shake - dt);
}

function loop(now) {
  if (!S.running) return;
  const dt = Math.min(0.05, (now - S.last) / 1000);
  S.last = now;
  const k = S.keys;
  if (S.started && !S.paused) {
    const dir = (k.has('arrowright') || k.has('d') ? 1 : 0) - (k.has('arrowleft') || k.has('a') ? 1 : 0);
    step(S.g, dt, { dir, fire: k.has(' ') });
    onEvents();
  }
  updateFx(dt);
  if (S.g) draw();
  if (S.running) S.raf = requestAnimationFrame(loop);
}

function start() { if (!S.started) { S.started = true; say('The exorcism begins.'); } }
function togglePause() {
  if (!S.started || !S.g || S.g.over) return;
  S.paused = !S.paused;
  S.keys.clear();
  $('pause').textContent = S.paused ? 'Resume' : 'Pause';
  say(S.paused ? 'Paused.' : 'Resumed.');
}

// ---- Background action: tag the real Google Sheet while you play ----
function scheduleSync() { clearTimeout(S.timer); S.timer = setTimeout(flush, SYNC_DELAY); }

async function flush() {
  if (S.flushing || !S.sheet || !S.queue.length) return;
  S.flushing = true;
  while (S.queue.length) {
    const batch = S.queue.slice(0, 100);
    try {
      await api('/api/sheet/tag', { ...S.sheet, tags: batch });
      S.queue.splice(0, batch.length);
      S.synced += batch.length;
      S.syncError = '';
    } catch (e) { S.syncError = e.message; break; }
  }
  S.flushing = false;
  if (S.g) hud();
}

function syncMessage() {
  if (!S.sheet) return 'No sheet connected. Download the report to submit these expenses yourself.';
  if (S.syncError) return `${S.synced} rows saved to your sheet. ${S.queue.length} still waiting: ${S.syncError}`;
  return `Your Google Sheet is updated: ${S.synced} rows tagged and marked in the Status column.`;
}

function ending(g) {
  const won = g.over === 'win', left = g.unreviewed.length;
  if (won && g.health >= 4 && !left) return 'Dawn breaks over a spotless ledger. The manor is quiet and your mind is clear.';
  if (won) return `You survive the night with shaking hands. The books balance, mostly, and the house seems to be watching.`;
  if (g.over === 'lose') return 'The demons overwhelm you. Everything you banished stays filed, but the rest still haunts the manor.';
  return 'You leave the manor before dawn. What you banished stays filed. The rest waits in the dark.';
}

async function finish() {
  const g = S.g;
  S.running = false;
  cancelAnimationFrame(S.raf);
  S.keys.clear();
  clearTimeout(S.timer);
  show('done');
  $('doneError').textContent = '';
  $('endText').textContent = ending(g);
  $('leftover').textContent = g.unreviewed.length ? `${g.unreviewed.length} expenses were not reviewed. They stay untouched${S.sheet ? ' in your sheet' : ''}, so you can play again to finish them.` : '';
  $('syncDone').textContent = S.sheet && g.decisions.length ? 'Saving the last rows to your sheet...' : syncMessage();
  $('done-h').focus();
  $('totals').replaceChildren();
  $('flagged').replaceChildren();
  if (g.decisions.length) {
    try {
      const { summary, csv } = await api('/api/report', { decisions: g.decisions.map(({ id, merchant, amount, date, category }) => ({ id, merchant, amount, date, category })) });
      $('totals').replaceChildren(...['work', 'personal', 'unknown'].map((c) => {
        const tr = document.createElement('tr');
        [ROW[c], summary.by[c].count, S.fmt(summary.by[c].total)].forEach((v) => { const td = document.createElement('td'); td.textContent = v; tr.append(td); });
        return tr;
      }));
      const names = summary.flagged.length ? summary.flagged.map((f) => `${f.merchant} (${S.fmt(f.amount)})`) : ['None. The manor is at peace.'];
      $('flagged').replaceChildren(...names.map((n) => { const li = document.createElement('li'); li.textContent = n; return li; }));
      if ($('download').href.startsWith('blob:')) URL.revokeObjectURL($('download').href);
      $('download').href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      $('download').hidden = false;
    } catch (e) { $('doneError').textContent = e.message; }
  } else $('download').hidden = true;
  await flush();
  $('syncDone').textContent = syncMessage();
  $('retry').hidden = !(S.sheet && S.queue.length);
}

// ---- Wiring ----
const importCsv = (csv) => () => api('/api/import', { csv });
$('sample').addEventListener('click', () => begin(importCsv(SAMPLE)));
$('file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 1_000_000) { $('error').textContent = 'File is too large. Keep it under 1 MB.'; return; }
  const csv = await file.text();
  begin(importCsv(csv));
});
$('playSheet').addEventListener('click', () => {
  const sheet = { sheet: $('sheet').value.trim(), tab: $('tab').value.trim() || 'Expenses' };
  begin(() => api('/api/sheet/import', sheet), sheet);
});
$('finish').addEventListener('click', () => { if (S.g && !S.g.over) { endGame(S.g, 'quit'); onEvents(); } });
$('pause').addEventListener('click', (e) => { togglePause(); unfocusMouse(e); });
$('stage').addEventListener('click', () => { if (!S.started) start(); });
$('retry').addEventListener('click', async () => { $('syncDone').textContent = 'Retrying...'; await flush(); $('syncDone').textContent = syncMessage(); $('retry').hidden = !S.queue.length; });
$('again').addEventListener('click', () => show('setup'));
// After a mouse click, hand focus back to the page so Space keeps casting. Keyboard users keep focus.
const unfocusMouse = (e) => { if (e.detail) e.currentTarget.blur(); };
document.querySelectorAll('.spellbar button').forEach((b) => b.addEventListener('click', (e) => { setSpell(b.dataset.cat); unfocusMouse(e); }));

const CAT_KEYS = { 1: 'work', 2: 'personal', 3: 'unknown' };
const GAME_KEYS = ['arrowleft', 'arrowright', 'a', 'd', ' '];
document.addEventListener('keydown', (e) => {
  if ($('game').hidden || !S.g || e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (e.target.closest?.('button, input, select, summary') && key === ' ') { if (!S.started) { e.preventDefault(); start(); } return; }
  if (key === 'p' || key === 'escape') { togglePause(); return; }
  if (CAT_KEYS[e.key]) { setSpell(CAT_KEYS[e.key]); return; }
  if (!GAME_KEYS.includes(key)) return;
  e.preventDefault();
  if (key === ' ') start();
  S.keys.add(key);
});
document.addEventListener('keyup', (e) => S.keys.delete(e.key.toLowerCase()));
document.querySelectorAll('.pad button').forEach((btn) => {
  btn.addEventListener('pointerdown', () => { if (btn.dataset.key === ' ') start(); S.keys.add(btn.dataset.key); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, () => S.keys.delete(btn.dataset.key)));
});
document.addEventListener('visibilitychange', () => { if (document.hidden && S.started && !S.paused) togglePause(); });

api('/api/config').then(({ sheets }) => {
  $('sheetBox').hidden = !sheets.enabled;
  $('shareHint').textContent = sheets.serviceAccount ? `Share the sheet with ${sheets.serviceAccount} as Editor.` : 'Share the sheet with this app\'s service account as Editor.';
}).catch(() => {});
