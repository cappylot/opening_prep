// Downloading and caching an opponent's games.
import { getUser, streamGames } from './lichess.js';
import { getOpponent, putOpponent, getGames, putGames } from './store.js';
import { replayBatch } from './replayer.js';

const BATCH = 40;

/** Rough number of games the download will return, for the progress bar. */
export function expectedCount(user, cfg) {
  const perfs = user?.perfs || {};
  const total = (cfg.perfTypes?.length ? cfg.perfTypes : Object.keys(perfs)).reduce((a, p) => a + (perfs[p]?.games || 0), 0);
  if (!total) return cfg.max || null;
  return cfg.max ? Math.min(cfg.max, total) : total;
}

function profileOf(u) {
  const perfs = {};
  for (const [k, v] of Object.entries(u.perfs || {})) if (v && v.games) perfs[k] = { rating: v.rating, games: v.games, prov: !!v.prov };
  return {
    title: u.title || null,
    flair: u.flair || null,
    perfs,
    total: u.count?.all || 0,
    createdAt: u.createdAt,
    seenAt: u.seenAt,
    country: u.profile?.flag || u.profile?.country || null,
    tos: !!u.tosViolation,
  };
}

/**
 * Loads an opponent from cache and/or Lichess.
 *  mode 'cache'  – cached data only (null if none)
 *  mode 'update' – fetch games newer than the cache (or a full download if nothing cached)
 *  mode 'full'   – replace the cache with a fresh download using `config`
 */
export async function syncOpponent(name, { mode = 'update', config, signal, onProgress, onWait } = {}) {
  const id = name.toLowerCase();
  const cachedOpp = await getOpponent(id);
  const cachedGames = cachedOpp ? (await getGames(id)) || [] : [];
  if (mode === 'cache') return cachedOpp ? { opp: cachedOpp, games: cachedGames } : null;

  const user = await getUser(name, { signal, onWait });
  const incremental = mode === 'update' && cachedOpp && cachedGames.length;
  const cfg = incremental ? cachedOpp.config : config;
  const since = incremental ? cachedOpp.newest + 1 : cfg.period ? Date.now() - cfg.period * 864e5 : undefined;
  const expected = incremental ? null : expectedCount(user, cfg);

  const fresh = [];
  const pending = [];
  let batch = [];
  let received = 0;
  const flushBatch = () => {
    if (!batch.length) return;
    pending.push(replayBatch(user.id, batch).then((r) => fresh.push(...r)));
    batch = [];
  };
  let stopped = false;
  try {
    await streamGames(user.username, {
      max: cfg.max || undefined,
      since,
      perfTypes: cfg.perfTypes,
      signal,
      onWait,
      onGame: (g) => {
        batch.push(g);
        received++;
        if (batch.length >= BATCH) flushBatch();
        onProgress?.({ received, expected });
      },
    });
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
  }
  stopped = !!signal?.aborted;
  flushBatch();
  await Promise.all(pending);

  const byId = new Map();
  for (const g of incremental ? cachedGames : []) byId.set(g.id, g);
  for (const g of fresh) byId.set(g.id, g);
  const games = [...byId.values()].sort((a, b) => b.t - a.t);
  const opp = {
    id: user.id,
    name: user.username,
    profile: profileOf(user),
    config: cfg,
    fetchedAt: Date.now(),
    openedAt: Date.now(),
    newest: games[0]?.t || cachedOpp?.newest || 0,
    count: games.length,
    partial: stopped || (incremental && cachedOpp.partial) || false,
  };
  await putOpponent(opp);
  await putGames(user.id, games);
  return { opp, games, added: incremental ? fresh.length : games.length, stopped };
}

export async function touchOpponent(opp) {
  await putOpponent({ ...opp, openedAt: Date.now() });
}
