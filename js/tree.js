// Opening tree: replays an opponent's games and aggregates them per position.
// Pure functions only (no DOM), shared by the app, the worker and the tests.
import { Chess } from '../vendor/chess.js/chess.js';

export const MAX_PLY = 30;
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const START_KEY = fenKey(START_FEN);
const DAY = 864e5;
const PRIOR = 4; // pseudo-games at 50% used to smooth small samples
const KEEP_GAMES = 8; // recent games remembered per position

/** Position identity without move counters, so transpositions merge. */
export function fenKey(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

const SKIP_STATUS = new Set(['aborted', 'noStart', 'created', 'started', 'unknownFinish']);

/**
 * Turns a raw Lichess NDJSON game into a compact record seen from the
 * opponent's side. Returns null for games that can't be used.
 */
export function replayGame(g, userId, maxPly = MAX_PLY) {
  if (!g || (g.variant && g.variant !== 'standard') || g.initialFen) return null;
  if (SKIP_STATUS.has(g.status)) return null;
  const uid = userId.toLowerCase();
  const white = g.players?.white || {};
  const black = g.players?.black || {};
  const oppColor = white.user?.id === uid ? 'white' : black.user?.id === uid ? 'black' : null;
  if (!oppColor) return null;
  const sans = (g.moves || '').split(' ').filter(Boolean);
  if (!sans.length) return null;

  const chess = new Chess();
  const plies = [];
  for (const san of sans.slice(0, maxPly)) {
    const key = fenKey(chess.fen());
    let m;
    try {
      m = chess.move(san);
    } catch {
      break;
    }
    plies.push([key, m.from + m.to + (m.promotion || ''), m.san]);
  }
  const me = oppColor === 'white' ? white : black;
  const them = oppColor === 'white' ? black : white;
  return {
    id: g.id,
    oppColor,
    // result from the opponent's point of view: 1 win, 0.5 draw, 0 loss
    res: g.winner ? (g.winner === oppColor ? 1 : 0) : 0.5,
    t: g.createdAt || 0,
    speed: g.speed || g.perf || 'unknown',
    rated: !!g.rated,
    rating: me.rating || null,
    vs: them.user?.name || (them.aiLevel ? `Stockfish level ${them.aiLevel}` : 'Anonymous'),
    vsId: them.user?.id || null,
    vsRating: them.rating || null,
    opening: g.opening ? { eco: g.opening.eco, name: g.opening.name, ply: g.opening.ply } : null,
    len: sans.length,
    plies,
    endKey: fenKey(chess.fen()),
  };
}

/** Does a replayed game pass the client-side filters? */
export function passes(g, f = {}) {
  if (f.color && g.oppColor !== f.color) return false;
  if (f.speeds && f.speeds.length && !f.speeds.includes(g.speed)) return false;
  if (f.ratedOnly && !g.rated) return false;
  if (f.since && g.t < f.since) return false;
  return true;
}

function newNode() {
  return { n: 0, w: 0, win: 0, draw: 0, reach: 0, reachW: 0, rWin: 0, rDraw: 0, moves: new Map(), games: [], src: null };
}

/**
 * Aggregates games into Map<fenKey, Node>.
 *  node.n / node.w          games (and weight) that continued with a move from here
 *  node.reach / node.reachW games that reached this position at all
 *  node.moves               Map<uci, MoveStat>
 *  node.games               most recent games that reached it
 *  node.src                 [game, plyIndex] of the first (most recent) game to get here, used to rebuild a path
 */
export function buildTree(games, filters = {}, { halfLifeDays = 0, now = Date.now() } = {}) {
  const nodes = new Map();
  const openings = new Map();
  const used = [];
  const sorted = [...games].sort((a, b) => b.t - a.t);
  for (const g of sorted) {
    if (!passes(g, filters)) continue;
    used.push(g);
    const wt = halfLifeDays > 0 ? Math.pow(0.5, Math.max(0, now - g.t) / (halfLifeDays * DAY)) : 1;
    const win = g.res === 1 ? 1 : 0;
    const draw = g.res === 0.5 ? 1 : 0;
    const seen = new Set(); // a game can repeat a position; count it once
    const reachAt = (key, i) => {
      let node = nodes.get(key);
      if (!node) nodes.set(key, (node = newNode()));
      if (seen.has(key)) return node;
      seen.add(key);
      node.reach++;
      node.reachW += wt;
      node.rWin += win * wt;
      node.rDraw += draw * wt;
      if (node.games.length < KEEP_GAMES) node.games.push({ g, ply: i });
      if (!node.src) node.src = [g, i];
      return node;
    };
    for (let i = 0; i < g.plies.length; i++) {
      const [key, uci, san] = g.plies[i];
      const node = reachAt(key, i);
      node.n++;
      node.w += wt;
      node.win += win * wt;
      node.draw += draw * wt;
      let st = node.moves.get(uci);
      if (!st) node.moves.set(uci, (st = { uci, san, n: 0, w: 0, win: 0, draw: 0, loss: 0, last: 0 }));
      st.n++;
      st.w += wt;
      if (g.res === 1) st.win += wt;
      else if (g.res === 0.5) st.draw += wt;
      else st.loss += wt;
      if (g.t > st.last) st.last = g.t;
    }
    reachAt(g.endKey, g.plies.length);
    if (g.opening && g.opening.ply > 0 && g.opening.ply <= g.plies.length) {
      const key = g.opening.ply < g.plies.length ? g.plies[g.opening.ply][0] : g.endKey;
      if (!openings.has(key)) openings.set(key, { eco: g.opening.eco, name: g.opening.name });
    }
  }
  return { nodes, openings, games: used };
}

/** Opponent's score for a move/node, pulled towards 50% for small samples. */
export function smoothScore(win, draw, w, prior = PRIOR) {
  return (win + 0.5 * draw + 0.5 * prior) / (w + prior);
}

export function moveScore(st) {
  return smoothScore(st.win, st.draw, st.w);
}

export function rawScore(st) {
  return st.w ? (st.win + 0.5 * st.draw) / st.w : 0.5;
}

/** Moves of a node sorted by how often they're played, with frequency attached. */
export function rankedMoves(node) {
  if (!node) return [];
  const total = node.w || 1;
  return [...node.moves.values()]
    .map((st) => ({ ...st, freq: st.w / total, score: moveScore(st), raw: rawScore(st) }))
    .sort((a, b) => b.w - a.w || b.n - a.n);
}

/** UCI path from the start position to a node, taken from a game that reached it. */
export function pathTo(node) {
  if (!node?.src) return [];
  const [g, i] = node.src;
  return g.plies.slice(0, i).map((p) => p[1]);
}

/** Replays a UCI path. Returns the Chess instance and the SAN list; stops at the first illegal move. */
export function playPath(path) {
  const chess = new Chess();
  const sans = [];
  const valid = [];
  for (const uci of path) {
    try {
      const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
      sans.push(m.san);
      valid.push(m.from + m.to + (m.promotion || ''));
    } catch {
      break;
    }
  }
  return { chess, sans, path: valid };
}

/** Name of the deepest known opening along a path. */
export function openingAlong(tree, path) {
  const chess = new Chess();
  let found = tree.openings.get(fenKey(chess.fen())) || null;
  for (const uci of path) {
    try {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
    } catch {
      break;
    }
    const o = tree.openings.get(fenKey(chess.fen()));
    if (o) found = o;
  }
  return found;
}

/** "1. e4 c5 2. Nf3" style text for a SAN list, optionally starting at a later ply. */
export function formatLine(sans, startPly = 0) {
  let out = '';
  sans.forEach((san, i) => {
    const ply = startPly + i;
    if (ply % 2 === 0) out += `${ply / 2 + 1}. `;
    else if (i === 0) out += `${(ply + 1) / 2}... `;
    out += san + ' ';
  });
  return out.trim();
}
