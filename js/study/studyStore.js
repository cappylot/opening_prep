// The study library (port of StudyStore.swift and BundledContentSeeder.swift).
// Everything is small enough to hold in memory: the store loads IndexedDB once,
// serves synchronous snapshots to the UI and writes every change through
// atomically. Subscribers are told after each write.
import { getAllOf, writeMany } from '../store.js';
import { createTree, decodeTree, encodeTree, mergeTree, moveCount, searchLine, newId } from './movetree.js';
import { compileCards, recompile, newSrsState } from './cards.js';
import { parsePgn, studyMetaFromChapters, studyPgn } from './pgn.js';
import { makePlan } from './plan.js';
import { schedule, recordDaily, srsSettings, todayCounters, buildQueue } from './srs.js';
import { coverSeed } from './metrics.js';
import { fnv1a64 } from './sha256.js';

export const BUNDLED = ['caro-kann-black', 'ruy-lopez-white'];

const state = {
  ready: false,
  studies: new Map(),
  chapters: new Map(),
  cards: new Map(),
  reviews: [],
  bookmarks: new Map(),
  app: { id: 'app' },
  version: 0,
};
const trees = new Map();
const listeners = new Set();
let initPromise = null;

export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
function changed() {
  state.version += 1;
  for (const fn of listeners) fn(state.version);
}

export const lib = () => state;
export const hex8 = () => newId().replace(/-/g, '').slice(0, 8).toLowerCase();

// ---------------------------------------------------------------- loading

export function initStudies({ fetchText = defaultFetch, seed = true } = {}) {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const [studies, chapters, cards, reviews, bookmarks, app] = await Promise.all(
      ['studies', 'chapters', 'cards', 'reviews', 'bookmarks', 'appState'].map(getAllOf),
    );
    for (const s of studies) state.studies.set(s.id, s);
    for (const c of chapters) state.chapters.set(c.id, c);
    for (const c of cards) state.cards.set(c.id, c);
    state.reviews = reviews.sort((a, b) => a.t - b.t);
    for (const b of bookmarks) state.bookmarks.set(b.card, b);
    state.app = app.find((a) => a.id === 'app') || { id: 'app' };
    state.ready = true;
    if (seed) await seedBundled({ fetchText }).catch((e) => console.warn('seed', e));
    changed();
  })();
  return initPromise;
}

async function defaultFetch(name) {
  const res = await fetch(new URL(`../../content/${name}.pgn`, import.meta.url));
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.text();
}

/** Installs curated studies whose file changed since last seeded (replace, not merge). */
export async function seedBundled({ fetchText = defaultFetch, force = false, only = null } = {}) {
  const seeded = { ...(state.app.seeded || {}) };
  let installed = 0;
  for (const name of only ? [only] : BUNDLED) {
    let text;
    try {
      text = await fetchText(name);
    } catch (e) {
      console.warn('bundled', name, e);
      continue;
    }
    const d = describePgn(text, name);
    if (!d) continue;
    if (!force && seeded[d.meta.slug] === d.hash) continue;
    await importStudy(
      { ...d.meta, source: { kind: 'bundled', version: d.hash }, chapters: d.chapters.map((c, i) => draftChapter(c, d.meta.slug, i)) },
      'replace',
    );
    seeded[d.meta.slug] = d.hash;
    await setApp({ seeded });
    installed += 1;
  }
  return installed;
}

/** A bundled file's metadata, chapters and content hash, or null if it will not parse. */
export function describePgn(text, name) {
  try {
    const chapters = parsePgn(text);
    return { meta: studyMetaFromChapters(chapters, name), chapters, hash: fnv1a64(text), name };
  } catch {
    return null;
  }
}

export const draftChapter = (parsed, slug, index) => ({
  title: parsed.title,
  key: `${slug}-ch${index}`,
  order: index,
  tree: parsed.tree,
  preamble: parsed.preamble,
});

// ---------------------------------------------------------------- reads

export const isCurated = (study) => study?.source?.kind === 'bundled';

export function studyBySlug(slug) {
  for (const s of state.studies.values()) if (s.slug === slug) return s;
  return null;
}

