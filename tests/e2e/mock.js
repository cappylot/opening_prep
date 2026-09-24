// Generates a realistic-looking game history for a fake opponent "MockOpp".
import { Chess } from '../../vendor/chess.js/chess.js';

// [weight, moves, opening, P(opp wins), P(draw)]
const AS_BLACK = [
  [30, 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5', ['B90', 'Sicilian Defense: Najdorf Variation', 10], 0.55, 0.15],
  [10, 'e4 c5 Nf3 d6 Bb5+ Bd7 Bxd7+ Qxd7 O-O Nc6', ['B52', 'Sicilian Defense: Canal Attack', 5], 0.25, 0.2],
  [8, 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6', ['B34', 'Sicilian Defense: Accelerated Dragon', 7], 0.5, 0.1],
  [7, 'e4 c5 c3 Nf6 e5 Nd5 d4 cxd4', ['B22', 'Sicilian Defense: Alapin Variation', 3], 0.35, 0.2],
  [10, 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5', ['C58', 'Italian Game: Two Knights Defense', 6], 0.45, 0.1],
  [6, 'e4 e6 d4 d5 e5 c5 c3 Nc6', ['C02', 'French Defense: Advance Variation', 5], 0.4, 0.2],
  [14, 'd4 Nf6 c4 e6 Nc3 Bb4 e3 O-O', ['E40', 'Nimzo-Indian Defense: Normal Variation', 6], 0.5, 0.25],
  [6, 'd4 Nf6 Bf4 d5 e3 c5', ['D00', 'Queen\'s Pawn Game: Accelerated London System', 3], 0.6, 0.1],
  [5, 'Nf3 Nf6 g3 d5 Bg2 c6', ['A05', 'Zukertort Opening', 2], 0.5, 0.3],
  [4, 'c4 e5 Nc3 Nf6 g3 d5', ['A22', 'English Opening: King\'s English Variation', 4], 0.5, 0.2],
];
const AS_WHITE = [
  [25, 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7', ['C88', 'Ruy Lopez: Closed', 9], 0.55, 0.2],
  [8, 'e4 e5 Nf3 Nf6 Nxe5 d6 Nf3 Nxe4', ['C42', 'Petrov\'s Defense', 3], 0.4, 0.35],
  [18, 'e4 c5 c3 Nf6 e5 Nd5 d4 cxd4', ['B22', 'Sicilian Defense: Alapin Variation', 3], 0.6, 0.15],
  [8, 'e4 c5 c3 d5 exd5 Qxd5 d4 Nf6', ['B22', 'Sicilian Defense: Alapin Variation, Barmen Defense', 4], 0.3, 0.2],
  [10, 'e4 e6 d4 d5 Nc3 Bb4 e5 c5', ['C15', 'French Defense: Winawer Variation', 6], 0.35, 0.15],
  [8, 'e4 c6 d4 d5 e5 Bf5 Nf3 e6', ['B12', 'Caro-Kann Defense: Advance Variation', 5], 0.5, 0.25],
  [5, 'e4 d5 exd5 Qxd5 Nc3 Qa5', ['B01', 'Scandinavian Defense: Main Line', 6], 0.7, 0.1],
  [6, 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7', ['D53', 'Queen\'s Gambit Declined', 7], 0.45, 0.3],
];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function pick(list, r) {
  const total = list.reduce((a, x) => a + x[0], 0);
  let v = r() * total;
  for (const x of list) if ((v -= x[0]) <= 0) return x;
  return list[list.length - 1];
}

export function mockGames(n = 260, seed = 7) {
  const r = rng(seed);
  const speeds = ['blitz', 'blitz', 'blitz', 'rapid', 'rapid', 'bullet', 'classical'];
  const now = Date.UTC(2026, 8, 23);
  const out = [];
  for (let i = 0; i < n; i++) {
    const oppWhite = r() < 0.5;
    const [, moves, [eco, name, ply], pWin, pDraw] = pick(oppWhite ? AS_WHITE : AS_BLACK, r);
    // occasionally truncate so trees get leaves at different depths
    const sans = moves.split(' ');
    const chess = new Chess();
    for (const s of sans) chess.move(s);
    const roll = r();
    const oppWon = roll < pWin;
    const draw = !oppWon && roll < pWin + pDraw;
    const oppColor = oppWhite ? 'white' : 'black';
    const winner = draw ? undefined : oppWon ? oppColor : oppWhite ? 'black' : 'white';
    const opp = { user: { name: 'MockOpp', id: 'mockopp' }, rating: 1850 + Math.round(r() * 60) };
    const other = { user: { name: `Player${Math.floor(r() * 90) + 10}`, id: '' }, rating: 1700 + Math.round(r() * 300) };
    other.user.id = other.user.name.toLowerCase();
    if (i % 37 === 5) (other.user.name = 'MeMyself'), (other.user.id = 'memyself');
    const speed = speeds[Math.floor(r() * speeds.length)];
    out.push({
      id: `mk${String(i).padStart(6, '0')}`,
      rated: r() > 0.1,
      variant: 'standard',
      speed,
      perf: speed,
      createdAt: now - i * 864e5 * 0.9 - Math.floor(r() * 5e6),
      lastMoveAt: now - i * 864e5 * 0.9,
      status: draw ? 'draw' : 'resign',
      players: oppWhite ? { white: opp, black: other } : { white: other, black: opp },
      ...(winner ? { winner } : {}),
      opening: { eco, name, ply },
      moves: sans.join(' '),
    });
  }
  return out;
}

export const mockUser = {
  id: 'mockopp',
  username: 'MockOpp',
  title: 'FM',
  perfs: {
    bullet: { games: 400, rating: 1920, rd: 60, prog: 5 },
    blitz: { games: 1500, rating: 1880, rd: 50, prog: 12 },
    rapid: { games: 300, rating: 1950, rd: 70, prog: -4 },
    classical: { games: 40, rating: 2010, rd: 90, prog: 0, prov: true },
  },
  count: { all: 2240, rated: 2100 },
  createdAt: Date.UTC(2019, 2, 1),
  seenAt: Date.UTC(2026, 8, 23),
  profile: { flag: 'NL' },
};
