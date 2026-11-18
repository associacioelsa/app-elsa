// Guarda al mòbil els fitxers de la pantalla (no les dades) perquè l'app s'obri més de pressa.
// Cada vegada que es publica una versió nova, cal canviar el número de VERSIO.
const VERSIO = 'elsa-v2';
const FITXERS = ['./', 'index.html', 'estil.css', 'app.js', 'config.js', 'silueta.svg', 'furgoneta.svg',
  'icona-192.png', 'manifest.json'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSIO).then(function (c) { return c.addAll(FITXERS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (claus) {
    return Promise.all(claus.filter(function (k) { return k !== VERSIO; }).map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});

// Primer la xarxa (sempre la versió més nova), però com a molt 4 segons; si no arriba, la còpia guardada.
// Les dades (Google) no passen per aquí: van directes i no es guarden mai.
self.addEventListener('fetch', function (e) {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const esPagina = e.request.mode === 'navigate';
  const clauCau = esPagina ? './' : url.pathname;   // la pàgina es guarda sempre sense res a l'adreça
  const xarxa = fetch(e.request).then(function (r) {
    if (r.ok) { const copia = r.clone(); caches.open(VERSIO).then(function (c) { c.put(clauCau, copia); }); }
    return r;
  });
  const guardada = new Promise(function (resol) {
    setTimeout(function () { caches.match(clauCau).then(resol); }, 4000);
  });
  e.respondWith(Promise.race([xarxa.catch(function () { return caches.match(clauCau); }), guardada.then(function (r) { return r || xarxa; })]));
});
