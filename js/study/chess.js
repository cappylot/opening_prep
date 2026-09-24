// Thin rules helpers over chess.js for the study modules: UCI in, UCI out.
import { Chess } from '../../vendor/chess.js/chess.js';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** A Chess instance for `fen`, or null when the FEN will not load. */
export function load(fen = START_FEN) {
  try {
    return new Chess(fen);
  } catch {
    return null;
  }
}

export const isUci = (s) => typeof s === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(s);

/** Plays `uci` on `chess`. Returns the chess.js move, or null (board untouched) when illegal. */
export function playUci(chess, uci) {
  if (!isUci(uci)) return null;
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null;
  }
}

/** The SAN of `uci` in `fen`, or null when it is not legal there. */
export function sanOf(fen, uci) {
  const chess = load(fen);
  return chess ? playUci(chess, uci)?.san ?? null : null;
}

/** Plays SAN (tolerating a few common spellings) and returns the move, or null. */
export function playSan(chess, san) {
  const tries = [san, san.replace(/0/g, 'O'), san.replace(/[+#]+$/, '')];
  for (const t of tries) {
    try {
      const m = chess.move(t, { strict: false });
      if (m) return m;
    } catch {
      /* try the next spelling */
    }
  }
  return null;
}

export const uciOf = (m) => m.from + m.to + (m.promotion || '');

export const turnOf = (fen) => (fen.split(' ')[1] === 'b' ? 'black' : 'white');

export const opposite = (side) => (side === 'white' ? 'black' : 'white');

/** Legal destinations for chessground. */
export function destsOf(chess) {
  const dests = new Map();
  for (const m of chess.moves({ verbose: true })) {
    if (!dests.has(m.from)) dests.set(m.from, []);
    dests.get(m.from).push(m.to);
  }
  return dests;
}
