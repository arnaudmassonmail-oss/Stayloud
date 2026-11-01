// REPRISE : ouvre l'application même sans réseau (réseau d'abord, copie locale sinon).
// Les photos ne passent jamais par ici : elles restent dans le téléphone (IndexedDB).
const CACHE = 'reprise-v1';
const FILES = ['./', './index.html', './align.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-180.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith('/rephoto/')) return;
  e.respondWith(fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html'))));
});
