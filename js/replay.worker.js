// Replays raw Lichess games off the main thread.
import { replayGame } from './tree.js';

self.onmessage = (e) => {
  const { id, userId, games } = e.data;
  const out = [];
  for (const g of games) {
    const r = replayGame(g, userId);
    if (r) out.push(r);
  }
  self.postMessage({ id, games: out });
};
