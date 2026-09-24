// Drill cards (port of DrillCardCompiler.swift and DrillCardIdentity.swift): one
// card per position where the repertoire side is to move, keyed by a content hash
// so progress survives edits, re-imports and move-order changes.
import { POLICY, childrenOf, movesTo, rootOf, sideToMoveAfter } from './movetree.js';
import { sha256Hex } from './sha256.js';

export const COMPILER = { maxDepthPly: 40, maxAlternatives: 4 };

export const cardIdentity = (slug, chapterKey, promptKey, primaryUci) => sha256Hex(`${slug}|${chapterKey}|${promptKey}|${primaryUci}`);

/**
 * Compiles a chapter's cards. Each: {id, promptKey, promptFen, primaryNode,
 * acceptedNodes, expectedUci, expectedSan, lineUci, depth, coach}.
 */
export function compileCards(tree, { side, slug, chapterKey }, opts = COMPILER) {
  const cards = [];
  const stack = [tree.rootId];
  while (stack.length) {
    const node = tree.nodes.get(stack.pop());
    if (!node || node.policy === POLICY.never) continue;
    stack.push(...node.children.slice().reverse());
    const card = cardAt(tree, node, side, slug, chapterKey, opts);
    if (card) cards.push(card);
  }
  return mergeTranspositions(cards, opts.maxAlternatives);
}

function cardAt(tree, node, side, slug, chapterKey, opts) {
  if (sideToMoveAfter(node) !== side) return null;
  // alwaysDrill lifts the depth limit for the positions an author insists on.
  const forced = node.policy === POLICY.always || childrenOf(tree, node.id).some((c) => c.policy === POLICY.always);
  if (node.ply >= opts.maxDepthPly && !forced) return null;
  if (!node.key) return null;
  const candidates = childrenOf(tree, node.id)
    .filter((c) => c.policy !== POLICY.never)
    .slice(0, opts.maxAlternatives);
  if (!candidates.length) return null;
  const primary = candidates[0];
  return {
    id: cardIdentity(slug, chapterKey, node.key, primary.uci),
    promptKey: node.key,
    promptFen: node.fen,
    primaryNode: primary.id,
    acceptedNodes: candidates.map((c) => c.id),
    expectedUci: candidates.map((c) => c.uci),
    expectedSan: candidates.map((c) => c.san),
    lineUci: movesTo(tree, node.id),
    depth: node.ply,
    coach: primary.coach || node.coach || null,
  };
}

function mergeTranspositions(cards, maxAlt) {
  const order = [];
  const groups = new Map();
  for (const c of cards) {
    if (!groups.has(c.promptKey)) {
      order.push(c.promptKey);
      groups.set(c.promptKey, []);
    }
    groups.get(c.promptKey).push(c);
  }
  return order.map((key) => {
    const group = groups.get(key);
    if (group.length === 1) return group[0];
    const canonical = group.reduce((best, c) => (c.lineUci.length < best.lineUci.length ? c : best), group[0]);
    const uci = canonical.expectedUci.slice();
    const san = canonical.expectedSan.slice();
    const accepted = canonical.acceptedNodes.slice();
    for (const c of group) {
      if (c.id === canonical.id) continue;
      c.expectedUci.forEach((u, i) => {
        if (uci.includes(u)) return;
        uci.push(u);
        if (i < c.expectedSan.length) san.push(c.expectedSan[i]);
        if (i < c.acceptedNodes.length) accepted.push(c.acceptedNodes[i]);
      });
    }
    if (uci.length > maxAlt) return canonical;
    return { ...canonical, expectedUci: uci, expectedSan: san, acceptedNodes: accepted };
  });
}

/** A fresh SRS state for a new card. */
export const newSrsState = () => ({
  phase: 'new',
  step: 0,
  ease: 2.5,
  interval: 0,
  reps: 0,
  lapses: 0,
  due: 0,
  lastReviewed: null,
  suspended: false,
});

/**
 * Diffs freshly compiled cards against the stored ones for a study. Surviving
 * identities keep their scheduling, new ones are inserted, and orphans are
 * suspended rather than deleted so a bad import cannot wipe out progress.
 * compiled: [{card, chapterId, order}]. Returns {put: StoredCard[], report}.
 */
export function recompile(existing, compiled, studyId) {
  const byId = new Map(compiled.map((e) => [e.card.id, e]));
  const put = [];
  const report = { inserted: 0, updated: 0, changedAnswers: 0, suspendedOrphans: 0 };
  for (const old of existing) {
    const match = byId.get(old.id);
    if (!match) {
      if (!old.srs.suspended || !old.orphan) {
        put.push({ ...old, orphan: true, srs: { ...old.srs, suspended: true } });
        if (!old.srs.suspended) report.suspendedOrphans += 1;
      }
      continue;
    }
    byId.delete(old.id);
    const changed = old.expectedUci.join() !== match.card.expectedUci.join();
    if (changed) report.changedAnswers += 1;
    const wasOrphan = !!old.orphan;
    put.push({
      ...old,
      ...derived(match, studyId),
      contentChanged: old.contentChanged || changed,
      orphan: false,
      // An orphan coming back is live again; a leech stays suspended.
      srs: wasOrphan ? { ...old.srs, suspended: false } : old.srs,
    });
    report.updated += 1;
  }
  for (const e of byId.values()) {
    put.push({ id: e.card.id, ...derived(e, studyId), contentChanged: false, orphan: false, srs: newSrsState() });
    report.inserted += 1;
  }
  return { put, report };
}

function derived({ card, chapterId, order }, studyId) {
  return {
    study: studyId,
    chapter: chapterId,
    chapterOrder: order,
    promptKey: card.promptKey,
    promptFen: card.promptFen,
    expectedUci: card.expectedUci,
    expectedSan: card.expectedSan,
    lineUci: card.lineUci,
    depth: card.depth,
    coach: card.coach,
  };
}

export { rootOf };
