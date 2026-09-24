// Lichess API client. All endpoints used here work without login and allow
// cross-origin requests from the browser.
import { getSettings } from './store.js';

export const LICHESS = 'https://lichess.org';
export const PERF_TYPES = ['bullet', 'blitz', 'rapid', 'classical', 'correspondence'];

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function headers(extra = {}) {
  const h = { ...extra };
  const token = getSettings().token;
  if (token) h.Authorization = `Bearer ${token.trim()}`;
  return h;
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

/**
 * fetch with Lichess's rate-limit etiquette: on 429, wait a full minute and
 * retry once. onWait(seconds) lets the UI show a countdown.
 */
async function lfetch(url, { signal, accept = 'application/json', onWait } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: headers({ Accept: accept }), signal });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new ApiError(navigator.onLine === false ? 'You are offline.' : 'Could not reach Lichess. Check your connection.', 0);
    }
    if (res.status === 429 && attempt === 0) {
      for (let s = 60; s > 0; s--) {
        onWait?.(s);
        await sleep(1000, signal);
      }
      onWait?.(0);
      continue;
    }
    if (res.status === 401) throw new ApiError('Your Lichess token was rejected. Remove or replace it in Settings.', 401);
    if (res.status === 404) throw new ApiError('Not found', 404);
    if (res.status === 429) throw new ApiError('Lichess is rate limiting requests. Try again in a minute.', 429);
    if (!res.ok) throw new ApiError(`Lichess returned an error (${res.status}).`, res.status);
    return res;
  }
}

/** Public profile. Throws ApiError(404) when the user doesn't exist. */
export async function getUser(name, opts) {
  try {
    const res = await lfetch(`${LICHESS}/api/user/${encodeURIComponent(name)}`, opts);
    const u = await res.json();
    if (u.disabled || u.closed) throw new ApiError(`${u.username || name} has closed their account.`, 410);
    return u;
  } catch (e) {
    if (e.status === 404) throw new ApiError(`No Lichess player called “${name}”.`, 404);
    throw e;
  }
}

/** Username suggestions for a search term (3+ characters). */
export async function autocomplete(term, signal) {
  if (term.length < 3) return [];
  const res = await lfetch(`${LICHESS}/api/player/autocomplete?term=${encodeURIComponent(term)}&object=true`, { signal });
  const data = await res.json();
  return data.result || [];
}

/**
 * Streams a player's games as NDJSON, calling onGame(raw) for each one.
 * Resolves with the number of games received. Abort via `signal` to stop
 * early; games already delivered stay usable.
 */
export async function streamGames(name, { max = 500, since, perfTypes, signal, onGame, onWait } = {}) {
  const params = new URLSearchParams({
    moves: 'true',
    opening: 'true',
    clocks: 'false',
    evals: 'false',
    pgnInJson: 'false',
    finished: 'true',
    sort: 'dateDesc',
  });
  if (max) params.set('max', String(max));
  if (since) params.set('since', String(since));
  if (perfTypes?.length) params.set('perfType', perfTypes.join(','));
  const res = await lfetch(`${LICHESS}/api/games/user/${encodeURIComponent(name)}?${params}`, {
    signal,
    accept: 'application/x-ndjson',
    onWait,
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let count = 0;
  const flush = (line) => {
    line = line.trim();
    if (!line) return;
    try {
      onGame(JSON.parse(line));
      count++;
    } catch {
      /* ignore a malformed line */
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        flush(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    }
    flush(buf);
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
  }
  return count;
}

const evalCache = new Map();

/** Cached cloud evaluation for a FEN, or null when Lichess has none. */
export async function cloudEval(fen, signal) {
  if (evalCache.has(fen)) return evalCache.get(fen);
  let result = null;
  try {
    const res = await lfetch(`${LICHESS}/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=1`, { signal });
    const data = await res.json();
    const pv = data.pvs?.[0];
    if (pv) result = { cp: pv.cp, mate: pv.mate, depth: data.depth, best: pv.moves?.split(' ')[0] || null, pv: pv.moves || '' };
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    if (e.status !== 404) return undefined; // transient: don't cache
  }
  evalCache.set(fen, result);
  return result;
}

export const gameUrl = (id, ply, color) => `${LICHESS}/${id}${color === 'black' ? '/black' : ''}${ply ? `#${ply}` : ''}`;
export const profileUrl = (name) => `${LICHESS}/@/${encodeURIComponent(name)}`;
