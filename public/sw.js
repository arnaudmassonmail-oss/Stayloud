// STAYPIT service worker: lets the installed app open without network.
// Pages: always from the network (latest version); a clear offline page otherwise.
// Images / icons: served from the cache, refreshed in the background.
// The API and other sites are never cached here.
const CACHE='staypit-v9';
const SHELL=['/manifest.webmanifest','/icon-192.png','/icon-512.png','/apple-touch-icon.png','/favicon-32.png','/staypit-banner.jpg?v=5'];
const OFFLINE=`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>STAYPIT – hors ligne</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#060709;color:#e8ebee;font:16px/1.5 Inter,Arial,sans-serif;text-align:center;padding:24px}img{width:96px;height:96px;border-radius:22px}h1{font-size:20px;margin:18px 0 6px}p{color:#8a939c;margin:0 0 18px}button{border:0;border-radius:999px;background:#e50914;color:#fff;font:700 15px Inter,Arial,sans-serif;padding:12px 22px}</style></head><body><div><img src="/icon-192.png" alt=""><h1>Pas de connexion</h1><p>STAYPIT a besoin d’Internet pour trouver les actus et les concerts.<br>Vérifie ta connexion puis réessaie.</p><button onclick="location.reload()">Réessayer</button></div></body></html>`;

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>Promise.all(SHELL.map(u=>c.add(u).catch(()=>{})))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const req=e.request;if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==location.origin||url.pathname.startsWith('/api/'))return;
  if(req.mode==='navigate'){
    e.respondWith(fetch(req).catch(()=>new Response(OFFLINE,{headers:{'Content-Type':'text/html; charset=utf-8'}})));
    return;
  }
  if(/\.(png|jpe?g|webp|svg|ico|webmanifest)$/i.test(url.pathname)){
    e.respondWith(caches.open(CACHE).then(async c=>{const hit=await c.match(req);const net=fetch(req).then(r=>{if(r.ok)c.put(req,r.clone());return r}).catch(()=>hit);return hit||net}));
  }
});
