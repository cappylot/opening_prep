import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, currentId, expectedMove, lineComplete, isOppTurn, advanceOpp, submitMove, finishLine, summary, isRetry } from '../../js/drill.js';

const L = (id, path) => ({ id, name: id, path: path.split(' '), sans: [] });
const sicilian = L('sicilian', 'e2e4 c7c5 g1f3');
const openGame = L('open', 'e2e4 e7e5 g1f3');
const smith = L('smith', 'e2e4 c7c5 d2d4');
const lines = [sicilian, openGame, smith];
const seq = (...vals) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

/** Plays the current line perfectly as White, returning the finished session. */
function playLine(s, byId, myColor = 'white') {
  const line = byId.get(currentId(s));
  while (!lineComplete(s, line)) {
    if (isOppTurn(s, myColor)) s = advanceOpp(s);
    else s = submitMove(s, line, expectedMove(s, line), lines).session;
  }
  return finishLine(s);
}

test('every saved line is drilled once per round', () => {
  const byId = new Map(lines.map((l) => [l.id, l]));
  let s = createSession(lines, seq(0.1, 0.9, 0.5));
  const seen = [];
  while (!s.done) {
    seen.push(currentId(s));
    s = playLine(s, byId);
  }
  assert.deepEqual([...seen].sort(), ['open', 'sicilian', 'smith']);
  assert.ok(summary(s, lines).every((r) => r.mistakes === 0 && r.attempts === 1));
});

test('opponent moves follow the target line, not the most common branch', () => {
  let s = { ...createSession([openGame]) };
  s = submitMove(s, openGame, 'e2e4', lines).session;
  assert.ok(isOppTurn(s, 'white'));
  s = advanceOpp(s);
  assert.equal(openGame.path[s.ply - 1], 'e7e5');
});

test("another line's move from the same position is not a mistake", () => {
  let s = createSession([sicilian, smith], seq(0));
  const line = [sicilian, smith].find((l) => l.id === currentId(s));
  const other = line === sicilian ? smith : sicilian;
  s = submitMove(s, line, 'e2e4', lines).session;
  s = advanceOpp(s);
  const r = submitMove(s, line, other.path[2], lines);
  assert.equal(r.result, 'alt');
  assert.equal(r.session.lineMistakes, 0);
});

test('a wrong move counts and the line comes back once at the end of the round', () => {
  let s = createSession([sicilian, openGame], seq(0));
  const first = currentId(s);
  const line = first === 'sicilian' ? sicilian : openGame;
  const r = submitMove(s, line, 'd2d4', lines);
  assert.equal(r.result, 'wrong');
  s = r.session;
  const byId = new Map(lines.map((l) => [l.id, l]));
  s = playLine(s, byId); // finishes the first line with 1 mistake
  assert.equal(s.queue.length, 3);
  assert.equal(s.queue[2], first);
  s = playLine(s, byId);
  assert.equal(currentId(s), first);
  assert.ok(isRetry(s));
  s = playLine(s, byId);
  assert.ok(s.done);
  const sum = summary(s, lines);
  assert.equal(sum.find((x) => x.line.id === first).mistakes, 1);
  assert.equal(sum.find((x) => x.line.id === first).attempts, 2);
});

test('single line and playing Black', () => {
  const black = L('b', 'e2e4 c7c5 g1f3 d7d6');
  let s = createSession([black]);
  assert.equal(currentId(s), 'b');
  assert.ok(isOppTurn(s, 'black'));
  s = advanceOpp(s);
  assert.ok(!isOppTurn(s, 'black'));
  assert.equal(expectedMove(s, black), 'c7c5');
  assert.equal(createSession([]).done, true);
});
