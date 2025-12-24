const CACHE_NAME = 'archivo-v1';
const ASSETS = [
  'index.html',
  'app.js',
  'styles.css',
  'manifest.json'
];

// Instalación y cacheo de archivos
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// Estrategia: Primero red, si falla, caché
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});