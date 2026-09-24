// Variation tree for one chapter (port of MoveTree.swift, LineCursor.swift and
// ChapterTreeCodec.swift). Stored flat with id-referenced children; children[0]
// is always the mainline continuation.
//
// Only uci and the authored annotations are persisted. san, fen, key, ply, side
// and main are derived by hydrate() / insertChild() so stored data can never
// drift from the rules engine.
import { START_FEN, load, playUci, turnOf, uciOf } from './chess.js';
import { positionKey } from './positionKey.js';

export const POLICY = { auto: 0, always: 1, never: 2 };

let counter = 0;
export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  counter += 1;
  return `n${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * A coach note: { idea?, whyNot: {SAN: text}, marks: [{square, style}], arrows: [{from, to, style}] }.
 * style is one of primary (B), secondary (Y), tertiary (G) and annotation (R).
 */
export const emptyNote = () => ({ idea: null, whyNot: {}, marks: [], arrows: [] });

export const noteIsEmpty = (n) =>
  !n || (!n.idea && !Object.keys(n.whyNot || {}).length && !(n.marks || []).length && !(n.arrows || []).length);

/** One arrow per square pair, a later one replacing an earlier. */
export function mergeArrows(existing = [], incoming = []) {
  const out = existing.slice();
  for (const a of incoming) {
    const i = out.findIndex((x) => x.from === a.from && x.to === a.to);
    if (i >= 0) out[i] = a;
    else out.push(a);
  }
  return out;
}

/** One mark per square, a later one replacing an earlier. */
export function mergeMarks(existing = [], incoming = []) {
  const out = existing.slice();
  for (const m of incoming) {
    const i = out.findIndex((x) => x.square === m.square);
    if (i >= 0) out[i] = m;
    else out.push(m);
  }
  return out;
}

function makeNode(fields) {
  return {
    id: newId(),
    parent: null,
    uci: null,
    comment: null,
    nags: [],
    coach: null,
    policy: POLICY.auto,
    children: [],
    san: '',
    fen: '',
    key: null,
    ply: 0,
    side: 'white',
    main: true,
    ...fields,
  };
}

export function createTree(rootFen = START_FEN) {
  const ok = !!load(rootFen);
  const root = makeNode({
    fen: rootFen,
    key: ok ? positionKey(rootFen) : null,
    side: ok ? turnOf(rootFen) : 'white',
  });
  return { rootId: root.id, rootFen, nodes: new Map([[root.id, root]]) };
}

export const rootOf = (tree) => tree.nodes.get(tree.rootId);
export const nodeOf = (tree, id) => tree.nodes.get(id);
export const childrenOf = (tree, id) => (tree.nodes.get(id)?.children || []).map((c) => tree.nodes.get(c)).filter(Boolean);
export const childByUci = (tree, id, uci) => childrenOf(tree, id).find((c) => c.uci === uci);

/** Side to move in the position after `node`. */
export const sideToMoveAfter = (node) => (node.uci == null ? node.side : node.side === 'white' ? 'black' : 'white');

/** Root through id, inclusive. */
export function pathIds(tree, id) {
  const path = [];
  let cur = id;
  const seen = new Set();
  while (cur != null && tree.nodes.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    path.push(cur);
    cur = tree.nodes.get(cur).parent;
  }
  return path.reverse();
}

/** Moves from the root to id, excluding the root. */
export const movesTo = (tree, id) => pathIds(tree, id).slice(1).map((i) => tree.nodes.get(i).uci);

export function mainline(tree) {
  const line = [];
  let cur = rootOf(tree);
  const seen = new Set();
  while (cur?.children.length && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = tree.nodes.get(cur.children[0]);
    if (cur) line.push(cur);
  }
  return line;
}

/** First twelve SAN of the mainline, for search and chapter rows. */
export const searchLine = (tree) =>
  mainline(tree)
    .slice(0, 12)
    .map((n) => n.san)
    .join(' ');

/** Follows a UCI path from the root; returns the node reached (stops at the first miss). */
export function nodeAtPath(tree, ucis) {
  let cur = rootOf(tree);
  for (const u of ucis) {
    const next = childByUci(tree, cur.id, u);
    if (!next) break;
    cur = next;
  }
  return cur;
}

/**
 * Adds `uci` under parentId, or returns the existing child with that move. The
 * dedupe-by-UCI rule is what makes PGN import, re-import and board authoring converge.
 * Returns the child id, or null when the move is illegal.
 */
export function insertChild(tree, parentId, uci) {
  const parent = tree.nodes.get(parentId);
  if (!parent) return null;
  const existing = parent.children.find((c) => tree.nodes.get(c)?.uci === uci);
  if (existing) return existing;
  const chess = load(parent.fen);
  if (!chess) return null;
  const mover = chess.turn() === 'w' ? 'white' : 'black';
  const m = playUci(chess, uci);
  if (!m) return null;
  const fen = chess.fen();
  const node = makeNode({
    parent: parentId,
    uci: uciOf(m),
    san: m.san,
    fen,
    key: positionKey(fen),
    ply: parent.ply + 1,
    side: mover,
    main: parent.main && parent.children.length === 0,
  });
  parent.children.push(node.id);
  tree.nodes.set(node.id, node);
  return node.id;
}

export function subtreeCount(tree, id) {
  let count = 0;
  const stack = [id];
  while (stack.length) {
    const n = tree.nodes.get(stack.pop());
    if (!n) continue;
    count += 1;
    stack.push(...n.children);
  }
  return count;
}

export function removeSubtree(tree, id) {
  if (id === tree.rootId) return;
  const parent = tree.nodes.get(tree.nodes.get(id)?.parent);
  if (parent) parent.children = parent.children.filter((c) => c !== id);
  const stack = [id];
  while (stack.length) {
    const n = tree.nodes.get(stack.pop());
    if (!n) continue;
    tree.nodes.delete(n.id);
    stack.push(...n.children);
  }
  hydrate(tree);
}

/** Makes id the mainline continuation at every level from the root down. */
export function promoteToMainline(tree, id) {
  let cur = id;
  while (true) {
    const node = tree.nodes.get(cur);
    const parent = node && tree.nodes.get(node.parent);
    if (!parent) break;
    const i = parent.children.indexOf(cur);
    if (i > 0) {
      parent.children.splice(i, 1);
      parent.children.unshift(cur);
    }
    cur = parent.id;
  }
  hydrate(tree);
}

/**
 * Recomputes every derived field in one DFS. Throws when a stored move is illegal,
 * since everything below it would be measured from a position that never happened.
 */
export function hydrate(tree) {
  const root = tree.nodes.get(tree.rootId);
  if (!root) throw new Error('Tree has no root');
  if (!load(tree.rootFen)) throw new Error(`Invalid start position: ${tree.rootFen}`);
  Object.assign(root, {
    parent: null,
    uci: null,
    san: '',
    ply: 0,
    side: turnOf(tree.rootFen),
    fen: tree.rootFen,
    key: positionKey(tree.rootFen),
    main: true,
  });
  const stack = [root.id];
  while (stack.length) {
    const parent = tree.nodes.get(stack.pop());
    parent.children = parent.children.filter((c) => tree.nodes.has(c));
    parent.children.forEach((cid, index) => {
      const child = tree.nodes.get(cid);
      const chess = load(parent.fen);
      const mover = chess.turn() === 'w' ? 'white' : 'black';
      const m = playUci(chess, child.uci);
      if (!m) throw new Error(`Stored move ${child.uci} is not legal in ${parent.fen}`);
      const fen = chess.fen();
      Object.assign(child, {
        parent: parent.id,
        san: m.san,
        side: mover,
        fen,
        key: positionKey(fen),
        ply: parent.ply + 1,
        main: parent.main && index === 0,
      });
      stack.push(cid);
    });
  }
  return tree;
}

/**
 * Merges `incoming` into `tree`, matching nodes by move path. Existing nodes keep
 * their ids; authored content from incoming wins where present; new moves are grafted.
 */
export function mergeTree(tree, incoming) {
  if (incoming.rootFen !== tree.rootFen) throw new Error('Cannot merge trees with different starting positions');
  const rootIn = incoming.nodes.get(incoming.rootId);
  const rootMine = tree.nodes.get(tree.rootId);
  if (rootIn.coach) rootMine.coach = rootIn.coach;
  const queue = [[tree.rootId, incoming.rootId]];
  while (queue.length) {
    const [mine, theirs] = queue.pop();
    const theirNode = incoming.nodes.get(theirs);
    if (!theirNode) continue;
    for (const tcid of theirNode.children) {
      const tc = incoming.nodes.get(tcid);
      if (!tc?.uci) continue;
      const existing = childByUci(tree, mine, tc.uci);
      if (existing) {
        if (tc.comment != null) existing.comment = tc.comment;
        if (tc.coach) existing.coach = tc.coach;
        if (tc.nags.length) existing.nags = tc.nags.slice();
        queue.push([existing.id, tcid]);
      } else {
        graft(tree, incoming, tcid, mine);
      }
    }
  }
  return hydrate(tree);
}

function graft(tree, other, subtreeRoot, newParent) {
  const stack = [[subtreeRoot, newParent]];
  while (stack.length) {
    const [theirs, parent] = stack.pop();
    const src = other.nodes.get(theirs);
    if (!src) continue;
    // Fresh ids: a node copied across must never alias one already in this tree.
    const node = { ...src, id: tree.nodes.has(src.id) ? newId() : src.id, parent, children: [], nags: src.nags.slice() };
    tree.nodes.set(node.id, node);
    tree.nodes.get(parent).children.push(node.id);
    for (const c of src.children.slice().reverse()) stack.push([c, node.id]);
  }
}

export function cloneTree(tree) {
  const nodes = new Map();
  for (const [id, n] of tree.nodes) {
    nodes.set(id, { ...n, children: n.children.slice(), nags: n.nags.slice(), coach: n.coach ? cloneNote(n.coach) : null });
  }
  return { rootId: tree.rootId, rootFen: tree.rootFen, nodes };
}

export const cloneNote = (n) => ({
  idea: n.idea ?? null,
  whyNot: { ...(n.whyNot || {}) },
  marks: (n.marks || []).map((m) => ({ ...m })),
  arrows: (n.arrows || []).map((a) => ({ ...a })),
});

// ---------------------------------------------------------------- codec

export const CODEC_VERSION = 1;

/** Pre-order envelope {v, r, n:[{i,p,m,c,g,t,k}]}: array order is sibling order. */
export function encodeTree(tree) {
  const n = [];
  const stack = [tree.rootId];
  while (stack.length) {
    const node = tree.nodes.get(stack.pop());
    if (!node) continue;
    const s = { i: node.id };
    if (node.parent != null) s.p = node.parent;
    if (node.uci != null) s.m = node.uci;
    if (node.comment != null) s.c = node.comment;
    if (node.nags.length) s.g = node.nags;
    if (node.policy !== POLICY.auto) s.t = node.policy;
    if (node.coach && !noteIsEmpty(node.coach)) s.k = node.coach;
    n.push(s);
    for (const c of node.children.slice().reverse()) stack.push(c);
  }
  return { v: CODEC_VERSION, r: tree.rootFen, n };
}

export function decodeTree(env) {
  if (!env || env.v > CODEC_VERSION) throw new Error('This chapter was saved in a newer format');
  const rootStored = env.n.find((s) => s.p == null);
  if (!rootStored) throw new Error('The stored chapter has no starting position');
  const nodes = new Map();
  for (const s of env.n) {
    nodes.set(
      s.i,
      makeNode({
        id: s.i,
        parent: s.p ?? null,
        uci: s.m ?? null,
        comment: s.c ?? null,
        nags: s.g || [],
        policy: s.t ?? POLICY.auto,
        coach: s.k ? cloneNote(s.k) : null,
      }),
    );
  }
  for (const s of env.n) if (s.p != null) nodes.get(s.p)?.children.push(s.i);
  return hydrate({ rootId: rootStored.i, rootFen: env.r, nodes });
}

// ---------------------------------------------------------------- lines

/** Every root-to-leaf path, mainline first, as arrays of nodes (root excluded). */
export function leafLines(tree, { maxLines = 300, maxPly = 80, skipNever = false } = {}) {
  const lines = [];
  const stack = [[tree.rootId, 0]];
  while (stack.length && lines.length < maxLines) {
    const [id, depth] = stack.pop();
    let kids = depth < maxPly ? childrenOf(tree, id) : [];
    if (skipNever) kids = kids.filter((k) => k.policy !== POLICY.never);
    if (!kids.length) {
      if (id !== tree.rootId) lines.push(pathIds(tree, id).slice(1).map((i) => tree.nodes.get(i)));
      continue;
    }
    for (const k of kids.slice().reverse()) stack.push([k.id, depth + 1]);
  }
  return lines;
}

/** Total moves in the tree (excluding the root). */
export const moveCount = (tree) => Math.max(0, tree.nodes.size - 1);
