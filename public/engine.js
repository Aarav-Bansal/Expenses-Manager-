// Pure game logic (no DOM, no canvas) so it can be unit-tested with `node --test`.
export const W = 480, H = 640;
export const LINE_Y = H - 104;      // the "Ledger Line": a demon crossing it possesses you
export const PLAYER_Y = H - 52;
export const DEMON_H = 78;
export const CATS = ['work', 'personal', 'unknown'];
export const MAX_ACTIVE = 6;

const TIER = {
  imp: { w: 118, hp: 1, speed: 1.25 },
  specter: { w: 128, hp: 1, speed: 1 },
  wraith: { w: 140, hp: 2, speed: 0.85 },
  'arch-fiend': { w: 160, hp: 3, speed: 0.7 },
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createGame(expenses, { calm = false, rng = Math.random, lives = 5 } = {}) {
  return {
    calm, rng, t: 0, over: null, events: [],
    queue: expenses.map((e) => ({ e, slips: 0 })), demons: [], bolts: [],
    player: { x: W / 2, cool: 0, cat: 'work' },
    health: lives, maxHealth: lives, score: 0, combo: 0, banished: 0, total: expenses.length,
    spawnIn: 0.8, decisions: [], unreviewed: [],
  };
}

export const select = (g, cat) => { if (CATS.includes(cat)) g.player.cat = cat; };

function spawn(g) {
  const { e, slips } = g.queue.shift();
  const T = TIER[e.demon] ?? TIER.specter;
  let x = W / 2;
  for (let i = 0; i < 6; i++) {
    x = T.w / 2 + 8 + g.rng() * (W - T.w - 16);
    if (!g.demons.some((d) => d.y < DEMON_H * 1.3 && Math.abs(d.baseX - x) < (d.w + T.w) / 2)) break;
  }
  const demon = { e, slips, x, baseX: x, y: -DEMON_H, w: T.w, h: DEMON_H, hp: T.hp, maxHp: T.hp, cat: null, speed: T.speed, phase: g.rng() * 6.28 };
  g.demons.push(demon);
  g.events.push({ type: 'spawn', demon });
}

const spawnGap = (g) => Math.max(g.calm ? 1.7 : 0.9, (g.calm ? 2.4 : 1.5) - g.banished * 0.03);
const fallSpeed = (g) => (g.calm ? 26 : 40) + Math.min(g.calm ? 14 : 34, g.banished * 1.1);

function banish(g, d) {
  const matched = d.cat === d.e.hint;
  g.banished += 1;
  g.combo += 1;
  const points = 10 + (matched ? 5 : 0) + Math.min(g.combo, 10);
  g.score += points;
  g.decisions.push({ id: d.e.id, merchant: d.e.merchant, amount: d.e.amount, date: d.e.date, category: d.cat, row: d.e.row });
  g.events.push({ type: 'banish', demon: d, category: d.cat, matched, points });
}

function slip(g, d) {
  g.health -= 1;
  g.combo = 0;
  const requeued = d.slips < 1; // a slipped demon retreats into the ledger and returns once
  if (requeued) g.queue.push({ e: d.e, slips: d.slips + 1 });
  else g.unreviewed.push(d.e);
  g.events.push({ type: 'slip', demon: d, requeued });
}

/** Close the game: whatever is still on screen or queued stays unreviewed. */
export function endGame(g, reason) {
  if (g.over) return;
  g.over = reason;
  for (const d of g.demons) g.unreviewed.push(d.e);
  for (const q of g.queue) g.unreviewed.push(q.e);
  g.demons = []; g.queue = []; g.bolts = [];
  g.events.push({ type: 'over', reason });
}

/** Advance the world by dt seconds. input = { dir: -1|0|1, fire: boolean } */
export function step(g, dt, input = {}) {
  if (g.over) return;
  g.t += dt;
  const p = g.player;
  p.x = clamp(p.x + (input.dir ?? 0) * 330 * dt, 28, W - 28);
  p.cool -= dt;
  if (input.fire && p.cool <= 0) { g.bolts.push({ x: p.x, y: PLAYER_Y - 26, cat: p.cat }); p.cool = 0.22; g.events.push({ type: 'fire', cat: p.cat }); }

  g.spawnIn -= dt;
  if (g.spawnIn <= 0 && g.queue.length && g.demons.length < MAX_ACTIVE) { spawn(g); g.spawnIn = spawnGap(g); }

  const v = fallSpeed(g);
  for (const d of g.demons) {
    d.y += v * d.speed * dt;
    d.x = clamp(d.baseX + Math.sin(g.t * 1.1 + d.phase) * 14, d.w / 2, W - d.w / 2);
  }

  for (const b of g.bolts) b.y -= 560 * dt;
  g.bolts = g.bolts.filter((b) => b.y > -20);
  for (const b of [...g.bolts]) {
    const d = g.demons.find((x) => b.x >= x.x - x.w / 2 && b.x <= x.x + x.w / 2 && b.y >= x.y && b.y <= x.y + x.h);
    if (!d) continue;
    g.bolts.splice(g.bolts.indexOf(b), 1);
    d.cat ??= b.cat; // the first spell that lands decides the category
    if (d.cat !== b.cat) { g.events.push({ type: 'resist', demon: d }); continue; }
    d.hp -= 1;
    g.events.push({ type: 'hit', demon: d, x: b.x, y: b.y });
    if (d.hp <= 0) { g.demons.splice(g.demons.indexOf(d), 1); banish(g, d); }
  }

  for (const d of [...g.demons]) {
    if (d.y + d.h > LINE_Y) { g.demons.splice(g.demons.indexOf(d), 1); slip(g, d); }
  }

  if (g.health <= 0) endGame(g, 'lose');
  else if (!g.queue.length && !g.demons.length) endGame(g, 'win');
}
