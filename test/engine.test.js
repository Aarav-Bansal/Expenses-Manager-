import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, select, endGame, LINE_Y, W } from '../public/engine.js';

const exp = (id, over = {}) => ({ id, row: id + 1, date: '', merchant: `M${id}`, amount: 10, note: '', demon: 'imp', hint: 'work', tale: 't', ...over });
const game = (list, opts) => createGame(list, { rng: () => 0.5, ...opts });
const run = (g, seconds, input = {}) => { for (let i = 0; i < seconds * 60 && !g.over; i++) step(g, 1 / 60, input); };

/** Fly until the first demon spawns, then park the player under it. */
function aim(g) {
  while (!g.demons.length || g.demons[0].y < 150) step(g, 1 / 60); // wait until it is on screen
  g.player.x = g.demons[0].x;
}

test('a bolt tags and banishes a one-hit demon, scoring a bonus when it matches the omen', () => {
  const g = game([exp(1)]);
  aim(g);
  select(g, 'work');
  run(g, 3, { fire: true });
  assert.equal(g.over, 'win');
  assert.deepEqual(g.decisions.map((d) => [d.id, d.category, d.row]), [[1, 'work', 2]]);
  assert.equal(g.score, 10 + 5 + 1);
  assert.equal(g.unreviewed.length, 0);
});

test('the first spell to land decides the category; other spells are resisted', () => {
  const g = game([exp(1, { demon: 'wraith' })]); // 2 hp
  aim(g);
  select(g, 'personal');
  step(g, 1 / 60, { fire: true });
  run(g, 1.2);
  assert.equal(g.demons[0]?.cat, 'personal');
  select(g, 'work');
  g.player.x = g.demons[0].x;
  g.events.length = 0;
  run(g, 1, { fire: true });
  assert.ok(g.events.some((e) => e.type === 'resist'));
  assert.equal(g.demons[0].hp, 1);
  select(g, 'personal');
  g.player.x = g.demons[0].x;
  run(g, 2, { fire: true });
  assert.equal(g.decisions[0].category, 'personal');
});

test('tougher tiers take more hits', () => {
  const hp = (demon) => { const g = game([exp(1, { demon })]); aim(g); return g.demons[0].hp; };
  assert.deepEqual(['imp', 'specter', 'wraith', 'arch-fiend'].map(hp), [1, 1, 2, 3]);
});

test('a slipped demon costs health, returns once, then stays unreviewed', () => {
  const g = game([exp(1)], { lives: 5 });
  run(g, 120);
  assert.equal(g.over, 'win');
  assert.equal(g.health, 3);
  assert.deepEqual(g.unreviewed.map((e) => e.id), [1]);
  assert.equal(g.decisions.length, 0);
});

test('running out of health ends the game and leaves the rest unreviewed', () => {
  const g = game(Array.from({ length: 8 }, (_, i) => exp(i + 1)), { lives: 2 });
  run(g, 120);
  assert.equal(g.over, 'lose');
  assert.equal(g.unreviewed.length, 8);
});

test('endGame keeps what is left unreviewed, and calm mode is slower', () => {
  const g = game([exp(1), exp(2)]);
  run(g, 1.2);
  endGame(g, 'quit');
  assert.equal(g.over, 'quit');
  assert.equal(g.unreviewed.length, 2);
  const speed = (calm) => { const x = game([exp(1)], { calm }); aim(x); const y0 = x.demons[0].y; run(x, 1); return x.demons[0].y - y0; };
  assert.ok(speed(true) < speed(false));
});

test('the player is clamped to the field and the line is below the demons at spawn', () => {
  const g = game([exp(1)]);
  run(g, 5, { dir: 1 });
  assert.ok(g.player.x <= W - 28);
  assert.ok(LINE_Y < 640);
});
