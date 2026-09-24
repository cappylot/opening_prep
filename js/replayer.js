// Replays games in a module worker when available, else on the main thread.
import { replayGame } from './tree.js';

let worker = null;
let failed = false;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker || failed) return worker;
  try {
    worker = new Worker(new URL('./replay.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      pending.delete(e.data.id);
      p?.resolve(e.data.games);
    };
    worker.onerror = () => {
      failed = true;
      worker = null;
      for (const [, p] of pending) p.fallback();
      pending.clear();
    };
  } catch {
    failed = true;
  }
  return worker;
}

function inline(userId, games) {
  return games.map((g) => replayGame(g, userId)).filter(Boolean);
}

export function replayBatch(userId, games) {
  const w = getWorker();
  if (!w) return Promise.resolve(inline(userId, games));
  return new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, { resolve, fallback: () => resolve(inline(userId, games)) });
    w.postMessage({ id, userId, games });
  });
}
