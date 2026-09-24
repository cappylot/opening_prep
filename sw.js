// Offline support: the app shell is served from cache and refreshed in the
// background. Lichess API calls always go to the network.
const VERSION = 'v1';
const CACHE = `opening-prep-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
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
  './js/components/search.js',
  './js/components/prep.js',
  './js/components/explore.js',
  './js/components/insightsPanel.js',
  './js/components/lines.js',
  './js/components/filters.js',
  './js/components/settings.js',
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
