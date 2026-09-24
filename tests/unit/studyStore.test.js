import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as S from '../../js/study/studyStore.js';
import { parsePgn } from '../../js/study/pgn.js';
import { insertChild, nodeAtPath, cloneTree } from '../../js/study/movetree.js';

// No IndexedDB under Node: the store runs purely in memory, which is what we test.
const fetchText = async (name) => readFileSync(new URL(`../../content/${name}.pgn`, import.meta.url), 'utf8');
const origWarn = console.warn;

test('seeding installs curated studies once, with cards', async () => {
  console.warn = () => {};
  S._resetForTests();
  await S.initStudies({ fetchText });
  const lib = S.lib();
  assert.equal(lib.studies.size, 2);
  const caro = S.studyBySlug('caro-kann-black');
  assert.ok(S.isCurated(caro));
  assert.equal(S.chaptersOf(caro.id).length, 3);
  const cards = S.cardsOf(caro.id);
  assert.ok(cards.length > 10);
  assert.equal(await S.seedBundled({ fetchText }), 0);
  assert.equal(await S.seedBundled({ fetchText, force: true }), 2);
  assert.deepEqual(
    S.cardsOf(caro.id)
      .map((c) => c.id)
      .sort(),
    cards.map((c) => c.id).sort(),
  );
  console.warn = origWarn;
});

test('reviews schedule cards, count the day and survive a chapter edit', async () => {
  console.warn = () => {};
  const caro = S.studyBySlug('caro-kann-black');
  const plan = S.planFor({ kind: 'study', study: caro.id });
  assert.ok(plan.lines.length > 0);
  const prompt = plan.lines[0].prompts.find((p) => p.grading);
  const at = Date.now();
  await S.commitReview({ card: prompt.grading.card, grade: 'good', elapsed: 2, played: prompt.answerUci, at });
  await S.commitReview({ card: prompt.grading.card, grade: 'good', elapsed: 2, played: prompt.answerUci, at });
  assert.equal(S.lib().reviews.length, 1);
  assert.equal(S.lib().cards.get(prompt.grading.card).srs.phase, 'learning');
  assert.equal(S.counters(at).newToday, 1);
  assert.equal(S.counters(at).streak, 1);

  const ch = S.chaptersOf(caro.id)[0];
  const tree = cloneTree(S.treeOf(ch.id));
  insertChild(tree, nodeAtPath(tree, ['e2e4']).id, 'e7e5');
  await S.updateChapter(ch.id, { tree });
  assert.equal(S.lib().cards.get(prompt.grading.card).srs.phase, 'learning');

  await S.resetProgress(caro.id);
  assert.equal(S.lib().cards.get(prompt.grading.card).srs.phase, 'new');
  assert.equal(S.lib().reviews.length, 0);
  console.warn = origWarn;
});

test('user studies: import merges, chapters add/reorder/delete, side flip recompiles', async () => {
  console.warn = () => {};
  const chapters = parsePgn('[Event "Main"]\n\n1. e4 e5 2. Nf3 *');
  const id = await S.importStudy({ slug: 'import-test', title: 'Mine', side: 'white', source: { kind: 'pgn' }, chapters: chapters.map((c, i) => S.draftChapter(c, 'import-test', i)) });
  const before = S.cardsOf(id).length;
  const more = parsePgn('[Event "Main"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 *');
  await S.importStudy({ slug: 'import-test', title: 'Mine', side: 'white', source: { kind: 'pgn' }, chapters: more.map((c, i) => S.draftChapter(c, 'import-test', i)) });
  assert.equal(S.cardsOf(id).length, before + 1);
  const second = await S.addChapter(id, 'Chapter 2');
  assert.equal(S.chaptersOf(id).length, 2);
  await S.reorderChapters(id, [second, S.chaptersOf(id)[0].id]);
  assert.equal(S.chaptersOf(id)[0].id, second);
  await S.updateStudy(id, { side: 'black' });
  assert.ok(S.cardsOf(id).every((c) => c.srs.phase === 'new'));
  assert.ok(S.cardsOf(id).length > 0);
  assert.match(S.exportStudyPgn(id), /\[StudySide "black"\]/);
  await S.deleteChapter(second);
  assert.equal(S.chaptersOf(id).length, 1);
  const bm = await S.toggleBookmark(S.cardsOf(id)[0].id);
  assert.equal(bm, true);
  await S.deleteStudy(id);
  assert.equal(S.lib().studies.has(id), false);
  assert.equal(S.lib().bookmarks.size, 0);
  console.warn = origWarn;
});
