// Offline support: the app shell is served from cache and refreshed in the
// background. Lichess API calls always go to the network. The Stockfish files
// (~7 MB) and the piece-set PNGs aren't precached; they're cached on first use.
const VERSION = 'v4';
const CACHE = `opening-prep-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './css/boards.css',
  './css/pieces.css',
  './css/study.css',
  './content/caro-kann-black.pgn',
  './content/ruy-lopez-white.pgn',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/apple-touch-icon.png',
  './js/main.js',
  './js/route.js',
  './js/ui.js',
  './js/board.js',
  './js/tree.js',
  './js/insights.js',
  './js/lichess.js',
  './js/store.js',
  './js/data.js',
  './js/replayer.js',
  './js/replay.worker.js',
  './js/drill.js',
  './js/engine.js',
  './js/evaluate.js',
  './js/components/search.js',
  './js/components/prep.js',
  './js/components/explore.js',
  './js/components/insightsPanel.js',
  './js/components/lines.js',
  './js/components/filters.js',
  './js/components/settings.js',
  './js/study/chess.js',
  './js/study/positionKey.js',
  './js/study/sha256.js',
  './js/study/movetree.js',
  './js/study/pgn.js',
  './js/study/cards.js',
  './js/study/srs.js',
  './js/study/plan.js',
  './js/study/drillSession.js',
  './js/study/metrics.js',
  './js/study/studyStore.js',
  './js/study/session.js',
  './js/components/study/common.js',
  './js/components/study/shell.js',
  './js/components/study/library.js',
  './js/components/study/viewer.js',
  './js/components/study/drill.js',
  './js/components/study/practice.js',
  './js/components/study/editor.js',
  './js/components/study/create.js',
  './js/components/study/analyze.js',
  './vendor/chessground/chessground.min.js',
  './vendor/chessground/chessground.base.css',
  './vendor/chessground/chessground.brown.css',
  './vendor/chessground/chessground.cburnett.css',
  './vendor/chess.js/chess.js',
  './vendor/preact/preact.module.js',
  './vendor/preact/hooks.module.js',
  './vendor/htm/htm.module.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('opening-prep-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const network = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => cached || (e.request.mode === 'navigate' ? cache.match('./index.html') : Response.error()));
      if (cached) {
        e.waitUntil(network.catch(() => {}));
        return cached;
      }
      return network;
    })
  );
});