export const chaptersOf = (studyId) =>
  [...state.chapters.values()].filter((c) => c.study === studyId).sort((a, b) => a.order - b.order || String(a.key).localeCompare(String(b.key)));

export const cardsOf = (studyId) => [...state.cards.values()].filter((c) => c.study === studyId && !c.orphan);
export const cardsOfChapter = (chapterId) => [...state.cards.values()].filter((c) => c.chapter === chapterId && !c.orphan);
export const liveCards = () => [...state.cards.values()].filter((c) => !c.orphan);

/** The decoded tree of a chapter (cached until the chapter is written). */
export function treeOf(chapterId) {
  if (trees.has(chapterId)) return trees.get(chapterId);
  const ch = state.chapters.get(chapterId);
  if (!ch) return null;
  let tree;
  try {
    tree = decodeTree(ch.tree);
  } catch (e) {
    console.warn('chapter', chapterId, e);
    tree = createTree(ch.startFen);
  }
  trees.set(chapterId, tree);
  return tree;
}

export const srsOf = () => srsSettings(state.app.srs);
export const counters = (now = Date.now()) => todayCounters(state.app, now, srsOf().rolloverHour);

/** Cards that would appear in today's queue (the due badge). */
export function dueToday(studyId = null, now = Date.now()) {
  const c = counters(now);
  return buildQueue(liveCards(), {
    now,
    newToday: c.newToday,
    reviewsToday: c.reviewsToday,
    settings: srsOf(),
    studies: studyId ? new Set([studyId]) : null,
  }).length;
}

// ---------------------------------------------------------------- writes

function chapterRecord(base, tree) {
  return {
    ...base,
    startFen: tree.rootFen,
    tree: encodeTree(tree),
    searchLine: searchLine(tree),
    nodeCount: moveCount(tree),
    updated: Date.now(),
  };
}

async function commit(ops) {
  const ok = await writeMany(ops);
  changed();
  return ok;
}

/**
 * Creates or updates a study from a draft {slug, title, summary, eco, side, source,
 * chapters: [{title, key, order, tree, preamble}]}. policy 'merge' grafts new moves
 * onto existing chapters; 'replace' swaps them (curated updates).
 */
export async function importStudy(draft, policy = 'merge') {
  const existing = studyBySlug(draft.slug);
  const now = Date.now();
  const study = existing
    ? { ...existing, title: draft.title, summary: draft.summary ?? null, eco: draft.eco ?? null, side: draft.side, source: draft.source, updated: now }
    : {
        id: newId(),
        slug: draft.slug,
        title: draft.title,
        summary: draft.summary ?? null,
        eco: draft.eco ?? null,
        side: draft.side,
        source: draft.source,
        created: now,
        updated: now,
        lastOpened: null,
        pinned: false,
        archived: false,
        coverSeed: coverSeed(draft.slug),
      };
  state.studies.set(study.id, study);
  const chapterPuts = [];
  const current = chaptersOf(study.id);
  for (const d of draft.chapters) {
    const old = current.find((c) => c.key === d.key);
    let tree = d.tree;
    if (old) {
      const mine = treeOf(old.id);
      if (policy === 'merge' && mine && mine.rootFen === d.tree.rootFen && mine.nodes.size > 1) tree = mergeTree(mine, d.tree);
      const rec = chapterRecord({ ...old, title: d.title, order: d.order, preamble: d.preamble ?? old.preamble ?? null }, tree);
      chapterPuts.push(rec);
    } else {
      chapterPuts.push(chapterRecord({ id: newId(), study: study.id, title: d.title, key: d.key, order: d.order, preamble: d.preamble ?? null }, tree));
    }
  }
  for (const c of chapterPuts) {
    state.chapters.set(c.id, c);
    trees.delete(c.id);
  }
  const cardOps = recompileOps(study.id);
  await commit({ studies: { put: [study] }, chapters: { put: chapterPuts }, cards: cardOps });
  return study.id;
}

