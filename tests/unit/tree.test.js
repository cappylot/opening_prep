import test from 'node:test';
import assert from 'node:assert/strict';
import { replayGame, buildTree, rankedMoves, START_KEY, fenKey, smoothScore, playPath, pathTo, formatLine, openingAlong } from '../../js/tree.js';
import { games, game } from '../fixtures/games.js';

const replayed = games.map((g) => replayGame(g, 'Opp')).filter(Boolean);

test('replayGame detects colour and result from the opponent side', () => {
  const r = replayGame(game('e4 c5', { oppColor: 'black', winner: 'black' }), 'OPP');
  assert.equal(r.oppColor, 'black');
  assert.equal(r.res, 1);
  assert.equal(r.vs, 'rival');
  assert.deepEqual(r.plies.map((p) => p[2]), ['e4', 'c5']);
  assert.equal(r.plies[0][0], START_KEY);
  assert.equal(r.plies[0][1], 'e2e4');
  const lost = replayGame(game('e4 c5', { oppColor: 'white', winner: 'black' }), 'opp');
  assert.equal(lost.res, 0);
  const drawn = replayGame(game('e4 c5', { oppColor: 'white' }), 'opp');
  assert.equal(drawn.res, 0.5);
});

test('replayGame skips aborted, variant and foreign games', () => {
  assert.equal(replayed.length, 8);
  assert.equal(replayGame(game('e4', { oppColor: 'white' }), 'someoneelse'), null);
  assert.equal(replayGame({ ...game('e4'), initialFen: '8/8/8/8/8/8/8/8 w - - 0 1' }, 'opp'), null);
});

test('replayGame honours the ply limit', () => {
  const r = replayGame(game('e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6'), 'opp', 4);
  assert.equal(r.plies.length, 4);
  assert.equal(r.len, 8);
  assert.equal(r.endKey, fenKey(playPath(['e2e4', 'e7e5', 'g1f3', 'b8c6']).chess.fen()));
});

test('buildTree counts replies and results per position', () => {
  const tree = buildTree(replayed, { color: 'black' });
  assert.equal(tree.games.length, 5);
  const afterE4 = tree.nodes.get(fenKey(playPath(['e2e4']).chess.fen()));
  const ranked = rankedMoves(afterE4);
  assert.equal(ranked[0].san, 'c5');
  assert.equal(ranked[0].n, 3);
  assert.equal(ranked[1].san, 'e6');
  assert.ok(Math.abs(ranked[0].freq - 0.75) < 1e-9);
  // c5 games: two losses and one win for the opponent
  assert.equal(ranked[0].win, 1);
  assert.equal(ranked[0].loss, 2);
});

test('transpositions merge into one node', () => {
  const tree = buildTree(replayed, { color: 'black' });
  const key = fenKey(playPath(['e2e4', 'c7c5', 'g1f3']).chess.fen());
  const node = tree.nodes.get(key);
  assert.equal(node.reach, 4); // 3 via 1.e4 c5 2.Nf3 + 1 via 1.Nf3 c5 2.e4
  assert.equal(rankedMoves(node)[0].san, 'd6');
  assert.equal(rankedMoves(node)[0].n, 4);
  assert.deepEqual(pathTo(node).length, 3);
});

test('filters by speed, rated and date', () => {
  assert.equal(buildTree(replayed, { color: 'white' }).games.length, 3);
  assert.equal(buildTree(replayed, { color: 'white', speeds: ['rapid'] }).games.length, 1);
  const since = Date.UTC(2026, 8, 20) - 30 * 864e5;
  assert.equal(buildTree(replayed, { color: 'white', since }).games.length, 2);
});

test('recency weighting favours recent games', () => {
  const now = Date.UTC(2026, 8, 20);
  const tree = buildTree(replayed, { color: 'white' }, { halfLifeDays: 30, now });
  const afterE4 = tree.nodes.get(fenKey(playPath(['e2e4']).chess.fen()));
  const [e5, c5] = rankedMoves(afterE4);
  assert.equal(e5.san, 'e5');
  assert.ok(e5.freq > 0.95, `e5 freq ${e5.freq}`);
  assert.ok(c5.w < 0.001);
});

test('opening names attach at the opening ply', () => {
  const tree = buildTree(replayed, { color: 'black' });
  const o = openingAlong(tree, ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4']);
  assert.equal(o.eco, 'B50');
  assert.equal(openingAlong(tree, ['e2e4', 'e7e6']).name, 'French Defense');
});

test('smoothScore pulls small samples to 50%', () => {
  assert.equal(smoothScore(0, 0, 0), 0.5);
  assert.ok(smoothScore(1, 0, 1) < 0.65);
  assert.ok(smoothScore(40, 0, 40) > 0.95);
});

test('formatLine numbers moves', () => {
  assert.equal(formatLine(['e4', 'c5', 'Nf3']), '1. e4 c5 2. Nf3');
  assert.equal(formatLine(['c5', 'Nf3'], 1), '1... c5 2. Nf3');
});
