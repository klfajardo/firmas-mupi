self.addEventListener('install', (e) => {
  e.waitUntil(caches.open('firmas-cache-v1').then(cache => cache.addAll([
    './','./index.html','./js/app.js','./manifest.webmanifest','./assets/arte_vertical.png'
  ])));
});
self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then(res => res || fetch(e.request)));
});