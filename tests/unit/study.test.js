import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePgn, studyMetaFromChapters, studyPgn, extractCommands, encodeCommands, splitSuffix, tokenize } from '../../js/study/pgn.js';
import {
  createTree,
  insertChild,
  mainline,
  searchLine,
  encodeTree,
  decodeTree,
  mergeTree,
  promoteToMainline,
  removeSubtree,
  subtreeCount,
  rootOf,
  childrenOf,
  POLICY,
  nodeAtPath,
} from '../../js/study/movetree.js';
import { compileCards, recompile, cardIdentity } from '../../js/study/cards.js';
import { chapterLines, makePlan } from '../../js/study/plan.js';
import { coverSeed, accuracySeries, searchStudies, pushRecent } from '../../js/study/metrics.js';

const read = (f) => readFileSync(new URL(`../../content/${f}.pgn`, import.meta.url), 'utf8');
const corpus = JSON.parse(readFileSync(new URL('../fixtures/DrillCardIdentityCorpus.json', import.meta.url), 'utf8'));

function compileFile(f) {
  const chapters = parsePgn(read(f));
  const meta = studyMetaFromChapters(chapters, f);
  const cards = chapters.flatMap((c, i) => compileCards(c.tree, { side: meta.side, slug: meta.slug, chapterKey: `${meta.slug}-ch${i}` }).map((card) => ({ card, i })));
  return { chapters, meta, cards };
}

test('bundled PGNs parse with study tags, chapters and annotations', () => {
  const { chapters, meta } = compileFile('caro-kann-black');
  assert.equal(meta.slug, 'caro-kann-black');
  assert.equal(meta.side, 'black');
  assert.equal(meta.eco, 'B10-B19');
  assert.deepEqual(
    chapters.map((c) => c.title),
    ['Classical Caro-Kann', 'Advance Variation', 'Exchange and Sidelines'],
  );
  assert.match(chapters[0].preamble, /^The Caro-Kann challenges/);
  const bf5 = nodeAtPath(chapters[0].tree, ['e2e4', 'c7c6', 'd2d4', 'd7d5', 'b1c3', 'd5e4', 'c3e4', 'c8f5']);
  assert.equal(bf5.san, 'Bf5');
  assert.deepEqual(bf5.coach.arrows, [{ from: 'f5', to: 'h7', style: 'tertiary' }]);
  assert.deepEqual(bf5.coach.marks, [{ square: 'e4', style: 'tertiary' }]);
  assert.match(bf5.comment, /^The whole point/);
});

test('card identities match the iOS corpus exactly', () => {
  const got = [...compileFile('caro-kann-black').cards, ...compileFile('ruy-lopez-white').cards].map((x) => x.card.id).sort();
  assert.deepEqual(got, corpus.map((c) => c.hash).sort());
});

test('PGN round-trips through the writer, arrows and variations included', () => {
  for (const f of ['caro-kann-black', 'ruy-lopez-white']) {
    const { chapters, meta, cards } = compileFile(f);
    const out = studyPgn(meta, chapters.map((c, i) => ({ tree: c.tree, title: c.title, preamble: c.preamble, order: i })));
    const again = parsePgn(out);
    assert.deepEqual(studyMetaFromChapters(again, 'x'), meta);
    const re = again.flatMap((c, i) => compileCards(c.tree, { side: meta.side, slug: meta.slug, chapterKey: `${meta.slug}-ch${i}` }));
    assert.deepEqual(re.map((c) => c.id).sort(), cards.map((x) => x.card.id).sort());
    assert.ok(out.split('\n').every((l) => l.length <= 80 || l.startsWith('[')));
  }
});

test('lexer: suffixes become NAGs, castling with zeros, comments flow', () => {
  assert.deepEqual(splitSuffix('Nf3!?'), { san: 'Nf3', nags: [5] });
  assert.deepEqual(splitSuffix('e4!'), { san: 'e4', nags: [1] });
  const kinds = tokenize('1. e4 {a\n  b} 1... e5 $1 (1... c5) 0-0 1-0').map((t) => t.kind);
  assert.deepEqual(kinds, ['number', 'san', 'comment', 'number', 'san', 'nag', 'begin', 'number', 'san', 'end', 'san', 'result']);
  const [ch] = parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. 0-0 *');
  assert.equal(mainline(ch.tree).at(-1).san, 'O-O');
});

