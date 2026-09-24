// Position evaluation with fallbacks: cache → Lichess cloud → on-device Stockfish.
import { useEffect, useState } from '../vendor/preact/hooks.module.js';
import { cloudEval } from './lichess.js';
import { getEngine, engineSupported } from './engine.js';
import { getEval, putEval } from './store.js';
import { fenKey } from './tree.js';

const COOLDOWN_MS = 60000;

/** Is result `a` more trustworthy than `b`? Deeper wins; cloud wins ties. */
export function better(a, b) {
  if (!a) return false;
  if (!b) return true;
  if (a.depth !== b.depth) return a.depth > b.depth;
  return a.source === 'cloud' && b.source !== 'cloud';
}

/**
 * Evaluates `fen`, calling onUpdate(result) whenever a better result is known.
 * result: { cp | mate, depth, best, pv, source: 'cloud' | 'device', cached?, running? }
 * Resolves with the final result (or null). `deps` is injectable for tests.
 */
export async function evaluatePosition(fen, { mode = 'both', depth = 18, signal, onUpdate = () => {}, deps }) {
  const { memory, cacheGet, cachePut, cloud, device, deviceOk, online, state, now } = deps;
  if (mode === 'off') return null;
  const key = fenKey(fen);
  let best = memory.get(key) || null;
  if (!best) {
    const stored = await cacheGet(key);
    if (stored) {
      best = stored;
      memory.set(key, stored);
    }
  }
  if (best) onUpdate({ ...best, cached: true, running: false });
  if (best && best.depth >= depth) return best;

  const keep = (r) => {
    if (!better(r, best)) return false;
    best = r;
    memory.set(key, r);
    return true;
  };

  // 1. Lichess cloud (skipped while rate limited or offline)
  if (online() && now() >= state.cloudCooldownUntil) {
    const r = await cloud(fen, signal);
    if (signal?.aborted) return null;
    if (r.status === 'limited') state.cloudCooldownUntil = now() + COOLDOWN_MS;
    if (r.status === 'ok' && keep({ ...r.result, source: 'cloud' })) {
      onUpdate({ ...best, running: false });
      cachePut(key, best);
    }
    if (best && best.depth >= depth) return best;
  }
  if (mode === 'cloud' || !deviceOk()) {
    if (!best) onUpdate({ none: true });
    return best;
  }

  // 2. On-device Stockfish, streaming as it deepens
  onUpdate(best ? { ...best, running: true } : { running: true, pending: true });
  const final = await device(fen, depth, signal, (info) => {
    if (keep({ ...info, source: 'device' })) onUpdate({ ...best, running: true });
  });
  if (signal?.aborted) return null;
  if (final) keep({ ...final, source: 'device' });
  if (best) {
    cachePut(key, best);
    onUpdate({ ...best, running: false });
  } else onUpdate({ none: true });
  return best;
}

// ---- real dependencies ----
const memory = new Map();
const state = { cloudCooldownUntil: 0 };
const realDeps = {
  memory,
  state,
  now: () => Date.now(),
  online: () => navigator.onLine !== false,
  cacheGet: (key) => getEval(key),
  cachePut: (key, r) => {
    const { cp, mate, depth, best, pv, source } = r;
    putEval({ fen: key, cp, mate, depth, best, pv: (pv || []).slice(0, 12), source });
  },
  cloud: (fen, signal) => cloudEval(fen, { signal }),
  deviceOk: () => engineSupported(),
  device: (fen, depth, signal, onInfo) => getEngine().analyse(fen, { depth, signal, onInfo }),
};

/** React hook: live evaluation for a position. */
export function useEval(fen, { mode, depth, enabled = true }) {
  const [result, setResult] = useState(null);
  const [tick, setTick] = useState(0);

  // Resume when the page becomes visible again (the engine stops while hidden).
  useEffect(() => {
    const fn = () => !document.hidden && setTick((t) => t + 1);
    document.addEventListener('visibilitychange', fn);
    return () => document.removeEventListener('visibilitychange', fn);
  }, []);

  useEffect(() => {
    setResult(null);
    if (!enabled || mode === 'off') return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      evaluatePosition(fen, {
        mode,
        depth,
        signal: ctrl.signal,
        deps: realDeps,
        onUpdate: (r) => !ctrl.signal.aborted && setResult({ fen, ...r }),
      }).catch((e) => {
        if (!ctrl.signal.aborted) setResult({ fen, error: e.message || 'Engine error' });
      });
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [fen, mode, depth, enabled, tick]);

  return { result: result && result.fen === fen ? result : null, retry: () => setTick((t) => t + 1) };
}
