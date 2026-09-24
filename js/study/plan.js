// Drill planning (port of DrillLineBuilder.swift and StudyStore.makePlan): a
// session plays whole lines, root to leaf, that contain at least one target card.
import { POLICY, childrenOf, leafLines, rootOf } from './movetree.js';
import { buildQueue } from './srs.js';

export const STUDY_TOP_UP = 20;
export const PROMPT_BUDGET = 2000;

/** Every line of a chapter with the repertoire side's moves marked as prompts. */
export function chapterLines(tree, side, { maxLines = 300, maxPly = 80 } = {}) {
  const root = rootOf(tree);
  if (!root || root.policy === POLICY.never) return [];
  const drillable = (id) => childrenOf(tree, id).filter((c) => c.policy !== POLICY.never);
  const out = [];
  for (const path of leafLines(tree, { maxLines, maxPly, skipNever: true })) {
    const prompts = [];
    path.forEach((node, index) => {
      if (node.side !== side) return;
      const parent = index === 0 ? root : path[index - 1];
      const alts = drillable(parent.id).filter((c) => c.id !== node.id);
      prompts.push({
        ply: index,
        promptFen: parent.fen,
        promptKey: parent.key,
        answerUci: node.uci,
        answerSan: node.san,
        altUci: alts.map((a) => a.uci),
        altSan: alts.map((a) => a.san),
        coach: node.coach || parent.coach || null,
        whyNot: { ...(parent.coach?.whyNot || {}), ...(node.coach?.whyNot || {}) },
        idea: node.coach?.idea || parent.coach?.idea || null,
      });
    });
    if (prompts.length) out.push({ movesUci: path.map((n) => n.uci), movesSan: path.map((n) => n.san), prompts });
  }
  return out;
}

/**
 * Builds a drill plan.
 * request: {kind:'study', study} | {kind:'chapter', chapter} | {kind:'cards', ids}
 * data: {studies: Map, chapters: [{id, study, order, key, title, tree}], cards: [stored card], app, settings, now}
 * Returns {lines: [...]} or null when there is nothing to drill.
 */
export function makePlan(request, { studies, chapters, cards, app = {}, settings, now = Date.now() }) {
  let targets;
  if (request.kind === 'cards') {
    const byId = new Map(cards.map((c) => [c.id, c]));
    targets = request.ids.map((id) => byId.get(id)).filter(Boolean);
  } else if (request.kind === 'chapter') {
    targets = cards.filter((c) => c.chapter === request.chapter && !c.srs.suspended);
  } else {
    targets = studyTargets(request.study, cards, app, settings, now);
  }
  if (!targets.length) return null;
  const targetIds = new Set(targets.map((c) => c.id));

  // Studies by first appearance among targets; chapters in book order.
  const studyRank = new Map();
  for (const c of targets) if (!studyRank.has(c.study)) studyRank.set(c.study, studyRank.size);
  const wanted = new Set(targets.map((c) => c.chapter));
  const ctx = [];
  for (const [studyId, rank] of studyRank) {
    const ordered = chapters
      .filter((ch) => ch.study === studyId)
      .sort((a, b) => a.order - b.order || String(a.key).localeCompare(String(b.key)));
    ordered.forEach((ch, chapterRank) => {
      if (wanted.has(ch.id)) ctx.push({ ch, study: studies.get(studyId), rank, chapterRank });
    });
  }
  ctx.sort((a, b) => a.rank - b.rank || a.chapterRank - b.chapterRank);

  // Cards by chapter and prompt position; ties broken on identity.
  const index = new Map();
  for (const c of cards) {
    if (!wanted.has(c.chapter)) continue;
    if (!index.has(c.chapter)) index.set(c.chapter, new Map());
    const m = index.get(c.chapter);
    const prev = m.get(c.promptKey);
    if (!prev || c.id < prev.id) m.set(c.promptKey, c);
  }

  const lines = [];
  let prompts = 0;
  outer: for (const { ch, study } of ctx) {
    if (!study || !ch.tree) continue;
    const byPos = index.get(ch.id) || new Map();
    for (const line of chapterLines(ch.tree, study.side)) {
      const built = line.prompts.map((p) => {
        const card = byPos.get(p.promptKey);
        const graded = card && card.expectedUci.includes(p.answerUci) ? { card: card.id, phase: card.srs.phase } : null;
        return { ...p, grading: graded };
      });
      if (!built.some((p) => p.grading && targetIds.has(p.grading.card))) continue;
      lines.push({
        study: study.id,
        studyTitle: study.title,
        side: study.side,
        coverSeed: study.coverSeed,
        chapter: ch.id,
        chapterTitle: ch.title,
        startFen: ch.tree.rootFen,
        movesUci: line.movesUci,
        movesSan: line.movesSan,
        prompts: built,
      });
      prompts += built.length;
      if (prompts >= PROMPT_BUDGET) break outer;
    }
  }
  return lines.length ? { lines } : null;
}

/** Due cards first in queue order, topped up shallowest-first to STUDY_TOP_UP. */
function studyTargets(studyId, cards, app, settings, now) {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const queue = buildQueue(cards, {
    now,
    newToday: app.newToday || 0,
    reviewsToday: app.reviewsToday || 0,
    settings,
    studies: new Set([studyId]),
  });
  const selected = queue.map((id) => byId.get(id)).filter(Boolean);
  if (selected.length < STUDY_TOP_UP) {
    const chosen = new Set(selected.map((c) => c.id));
    const filler = cards
      .filter((c) => c.study === studyId && !c.srs.suspended && !chosen.has(c.id))
      .sort((a, b) => a.depth - b.depth || a.chapterOrder - b.chapterOrder);
    selected.push(...filler.slice(0, STUDY_TOP_UP - selected.length));
  }
  return selected;
}

export const promptCount = (plan) => plan.lines.reduce((n, l) => n + l.prompts.length, 0);
