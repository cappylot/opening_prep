// Canonical, transposition-safe identity for a position (port of PositionKey.swift):
// placement, side to move, castling in KQkq order, and an en-passant square only
// when an en-passant capture is actually legal.
import { load } from './chess.js';

export function positionKey(fen) {
  const [placement, turn = 'w', castling = '-', ep = '-'] = fen.trim().split(/\s+/);
  const normCastling = castling === '-' ? '-' : 'KQkq'.split('').filter((c) => castling.includes(c)).join('') || '-';
  return `${placement} ${turn} ${normCastling} ${legalEp(placement, turn, castling, ep)}`;
}

function legalEp(placement, turn, castling, ep) {
  if (!/^[a-h][36]$/.test(ep)) return '-';
  const rank = ep[1];
  // The target must sit behind a pawn that just made a double step.
  if ((turn === 'w' && rank !== '6') || (turn === 'b' && rank !== '3')) return '-';
  const chess = load(`${placement} ${turn} ${castling} ${ep} 0 1`);
  if (!chess) return '-';
  return chess.moves({ verbose: true }).some((m) => m.flags.includes('e') && m.to === ep) ? ep : '-';
}