/** Rebuilds a study's cards in memory and returns the write for them. */
function recompileOps(studyId) {
  const study = state.studies.get(studyId);
  const compiled = [];
  for (const ch of chaptersOf(studyId)) {
    const tree = treeOf(ch.id);
    if (!tree) continue;
    for (const card of compileCards(tree, { side: study.side, slug: study.slug, chapterKey: ch.key })) {
      compiled.push({ card, chapterId: ch.id, order: ch.order });
    }
  }
  // Later chapters would overwrite earlier ones for a shared identity; keep the first.
  const seen = new Set();
  const unique = compiled.filter((e) => !seen.has(e.card.id) && seen.add(e.card.id));
  const existing = [...state.cards.values()].filter((c) => c.study === studyId);
  const { put } = recompile(existing, unique, studyId);
  for (const c of put) state.cards.set(c.id, c);
  return { put };
}

export async function updateChapter(id, { title, preamble, tree } = {}) {
  const ch = state.chapters.get(id);
  if (!ch) return;
  let rec = { ...ch };
  if (title) rec.title = title;
  if (preamble !== undefined) rec.preamble = preamble || null;
  if (tree) {
    rec = chapterRecord(rec, tree);
    trees.set(id, tree);
  }
  state.chapters.set(id, rec);
  const study = { ...state.studies.get(ch.study), updated: Date.now() };
  state.studies.set(study.id, study);
  const ops = { chapters: { put: [rec] }, studies: { put: [study] } };
  if (tree) ops.cards = recompileOps(ch.study);
  await commit(ops);
}

export async function updateStudy(id, patch) {
  const old = state.studies.get(id);
  if (!old) return;
  const study = { ...old, ...patch, updated: Date.now() };
  for (const k of ['summary', 'eco']) if (study[k] === '') study[k] = null;
  state.studies.set(id, study);
  const ops = { studies: { put: [study] } };
  // Side decides which positions are questions at all.
  if (patch.side && patch.side !== old.side) ops.cards = recompileOps(id);
  await commit(ops);
}

/** Pin / archive / last opened: no updated-at bump. */
export async function markStudy(id, patch) {
  const old = state.studies.get(id);
  if (!old) return;
  const study = { ...old, ...patch };
  state.studies.set(id, study);
  await commit({ studies: { put: [study] } });
}

export async function addChapter(studyId, title, startFen) {
  const study = state.studies.get(studyId);
  const order = Math.max(-1, ...chaptersOf(studyId).map((c) => c.order)) + 1;
  // A random suffix: a reused index would inherit a deleted chapter's cards.
  const rec = chapterRecord({ id: newId(), study: studyId, title, key: `${study.slug}-ch${hex8()}`, order, preamble: null }, createTree(startFen));
  state.chapters.set(rec.id, rec);
  await commit({ chapters: { put: [rec] } });
  return rec.id;
}

export async function deleteChapter(id) {
  const ch = state.chapters.get(id);
  if (!ch) return;
  state.chapters.delete(id);
  trees.delete(id);
  await commit({ chapters: { del: [id] }, cards: recompileOps(ch.study) });
}

export async function reorderChapters(studyId, ids) {
  const puts = [];
  ids.forEach((id, order) => {
    const ch = state.chapters.get(id);
    if (ch && ch.order !== order) {
      const rec = { ...ch, order };
      state.chapters.set(id, rec);
      puts.push(rec);
    }
  });
  await commit({ chapters: { put: puts }, cards: recompileOps(studyId) });
}

export async function deleteStudy(id) {
  const chapterIds = chaptersOf(id).map((c) => c.id);
  const cardIds = [...state.cards.values()].filter((c) => c.study === id).map((c) => c.id);
  const reviewIds = state.reviews.filter((r) => r.study === id).map((r) => r.id);
  state.studies.delete(id);
  for (const c of chapterIds) {
    state.chapters.delete(c);
    trees.delete(c);
  }
  for (const c of cardIds) {
    state.cards.delete(c);
    state.bookmarks.delete(c);
  }
  state.reviews = state.reviews.filter((r) => r.study !== id);
  await commit({ studies: { del: [id] }, chapters: { del: chapterIds }, cards: { del: cardIds }, reviews: { del: reviewIds }, bookmarks: { del: cardIds } });
}

