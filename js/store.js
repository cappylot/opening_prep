// Persistence: IndexedDB for opponents, their games and saved lines;
// localStorage for settings. Every call tolerates storage being unavailable.
const DB_NAME = 'opening-prep';
const DB_VERSION = 1;
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

export async function clearAll() {
  for (const s of ['opponents', 'games', 'lines']) await safe(tx(s, 'readwrite', (st) => st.clear()));
}

// ---- settings ----
const SETTINGS_KEY = 'opening-prep:settings';
export const DEFAULT_SETTINGS = {
  theme: 'system', // system | dark | light
  board: 'brown', // brown | blue | green | grey
  arrows: 4,
  minGames: 3,
  showEval: true,
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