test('a bad move truncates only its variation; on the mainline it stops the chapter', () => {
  const [ch] = parsePgn('1. e4 e5 (1... Qxh7 2. d4) 2. Nf3 Zz9 3. Bc4 *');
  assert.equal(searchLine(ch.tree), 'e4 e5 Nf3');
  assert.equal(ch.diagnostics.length, 2);
  assert.deepEqual(
    ch.diagnostics.map((d) => d.severity),
    ['warning', 'error'],
  );
});

test('side inference and FEN setup', () => {
  const [ch] = parsePgn('[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"]\n\n1... c5 (1... e5) (1... c6) 2. Nf3 *');
  assert.equal(rootOf(ch.tree).side, 'black');
  assert.equal(ch.side, 'white');
  assert.match(studyPgn({ slug: 's', title: 't', side: 'white' }, [{ tree: ch.tree, title: 'x', order: 0 }]), /1\.\.\. c5 \(1\.\.\. e5\)/);
});

test('annotation commands decode and encode', () => {
  const x = extractCommands('[%cal Ge2e4,Rd1h5,e7e5] Fight [%csl Ye4,d5] for it');
  assert.equal(x.text, 'Fight for it');
  assert.deepEqual(x.arrows.map((a) => a.style), ['tertiary', 'annotation', 'annotation']);
  assert.deepEqual(x.marks, [
    { square: 'e4', style: 'secondary' },
    { square: 'd5', style: 'tertiary' },
  ]);
  assert.equal(encodeCommands(x.arrows, x.marks), '[%cal Ge2e4,Rd1h5,Re7e5] [%csl Ye4,Gd5]');
  assert.equal(extractCommands('[%cal Ge2e4]').text, null);
});

test('move tree: dedupe, promote, delete, codec and merge keep ids', () => {
  const t = createTree();
  const e4 = insertChild(t, t.rootId, 'e2e4');
  assert.equal(insertChild(t, t.rootId, 'e2e4'), e4);
  const d4 = insertChild(t, t.rootId, 'd2d4');
  const e5 = insertChild(t, e4, 'e7e5');
  assert.equal(insertChild(t, e5, 'e1e3'), null);
  assert.equal(t.nodes.get(d4).main, false);
  promoteToMainline(t, d4);
  assert.equal(mainline(t)[0].san, 'd4');
  assert.equal(t.nodes.get(e5).main, false);
  const back = decodeTree(JSON.parse(JSON.stringify(encodeTree(t))));
  assert.deepEqual([...back.nodes.keys()].sort(), [...t.nodes.keys()].sort());
  assert.equal(back.nodes.get(e5).san, 'e5');

  const other = createTree();
  const oe4 = insertChild(other, other.rootId, 'e2e4');
  other.nodes.get(oe4).comment = 'King pawn';
  insertChild(other, oe4, 'c7c5');
  mergeTree(back, other);
  assert.equal(back.nodes.get(e4).comment, 'King pawn');
  assert.deepEqual(
    childrenOf(back, e4).map((c) => c.san),
    ['e5', 'c5'],
  );
  assert.equal(subtreeCount(back, e4), 3);
  removeSubtree(back, e4);
  assert.equal(back.nodes.size, 2);
});

test('never-drill removes a subtree from cards and lines; recompile keeps progress', () => {
  const [ch] = parsePgn('1. e4 e5 2. Nf3 (2. Bc4 Nf6 3. d3) 2... Nc6 3. Bb5 *');
  const opts = { side: 'white', slug: 's', chapterKey: 's-ch0' };
  const cards = compileCards(ch.tree, opts);
  assert.deepEqual(
    cards.map((c) => c.expectedSan.join('/')),
    ['e4', 'Nf3/Bc4', 'Bb5', 'd3'],
  );
  assert.equal(chapterLines(ch.tree, 'white').length, 2);

  const compiled = cards.map((card) => ({ card, chapterId: 'c', order: 0 }));
  const first = recompile([], compiled, 'S');
  assert.equal(first.report.inserted, 4);
  const stored = first.put.map((c) => (c.expectedSan[0] === 'e4' ? { ...c, srs: { ...c.srs, phase: 'review', interval: 9 } } : c));

  nodeAtPath(ch.tree, ['e2e4', 'e7e5', 'f1c4']).policy = POLICY.never;
  const again = compileCards(ch.tree, opts).map((card) => ({ card, chapterId: 'c', order: 0 }));
  const second = recompile(stored, again, 'S');
  assert.equal(second.report.suspendedOrphans, 1);
  assert.equal(second.report.changedAnswers, 1);
  assert.equal(second.put.find((c) => c.expectedSan[0] === 'e4').srs.interval, 9);
  assert.equal(chapterLines(ch.tree, 'white').length, 1);
});