/** Clears scheduling, keeping content. Orphan suspension is a fact about content and survives. */
export async function resetProgress(studyId = null) {
  const cards = [...state.cards.values()].filter((c) => !studyId || c.study === studyId);
  const puts = cards.map((c) => ({ ...c, contentChanged: false, srs: { ...newSrsState(), suspended: !!c.orphan } }));
  for (const c of puts) state.cards.set(c.id, c);
  const gone = state.reviews.filter((r) => !studyId || r.study === studyId);
  state.reviews = state.reviews.filter((r) => studyId && r.study !== studyId);
  await commit({ cards: { put: puts }, reviews: { del: gone.map((r) => r.id) } });
}

export async function setApp(patch) {
  state.app = { ...state.app, ...patch, id: 'app' };
  await commit({ appState: { put: [state.app] } });
}

/** Records one graded answer: card schedule, review log and daily counters in one write. */
export async function commitReview({ card: cardId, grade, elapsed, played, at }) {
  const card = state.cards.get(cardId);
  if (!card) return;
  if (state.reviews.some((r) => r.card === cardId && r.t === at)) return;
  const settings = srsOf();
  const before = card.srs;
  const after = schedule(before, grade, at, Math.random(), settings);
  const next = { ...card, srs: after, contentChanged: false };
  state.cards.set(cardId, next);
  const log = {
    id: `${at}-${cardId.slice(0, 12)}`,
    card: cardId,
    study: card.study,
    t: at,
    grade,
    elapsedMs: Math.round(elapsed * 1000),
    prevInterval: before.interval,
    newInterval: after.interval,
    easeAfter: after.ease,
    played: played || null,
  };
  state.reviews.push(log);
  state.app = recordDaily(state.app, before.phase, at, settings.rolloverHour);
  await commit({ cards: { put: [next] }, reviews: { put: [log] }, appState: { put: [state.app] } });
}

export async function toggleBookmark(cardId, info = {}) {
  if (state.bookmarks.has(cardId)) {
    state.bookmarks.delete(cardId);
    await commit({ bookmarks: { del: [cardId] } });
    return false;
  }
  const b = { card: cardId, t: Date.now(), ...info };
  state.bookmarks.set(cardId, b);
  await commit({ bookmarks: { put: [b] } });
  return true;
}

// ---------------------------------------------------------------- drills and export

export function planFor(request, now = Date.now()) {
  const chapters = [...state.chapters.values()].map((c) => ({ ...c, tree: null }));
  const needed = new Set();
  const cards = liveCards();
  if (request.kind === 'chapter') needed.add(request.chapter);
  else {
    const studyIds = request.kind === 'study' ? new Set([request.study]) : new Set(request.ids.map((id) => state.cards.get(id)?.study));
    for (const c of chapters) if (studyIds.has(c.study)) needed.add(c.id);
  }
  for (const c of chapters) if (needed.has(c.id)) c.tree = treeOf(c.id);
  const c = counters(now);
  return makePlan(request, { studies: state.studies, chapters, cards, app: c, settings: srsOf(), now });
}

export function exportStudyPgn(studyId) {
  const s = state.studies.get(studyId);
  return studyPgn(
    s,
    chaptersOf(studyId).map((c) => ({ tree: treeOf(c.id), title: c.title, preamble: c.preamble, order: c.order })),
  );
}

export function exportChapterPgn(chapterId) {
  const ch = state.chapters.get(chapterId);
  const s = state.studies.get(ch.study);
  return studyPgn({ ...s }, [{ tree: treeOf(chapterId), title: ch.title, preamble: ch.preamble, order: 0 }]);
}

/** Test hook: forget everything in memory. */
export function _resetForTests() {
  state.studies.clear();
  state.chapters.clear();
  state.cards.clear();
  state.reviews = [];
  state.bookmarks.clear();
  state.app = { id: 'app' };
  trees.clear();
  initPromise = null;
}
