import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { positionKey } from '../../js/study/positionKey.js';

const corpus = JSON.parse(readFileSync(new URL('../fixtures/PositionKeyCorpus.json', import.meta.url), 'utf8'));

test('position keys match the iOS corpus exactly', () => {
  const misses = corpus.filter((c) => positionKey(c.fen) !== c.key);
  assert.deepEqual(
    misses.map((c) => ({ name: c.name, got: positionKey(c.fen), want: c.key })),
    [],
  );
  assert.ok(corpus.length > 100);
});

test('castling order is normalised and a dead en-passant target is dropped', () => {
  assert.equal(positionKey('4k3/8/8/8/8/8/8/R3K2R w qkQK - 0 1').split(' ')[2], 'KQkq');
  assert.equal(positionKey('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1').split(' ')[3], '-');
});
