const CACHE='gfp-online-v2-30';
const ASSETS=['./','./index.html','./config.js','./enhancements.css?v=20260804-12','./enhancements.js?v=20260804-12','./online.js?v=20260811-3','./manifest.webmanifest?v=20260810-2','./app-icon-192.png','./app-icon-512.png','./dib-staff-logo.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.hostname.endsWith('.supabase.co'))return;e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))))});