test('transpositions within a chapter share one card', () => {
  const [ch] = parsePgn('1. d4 Nf6 (1... e6 2. c4 Nf6 3. Nf3) 2. c4 e6 (2... g6) 3. Nc3 *');
  const cards = compileCards(ch.tree, { side: 'white', slug: 's', chapterKey: 'k' });
  const after = cards.find((c) => c.expectedUci.includes('b1c3'));
  assert.deepEqual(after.expectedSan, ['Nc3', 'Nf3']);
  assert.equal(after.id, cardIdentity('s', 'k', after.promptKey, 'b1c3'));
});

test('plans play whole lines containing a target, mainline first', () => {
  const { chapters, meta } = compileFile('ruy-lopez-white');
  const study = { id: 'S', slug: meta.slug, title: meta.title, side: meta.side, coverSeed: coverSeed(meta.slug) };
  const chs = chapters.map((c, i) => ({ id: `c${i}`, study: 'S', order: i, key: `${meta.slug}-ch${i}`, title: c.title, tree: c.tree }));
  const cards = chs.flatMap((ch, i) => recompile([], compileCards(ch.tree, { side: 'white', slug: meta.slug, chapterKey: ch.key }).map((card) => ({ card, chapterId: ch.id, order: i })), 'S').put);
  const all = chapters.reduce((n, c) => n + chapterLines(c.tree, 'white').length, 0);
  assert.equal(all, 13);

  const plan = makePlan({ kind: 'chapter', chapter: 'c1' }, { studies: new Map([['S', study]]), chapters: chs, cards });
  assert.ok(plan.lines.every((l) => l.chapter === 'c1'));
  assert.equal(plan.lines[0].movesSan.join(' '), mainline(chs[1].tree).map((n) => n.san).join(' '));

  const deep = cards.sort((a, b) => b.depth - a.depth)[0];
  const one = makePlan({ kind: 'cards', ids: [deep.id] }, { studies: new Map([['S', study]]), chapters: chs, cards });
  assert.ok(one.lines.length >= 1);
  assert.ok(one.lines.every((l) => l.prompts.some((p) => p.grading?.card === deep.id)));

  const studyPlan = makePlan({ kind: 'study', study: 'S' }, { studies: new Map([['S', study]]), chapters: chs, cards, now: Date.now() });
  assert.ok(studyPlan.lines.length > 0);
});

test('cover seed, accuracy series, search and recents', () => {
  assert.ok(coverSeed('caro-kann-black') >= 0 && coverSeed('caro-kann-black') < 1024);
  const now = new Date(2026, 5, 10, 12).getTime();
  const series = accuracySeries(
    [
      { t: now, grade: 'good' },
      { t: now, grade: 'again' },
      { t: now - 86400000, grade: 'easy' },
    ],
    { now, days: 7 },
  );
  assert.equal(series.length, 7);
  assert.equal(series.at(-1).rate, 0.5);
  assert.equal(series.at(-2).rate, 1);
  const studies = [{ id: 'a', title: 'The Caro-Kann', eco: 'B10', side: 'black' }];
  const chapters = [{ id: 'x', study: 'a', title: 'Advance', searchLine: 'e4 c6 d4 d5 e5' }];
  assert.equal(searchStudies('caro', studies, chapters).studies.length, 1);
  assert.equal(searchStudies('e4 c6 d4', studies, chapters).chapters.length, 1);
  assert.equal(searchStudies('black rep', studies, chapters).studies.length, 1);
  assert.deepEqual(pushRecent(['a1', 'Caro'], 'caro'), ['caro', 'a1']);
  assert.equal(pushRecent([], 'x').length, 0);
});
