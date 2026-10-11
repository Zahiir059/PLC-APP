/* sw.js - service worker: precaches the whole static site so the simulator works offline (PWA).
   Bump CACHE when you change files so returning visitors get the new version. */
const CACHE = 'bevplant-v1.0.0';
const ASSETS = [
  './', 'index.html', 'tests.html', 'manifest.webmanifest',
  'simulator/index.html', 'ladder/index.html',
  'css/hmi.css', 'css/landing.css',
  'assets/icon.svg', 'assets/icon-192.png', 'assets/icon-512.png',
  'data/default-data.js', 'data/default-program.json', 'data/default-tags.json',
  'js/config.js', 'js/tags.js', 'js/plc-engine.js', 'js/process-model.js', 'js/sim.js', 'js/alarms.js', 'js/storage.js', 'js/production.js', 'js/core.js',
  'js/ui.js', 'js/charts.js', 'js/ladder-editor.js', 'js/app.js', 'js/screens-operate.js', 'js/screens-monitor.js', 'js/screens-prod.js',
  'js/engineering.js', 'js/screens-eng.js', 'js/screens-learn.js', 'js/selftest.js', 'js/selftest-plant.js'
];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  // network first (fresh when online), fall back to cache (offline)
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then(m => m || caches.match('index.html'))));
});
