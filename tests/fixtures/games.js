// Small synthetic set of Lichess NDJSON games for "Opp".
let n = 0;
export function game(moves, { oppColor = 'white', winner = null, speed = 'blitz', rated = true, daysAgo = 1, opening = null, vs = 'rival', status } = {}) {
  n++;
  const opp = { user: { name: 'Opp', id: 'opp' }, rating: 1800 };
  const other = { user: { name: vs, id: vs.toLowerCase() }, rating: 1750 };
  return {
    id: `g${String(n).padStart(7, '0')}`,
    rated,
    variant: 'standard',
    speed,
    perf: speed,
    createdAt: Date.UTC(2026, 8, 20) - daysAgo * 864e5,
    status: status || (winner ? 'resign' : 'draw'),
    players: oppColor === 'white' ? { white: opp, black: other } : { white: other, black: opp },
    ...(winner ? { winner } : {}),
    ...(opening ? { opening } : {}),
    moves,
  };
}

const sicilian = { eco: 'B50', name: 'Sicilian Defense: Modern Variations', ply: 3 };
const french = { eco: 'C00', name: 'French Defense', ply: 2 };

export const games = [
  // Opp as Black: plays the Sicilian 3 of 4 times against 1.e4
  game('e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6', { oppColor: 'black', winner: 'white', opening: sicilian }),
  game('e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6', { oppColor: 'black', winner: 'white', opening: sicilian }),
  game('e4 c5 Nf3 d6 Bb5+ Bd7', { oppColor: 'black', winner: 'black', opening: sicilian }),
  game('e4 e6 d4 d5', { oppColor: 'black', opening: french }),
  // Transposition: 1.Nf3 c5 2.e4 reaches the same position as 1.e4 c5 2.Nf3
  game('Nf3 c5 e4 d6', { oppColor: 'black', winner: 'black' }),
  // Opp as White
  game('e4 e5 Nf3 Nc6 Bc4', { oppColor: 'white', winner: 'white' }),
  game('e4 e5 Nf3 Nc6 Bc4', { oppColor: 'white', winner: 'white', speed: 'rapid' }),
  game('e4 c5 c3', { oppColor: 'white', winner: 'black', daysAgo: 400 }),
  // Unusable games
  game('e4', { oppColor: 'white', status: 'aborted' }),
  { ...game('e4 e5', { oppColor: 'white' }), variant: 'chess960' },
];
