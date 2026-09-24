import test from 'node:test';
import assert from 'node:assert/strict';
import { replayGame, buildTree } from '../../js/tree.js';
import { summary, suggestLines, spots, predictability, firstMoves, headToHead } from '../../js/insights.js';
import { games, game } from '../fixtures/games.js';

const replayed = games.map((g) => replayGame(g, 'opp')).filter(Boolean);

test('summary groups openings by family', () => {
  const s = summary(buildTree(replayed, { color: 'black' }));
  assert.equal(s.n, 5);
  assert.equal(s.win, 2);
  assert.equal(s.loss, 2);
  assert.equal(s.draw, 1);
  assert.equal(s.openings[0].name, 'Sicilian Defense');
  assert.equal(s.openings[0].n, 3);
  assert.equal(s.openings[0].topVariation, 'Modern Variations');
});

test('suggested lines follow likely replies and pick our best-scoring move', () => {
  // Opp (Black) always answers 1.e4 with c5; after 2.Nf3 d6 we either play
  // 3.d4 (Opp loses) or 3.Bb5+ (Opp wins).
  const set = [];
  for (let i = 0; i < 6; i++) set.push(game('e4 c5 Nf3 d6 d4 cxd4', { oppColor: 'black', winner: 'white' }));
  for (let i = 0; i < 6; i++) set.push(game('e4 c5 Nf3 d6 Bb5+ Bd7', { oppColor: 'black', winner: 'black' }));
  const tree = buildTree(set.map((g) => replayGame(g, 'opp')), { color: 'black' });
  const lines = suggestLines(tree, 'black', { minN: 3 });
  assert.ok(lines.length >= 1);
  assert.deepEqual(lines[0].sans.slice(0, 5), ['e4', 'c5', 'Nf3', 'd6', 'd4']);
  assert.ok(lines[0].score < 0.5);
  assert.equal(lines[0].prob, 1);
  assert.ok(!lines.some((l) => l.sans.includes('Bb5+')));
});

test('suggested lines start from a given position', () => {
  const set = [];
  for (let i = 0; i < 5; i++) set.push(game('d4 Nf6 c4 e6 Nc3 Bb4', { oppColor: 'black', winner: 'white' }));
  for (let i = 0; i < 5; i++) set.push(game('e4 e5 Nf3 Nc6', { oppColor: 'black', winner: 'white' }));
  const tree = buildTree(set.map((g) => replayGame(g, 'opp')), { color: 'black' });
  const lines = suggestLines(tree, 'black', { start: ['d2d4'] });
  assert.ok(lines.length);
  assert.ok(lines.every((l) => l.path[0] === 'd2d4'));
});

test('spots find weak and strong positions', () => {
  const set = [];
  for (let i = 0; i < 6; i++) set.push(game('e4 e6 d4 d5 e5', { oppColor: 'black', winner: 'white' }));
  for (let i = 0; i < 6; i++) set.push(game('d4 d5 c4 e6', { oppColor: 'black', winner: 'black' }));
  const tree = buildTree(set.map((g) => replayGame(g, 'opp')), { color: 'black' });
  const s = spots(tree, { minN: 4 });
  assert.equal(s.weak[0].sans.join(' '), 'e4 e6');
  assert.equal(s.strong[0].sans.join(' '), 'd4 d5');
});

test('predictability and first moves', () => {
  const tree = buildTree(replayed, { color: 'black' });
  const p = predictability(tree, 'black');
  assert.ok(p > 0.5 && p <= 1);
  const fm = firstMoves(tree, 'black');
  assert.equal(fm[0].san, 'e4');
  assert.equal(fm[0].replies[0].san, 'c5');
  const fw = firstMoves(buildTree(replayed, { color: 'white' }), 'white');
  assert.equal(fw[0].replies[0].san, 'e4');
});

test('head to head counts from my side', () => {
  const h = headToHead(replayed, 'Rival');
  assert.equal(h.n, 8);
  assert.equal(headToHead(replayed, 'nobody').n, 0);
});
