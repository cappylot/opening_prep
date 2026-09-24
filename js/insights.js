// Prep insights computed from an opening tree (see tree.js). Pure functions.
import { Chess } from '../vendor/chess.js/chess.js';
import { fenKey, rankedMoves, smoothScore, pathTo, playPath } from './tree.js';

const WEAK = 0.42;
const STRONG = 0.6;

/** Overall result and opening statistics for the games in a tree. */
export function summary(tree) {
  const games = tree.games;
  const res = { n: games.length, win: 0, draw: 0, loss: 0 };
  const families = new Map();
  for (const g of games) {
    if (g.res === 1) res.win++;
    else if (g.res === 0.5) res.draw++;
    else res.loss++;
    const name = g.opening?.name || 'Unknown';
    const family = name.split(':')[0];
    let f = families.get(family);
    if (!f) families.set(family, (f = { name: family, eco: g.opening?.eco || '', n: 0, win: 0, draw: 0, variations: new Map() }));
    f.n++;
    if (g.res === 1) f.win++;
    else if (g.res === 0.5) f.draw++;
    const v = name.includes(':') ? name.split(':')[1].trim() : '';
    if (v) f.variations.set(v, (f.variations.get(v) || 0) + 1);
  }
  res.score = res.n ? (res.win + 0.5 * res.draw) / res.n : 0;
  const openings = [...families.values()]
    .map((f) => ({
      name: f.name,
      eco: f.eco,
      n: f.n,
      share: f.n / (res.n || 1),
      score: (f.win + 0.5 * f.draw) / f.n,
      topVariation: [...f.variations.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '',
    }))
    .sort((a, b) => b.n - a.n);
  return { ...res, openings };
}

/**
 * How predictable the opponent is: average share of their most played move
 * over their first `moves` decisions along the main line.
 */
export function predictability(tree, oppColor, moves = 6) {
  const chess = new Chess();
  const shares = [];
  for (let ply = 0; ply < moves * 2 + 1 && shares.length < moves; ply++) {
    const node = tree.nodes.get(fenKey(chess.fen()));
    const ranked = rankedMoves(node);
    if (!ranked.length || node.n < 3) break;
    const oppTurn = (chess.turn() === 'w') === (oppColor === 'white');
    if (oppTurn) shares.push(ranked[0].freq);
    chess.move(ranked[0].san);
  }
  return shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : null;
}

/** The opponent's replies to each of the first moves they face (or their own first moves as White). */
export function firstMoves(tree, oppColor) {
  const chess = new Chess();
  const root = tree.nodes.get(fenKey(chess.fen()));
  if (oppColor === 'white') return [{ san: null, n: root?.n || 0, replies: rankedMoves(root) }];
  return rankedMoves(root).map((m) => {
    chess.move(m.san);
    const node = tree.nodes.get(fenKey(chess.fen()));
    chess.undo();
    return { san: m.san, uci: m.uci, n: m.n, replies: rankedMoves(node) };
  });
}

/**
 * Positions where the opponent scores badly (weak) or well (strong).
 * Each entry has the path to reach it so the board can jump there.
 */
export function spots(tree, { minN = 4, limit = 8 } = {}) {
  const weak = [];
  const strong = [];
  for (const [key, node] of tree.nodes) {
    if (node.reach < minN || !node.src) continue;
    const path = pathTo(node);
    if (path.length < 2) continue;
    const score = smoothScore(node.rWin, node.rDraw, node.reachW);
    const entry = { key, path, n: node.reach, score, raw: (node.rWin + 0.5 * node.rDraw) / node.reachW };
    if (score < WEAK) weak.push(entry);
    else if (score > STRONG) strong.push(entry);
  }
  const rank = (arr, dir) =>
    dedupe(arr.sort((a, b) => dir * (b.score - 0.5) * Math.sqrt(b.n) - dir * (a.score - 0.5) * Math.sqrt(a.n))).slice(0, limit);
  return {
    weak: rank(weak, -1).map(withSans),
    strong: rank(strong, 1).map(withSans),
  };
}

// Drop a spot when a shorter spot already covers (nearly) the same games.
function dedupe(list) {
  const out = [];
  for (const s of list) {
    const covered = out.some((o) => isPrefix(o.path, s.path) && s.n >= o.n * 0.7);
    if (!covered) out.push(s);
  }
  return out;
}

function isPrefix(a, b) {
  return a.length <= b.length && a.every((x, i) => x === b[i]);
}

function withSans(s) {
  return { ...s, sans: playPath(s.path).sans };
}

/**
 * Suggested prep lines from a starting path. On the opponent's turn we follow
 * their likely replies; on our turn we pick the move they score worst against.
 */
export function suggestLines(tree, oppColor, opts = {}) {
  const { start = [], maxPly = 16, minN = 3, branchP = 0.2, oppBranch = 2, myBranchFirst = 3, limit = 5, minProb = 0.03 } = opts;
  const { chess, path: startPath } = playPath(start);
  const results = [];
  const path = [...startPath];
  const oppLetter = oppColor === 'white' ? 'w' : 'b';
  let myDecisions = 0;
  let steps = 0;

  const finish = (prob, node) => {
    if (path.length <= startPath.length || !node) return;
    const score = smoothScore(node.rWin, node.rDraw, node.reachW);
    results.push({ path: [...path], prob, n: node.reach, score, raw: node.reachW ? (node.rWin + 0.5 * node.rDraw) / node.reachW : 0.5 });
  };

  const walk = (prob) => {
    if (++steps > 5000) return;
    const node = tree.nodes.get(fenKey(chess.fen()));
    const ranked = rankedMoves(node).filter((m) => m.n >= 1);
    if (!node || node.n < minN || path.length >= maxPly || prob < minProb || !ranked.length) {
      finish(prob, node);
      return;
    }
    let cands;
    let oppTurn = chess.turn() === oppLetter;
    if (oppTurn) {
      cands = ranked.filter((m) => m.freq >= branchP && m.n >= minN).slice(0, oppBranch);
      if (!cands.length) cands = [ranked[0]];
    } else {
      const solid = ranked.filter((m) => m.n >= minN).sort((a, b) => a.score - b.score);
      const width = myDecisions === 0 ? myBranchFirst : 1;
      cands = solid.length ? solid.slice(0, width) : [ranked[0]];
      myDecisions++;
    }
    for (const m of cands) {
      chess.move(m.san);
      path.push(m.uci);
      walk(oppTurn ? prob * m.freq : prob);
      path.pop();
      chess.undo();
    }
    if (!oppTurn) myDecisions--;
  };
  walk(1);

  const seen = new Set();
  return results
    .filter((r) => {
      const k = r.path.join(' ');
      if (seen.has(k)) return false;
      seen.add(k);
      return r.n >= minN;
    })
    .map((r) => ({ ...r, value: r.prob * (0.5 - r.score), sans: playPath(r.path).sans }))
    .sort((a, b) => b.value - a.value || b.prob - a.prob)
    .slice(0, limit);
}

/** Head-to-head record against a given username among the loaded games. */
export function headToHead(games, myId) {
  if (!myId) return null;
  const id = myId.toLowerCase();
  const vs = games.filter((g) => g.vsId === id);
  if (!vs.length) return { n: 0, win: 0, draw: 0, loss: 0, games: [] };
  // results from *my* point of view
  const r = { n: vs.length, win: 0, draw: 0, loss: 0, games: vs.slice().sort((a, b) => b.t - a.t) };
  for (const g of vs) {
    if (g.res === 0) r.win++;
    else if (g.res === 0.5) r.draw++;
    else r.loss++;
  }
  return r;
}
