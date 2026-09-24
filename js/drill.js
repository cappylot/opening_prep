// Drill sessions: every saved line is drilled once per round, in random
// order; lines finished with mistakes come back once at the end of the round.
// Pure functions returning new session objects (no DOM).

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createSession(lines, rng = Math.random) {
  const ids = lines.filter((l) => l.path?.length).map((l) => l.id);
  const queue = shuffle(ids, rng);
  return { queue, base: queue.length, index: 0, ply: 0, lineMistakes: 0, requeued: [], results: {}, done: queue.length === 0 };
}

export const currentId = (s) => (s.done ? null : s.queue[s.index]);

export const isRetry = (s) => s.index >= s.base;

/** The move the current line expects at the current ply, or null when it's finished. */
export const expectedMove = (s, line) => line.path[s.ply] ?? null;

export const lineComplete = (s, line) => s.ply >= line.path.length;

/** Is it the opponent's move at this ply? (Even plies are White's.) */
export function isOppTurn(s, myColor) {
  const toMove = s.ply % 2 === 0 ? 'white' : 'black';
  return toMove !== myColor;
}

/** Plays the opponent's move from the target line. */
export function advanceOpp(s) {
  return { ...s, ply: s.ply + 1 };
}

/**
 * Checks the player's move against the target line.
 *  'correct' – advances the line
 *  'alt'     – a different saved line's move from this same position (not a mistake)
 *  'wrong'   – counts as a mistake
 */
export function submitMove(s, line, uci, lines) {
  if (uci === expectedMove(s, line)) return { session: { ...s, ply: s.ply + 1 }, result: 'correct' };
  const prefix = line.path.slice(0, s.ply).join(',');
  const alt = lines.some((l) => l.id !== line.id && l.path[s.ply] === uci && l.path.slice(0, s.ply).join(',') === prefix);
  if (alt) return { session: s, result: 'alt' };
  return { session: { ...s, lineMistakes: s.lineMistakes + 1 }, result: 'wrong' };
}

/** Records the finished line and moves on to the next one. */
export function finishLine(s) {
  const id = currentId(s);
  if (!id) return s;
  const prev = s.results[id] || { mistakes: 0, attempts: 0 };
  const results = { ...s.results, [id]: { mistakes: prev.mistakes + s.lineMistakes, attempts: prev.attempts + 1, clean: s.lineMistakes === 0 } };
  let { queue, requeued } = s;
  if (s.lineMistakes > 0 && !requeued.includes(id)) {
    queue = [...queue, id];
    requeued = [...requeued, id];
  }
  const index = s.index + 1;
  return { ...s, queue, requeued, results, index, ply: 0, lineMistakes: 0, done: index >= queue.length };
}

/** Per-line outcome for the end-of-round summary, in the order lines were drilled. */
export function summary(s, lines) {
  const byId = new Map(lines.map((l) => [l.id, l]));
  return [...new Set(s.queue)]
    .filter((id) => byId.has(id))
    .map((id) => ({ line: byId.get(id), ...(s.results[id] || { mistakes: 0, attempts: 0 }) }));
}
