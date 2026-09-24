// Persistence: IndexedDB for opponents, their games and saved lines, and the
// study library (studies, chapters, cards, reviews, bookmarks, app state);
// localStorage for settings. Every call tolerates storage being unavailable.
const DB_NAME = 'opening-prep';
const DB_VERSION = 3;
export const STUDY_STORES = ['studies', 'chapters', 'cards', 'reviews', 'bookmarks', 'appState'];
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('opponents')) db.createObjectStore('opponents', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('games')) db.createObjectStore('games', { keyPath: 'opp' });
      if (!db.objectStoreNames.contains('lines')) {
        const s = db.createObjectStore('lines', { keyPath: 'id' });
        s.createIndex('opp', 'opp');
      }
      if (!db.objectStoreNames.contains('evals')) {
        const s = db.createObjectStore('evals', { keyPath: 'fen' });
        s.createIndex('t', 't');
      }
      if (!db.objectStoreNames.contains('studies')) db.createObjectStore('studies', { keyPath: 'id' }).createIndex('slug', 'slug', { unique: true });
      if (!db.objectStoreNames.contains('chapters')) db.createObjectStore('chapters', { keyPath: 'id' }).createIndex('study', 'study');
      if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' }).createIndex('study', 'study');
      if (!db.objectStoreNames.contains('reviews')) {
        const s = db.createObjectStore('reviews', { keyPath: 'id', autoIncrement: true });
        s.createIndex('card', 'card');
        s.createIndex('t', 't');
      }
      if (!db.objectStoreNames.contains('bookmarks')) db.createObjectStore('bookmarks', { keyPath: 'card' });
      if (!db.objectStoreNames.contains('appState')) db.createObjectStore('appState', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => (out = r.result);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const safe = (p, fallback) => p.catch((e) => (console.warn('storage', e), fallback));

export const listOpponents = () =>
  safe(tx('opponents', 'readonly', (s) => s.getAll()), []).then((a) => (a || []).sort((x, y) => y.openedAt - x.openedAt));
export const getOpponent = (id) => safe(tx('opponents', 'readonly', (s) => s.get(id.toLowerCase())), null);
export const putOpponent = (o) => safe(tx('opponents', 'readwrite', (s) => s.put(o)));
export const getGames = (id) => safe(tx('games', 'readonly', (s) => s.get(id.toLowerCase())), null).then((r) => r?.games || null);
export const putGames = (id, games) => safe(tx('games', 'readwrite', (s) => s.put({ opp: id.toLowerCase(), games })));

export async function deleteOpponent(id) {
  id = id.toLowerCase();
  await safe(tx('opponents', 'readwrite', (s) => s.delete(id)));
  await safe(tx('games', 'readwrite', (s) => s.delete(id)));
}

export const listLines = (opp) =>
  safe(tx('lines', 'readonly', (s) => s.index('opp').getAll(opp.toLowerCase())), []).then((a) => (a || []).sort((x, y) => x.created - y.created));
export const putLine = (line) => safe(tx('lines', 'readwrite', (s) => s.put(line)));
export const deleteLine = (id) => safe(tx('lines', 'readwrite', (s) => s.delete(id)));

// ---- engine evaluations (deepest result per position) ----
const MAX_EVALS = 5000;
let evalPuts = 0;

export const getEval = (fen) => safe(tx('evals', 'readonly', (s) => s.get(fen)), null);

export async function putEval(entry) {
  await safe(tx('evals', 'readwrite', (s) => s.put({ ...entry, t: Date.now() })));
  if (++evalPuts % 50 === 0) trimEvals();
}

async function trimEvals() {
  const count = await safe(tx('evals', 'readonly', (s) => s.count()), 0);
  if (count <= MAX_EVALS) return;
  let excess = count - MAX_EVALS;
  await safe(
    tx('evals', 'readwrite', (s) => {
      const req = s.index('t').openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur || excess-- <= 0) return;
        cur.delete();
        cur.continue();
      };
    })
  );
}

export async function clearAll() {
  for (const s of ['opponents', 'games', 'lines', 'evals', ...STUDY_STORES]) await safe(tx(s, 'readwrite', (st) => st.clear()));
}

// ---- study library: bulk reads and atomic multi-store writes ----
export const getAllOf = (store) => safe(tx(store, 'readonly', (s) => s.getAll()), []).then((a) => a || []);

/**
 * Applies {store: {put: [...], del: [...]}} in one transaction, so a graded answer
 * and its review log (or a study and all its chapters and cards) land together.
 */
export async function writeMany(ops) {
  const stores = Object.keys(ops);
  if (!stores.length) return true;
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const t = db.transaction(stores, 'readwrite');
      for (const name of stores) {
        const s = t.objectStore(name);
        for (const v of ops[name].put || []) s.put(v);
        for (const k of ops[name].del || []) s.delete(k);
      }
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
    return true;
  } catch (e) {
    console.warn('storage', e);
    return false;
  }
}

// ---- settings ----
const SETTINGS_KEY = 'opening-prep:settings';
export const DEFAULT_SETTINGS = {
  theme: 'system', // system | dark | light
  board: 'brown', // brown | blue | green | grey, or an iOS theme (see board.js BOARD_THEMES)
  pieces: 'cburnett', // cburnett, or one of the ported iOS piece sets
  animation: 0.2, // seconds per move; 0 = instant
  lastMove: true,
  decoration: '#c22e24', // colour of study arrows and square marks
  drillPacing: 'auto', // auto | manual (wait for Continue after each answer)
  arrows: 4,
  minGames: 3,
  engine: 'both', // both (cloud, then on-device Stockfish) | cloud | off
  engineDepth: 18,
  evalArrow: true,
  coords: true,
  haptics: true,
  halfLife: 0, // days; 0 = all games weigh the same
  me: '', // my Lichess username, for head-to-head
  token: '',
  maxGames: 500,
  perfTypes: ['blitz', 'rapid', 'classical'],
  period: 0, // days of history to download; 0 = all
};

let cached = null;
export function getSettings() {
  if (cached) return cached;
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch {
    /* private mode or corrupt value */
  }
  // Older versions had a single on/off "showEval" toggle.
  if (stored.showEval === false && !stored.engine) stored.engine = 'off';
  delete stored.showEval;
  cached = { ...DEFAULT_SETTINGS, ...stored };
  return cached;
}

export function saveSettings(patch) {
  cached = { ...getSettings(), ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(cached));
  } catch {
    /* ignore */
  }
  return cached;
}

export function localFlag(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(`opening-prep:${key}`);
    localStorage.setItem(`opening-prep:${key}`, value);
  } catch {
    return null;
  }
}
