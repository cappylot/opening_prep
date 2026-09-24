import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePgn } from '../../js/study/pgn.js';
import { compileCards, recompile } from '../../js/study/cards.js';
import { makePlan } from '../../js/study/plan.js';
import { DrillSession } from '../../js/study/drillSession.js';

// A clock whose sleeps resolve on the next microtask, so a whole drill runs instantly.
const fastClock = () => {
  let t = 1_000_000;
  return { sleep: async (s) => void (t += s * 1000), now: () => t };
};
const settle = () => new Promise((r) => setTimeout(r, 0));
async function until(session, pred, tries = 200) {
  for (let i = 0; i < tries && !pred(session); i++) await settle();
  assert.ok(pred(session), `timed out in phase ${session.phase.kind}`);
}

function planFor(pgn, side) {
  const [ch] = parsePgn(pgn);
  const chapters = [{ id: 'c', study: 'S', order: 0, key: 'k', title: 'Ch', tree: ch.tree }];
  const cards = recompile([], compileCards(ch.tree, { side, slug: 's', chapterKey: 'k' }).map((card) => ({ card, chapterId: 'c', order: 0 })), 'S').put;
  const studies = new Map([['S', { id: 'S', title: 'Test', side, coverSeed: 1 }]]);
  return { plan: makePlan({ kind: 'chapter', chapter: 'c' }, { studies, chapters, cards }), cards };
}

const mv = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

test('plays a line as black: book moves auto-play, correct answers grade good', async () => {
  const { plan } = planFor('1. e4 c6 2. d4 d5 3. e5 Bf5 *', 'black');
  const commits = [];
  const s = new DrillSession(plan, { clock: fastClock(), commit: (c) => commits.push(c) });
  s.start();
  await until(s, (x) => x.phase.kind === 'awaitingMove');
  assert.equal(s.ply, 1);
  assert.equal(s.board.orientation, 'black');
  s.handle(mv('c7c6'));
  assert.equal(s.phase.result, 'correct');
  await until(s, (x) => x.phase.kind === 'awaitingMove' && x.ply === 3);
  s.handle(mv('d7d5'));
  await until(s, (x) => x.ply === 5 && x.phase.kind === 'awaitingMove');
  s.handle(mv('c8f5'));
  await until(s, (x) => x.phase.kind === 'lineComplete');
  assert.equal(s.continuation, 'finish');
  assert.equal(commits.length, 3);
  assert.ok(commits.every((c) => c.grade === 'good'));
  s.primary();
  assert.equal(s.phase.kind, 'finished');
  assert.equal(s.phase.summary.accuracy, 1);
  assert.equal(s.phase.summary.completed, true);
});

test('wrong move is not applied and grades the retry; alternatives are named free', async () => {
  const { plan } = planFor('1. e4 e5 2. Nf3 (2. Bc4) 2... Nc6 *', 'white');
  const commits = [];
  const s = new DrillSession(plan, { clock: fastClock(), commit: (c) => commits.push(c) });
  s.start();
  await until(s, (x) => x.phase.kind === 'awaitingMove');
  s.handle(mv('d2d4'));
  assert.equal(s.phase.result, 'wrong');
  assert.equal(s.phase.played, 'd4');
  assert.equal(s.ply, 0);
  assert.equal(s.board.flash, 'd2');
  s.handle(mv('e2e4'));
  assert.equal(s.phase.result, 'correct');
  await until(s, (x) => x.phase.kind === 'awaitingMove' && x.ply === 2);
  s.handle(mv('f1c4'));
  assert.equal(s.phase.kind, 'offLine');
  assert.equal(s.phase.played, 'Bc4');
  s.handle(mv('g1f3'));
  assert.equal(s.phase.result, 'correct');
  assert.deepEqual(
    commits.map((c) => c.grade),
    ['hard', 'good'],
  );
  assert.equal(s.correct, 1);
  assert.equal(s.answered, 2);
});

test('hint escalates, reveal requires playing the move, skip records nothing', async () => {
  const { plan } = planFor('1. d4 d5 2. c4 e6 3. Nc3 *', 'white');
  const commits = [];
  const s = new DrillSession(plan, { clock: fastClock(), commit: (c) => commits.push(c) });
  s.start();
  await until(s, (x) => x.phase.kind === 'awaitingMove');
  s.hint();
  assert.deepEqual(s.board.hint, ['d2']);
  s.hint();
  assert.deepEqual(s.board.arrows, [{ from: 'd2', to: 'd4', style: 'primary' }]);
  s.handle(mv('d2d4'));
  assert.equal(commits.at(-1).grade, 'hard');
  await until(s, (x) => x.phase.kind === 'awaitingMove' && x.ply === 2);
  s.reveal();
  assert.equal(s.phase.kind, 'teachBack');
  s.handle(mv('g1f3'));
  assert.equal(s.phase.kind, 'teachBack');
  s.handle(mv('c2c4'));
  assert.equal(s.phase.result, 'revealed');
  assert.equal(commits.at(-1).grade, 'again');
  await until(s, (x) => x.phase.kind === 'awaitingMove' && x.ply === 4);
  s.skip();
  assert.equal(commits.length, 2);
  await until(s, (x) => x.phase.kind === 'lineComplete');
});

test('a premove made during the reply is judged when the prompt arrives', async () => {
  const { plan } = planFor('1. e4 e5 2. Nf3 Nc6 3. Bb5 *', 'white');
  const commits = [];
  let release;
  const gate = new Promise((r) => (release = r));
  let t = 0;
  const clock = { now: () => t, sleep: async (sec) => ((t += sec * 1000), sec > 0.3 ? gate : undefined) };
  const s = new DrillSession(plan, { clock, commit: (c) => commits.push(c) });
  s.start();
  await until(s, (x) => x.phase.kind === 'awaitingMove');
  s.handle(mv('e2e4'));
  assert.equal(s.board.policy, 'premoving');
  s.handle(mv('g1f3'));
  assert.deepEqual(s.premove, { from: 'g1', to: 'f3' });
  release();
  await until(s, (x) => x.ply >= 3);
  assert.equal(s.correct, 2);
  assert.equal(commits.length, 2);
  assert.equal(commits[1].grade, 'good');
});

test('each card is graded once per session even when lines share a trunk', async () => {
  const { plan } = planFor('1. e4 e5 (1... c5 2. Nf3) 2. Nf3 *', 'white');
  const commits = [];
  const s = new DrillSession(plan, { clock: fastClock(), commit: (c) => commits.push(c) });
  s.start();
  assert.equal(plan.lines.length, 2);
  for (let line = 0; line < 2; line++) {
    for (;;) {
      await until(s, (x) => x.phase.kind === 'awaitingMove' || x.phase.kind === 'lineComplete');
      if (s.phase.kind === 'lineComplete') break;
      s.handle(mv(s.prompt.answerUci));
    }
    s.advance();
  }
  assert.equal(s.phase.kind, 'finished');
  assert.equal(new Set(commits.map((c) => c.card)).size, commits.length);
  assert.equal(commits.length, 3);
  assert.equal(s.answered, 4);
});

test('manual pacing waits for the button', async () => {
  const { plan } = planFor('1. e4 e5 2. Nf3 *', 'white');
  const s = new DrillSession(plan, { clock: fastClock(), manualPacing: () => true });
  s.start();
  await until(s, (x) => x.phase.kind === 'awaitingMove');
  s.handle(mv('e2e4'));
  assert.equal(s.continuation, 'nextMove');
  await until(s, (x) => x.ply === 2);
  await settle();
  assert.equal(s.phase.kind, 'feedback');
  s.primary();
  await until(s, (x) => x.phase.kind === 'awaitingMove');
});
