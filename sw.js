// ── Service Worker · Cache-Buster und Offline-Rückfall ────────────────────────
// Zweck 1: das „stale Sub-Modul"-Problem dauerhaft beheben.
//
// index.html lädt js/app.js?v=N — aber app.js importiert './gantt.js' OHNE
// Versionsangabe, und gantt.js importiert weiter data.js / schedule.js /
// timeaxis.js. Diese Untermodule nimmt der Browser aus dem HTTP-Cache
// (GitHub Pages sendet max-age=600). Nach einem Deploy kämen Änderungen daran
// also erst verspätet oder erst nach manuellem Hard-Reload an.
//
// Zweck 2: nach dem ersten Besuch auch ohne Netz startbar (Aufbau in der Halle).
//
// network-first: online immer frisch, Cache nur bei Netzfehler. Sperrt deshalb
// nie eine alte Version ein, solange Netz da ist. Der Cache heißt je Version
// anders (bzp-<SW_VERSION>); activate löscht alle anderen. Fremde Origins
// (z. B. api.github.com für den Sync) fasst der Worker NICHT an — nur die
// eigene Domain.
//
// KILL-SWITCH (falls je nötig): Inhalt dieser Datei ersetzen durch
//   self.addEventListener('install',()=>self.skipWaiting());
//   self.addEventListener('activate',e=>e.waitUntil(self.registration.unregister()
//     .then(()=>self.clients.matchAll()).then(cs=>cs.forEach(c=>c.navigate(c.url)))));
// Danach deployen → der SW deinstalliert sich beim nächsten Aufruf selbst.

const SW_VERSION = 'v0.18.0';

const CACHE = 'bzp-' + SW_VERSION;

// Alles, was index.html/print.html zur Laufzeit laden. Eine neue Datei gehört
// hierher — tests/run.mjs prüft die Liste in beide Richtungen gegen das
// Dateisystem. Treffer im Cache per ignoreSearch (?v= ist nur Cache-Bust).
const HUELLE = [
  './',
  'index.html',
  'print.html',
  'js/app.js',
  'js/bedarf.js',
  'js/conflicts.js',
  'js/dom.js',
  'js/ebene.js',
  'js/gantt.js',
  'js/inspector.js',
  'js/live.js',
  'js/menu.js',
  'js/palette.js',
  'js/persistence.js',
  'js/print.js',
  'js/rail.js',
  'js/resources.js',
  'js/schedule.js',
  'js/store.js',
  'js/suche.js',
  'js/sync.js',
  'js/table.js',
  'js/templates.js',
  'js/timeaxis.js',
  'js/version.js',
  'styles/base.css',
  'styles/print.css',
  'styles/themes/blueprint.css',
  'styles/themes/board.css',
  'styles/themes/callboard.css',
  'styles/themes/console.css',
  'styles/themes/studio.css',
  'assets/callboard-favicon.svg',
  'assets/callboard-mark.svg',
  'assets/fonts/geist-400.woff2',
  'assets/fonts/geist-500.woff2',
  'assets/fonts/geist-600.woff2',
  'assets/fonts/geist-700.woff2',
  'assets/fonts/jetbrains-mono-400.woff2',
  'assets/fonts/jetbrains-mono-500.woff2',
  'assets/fonts/jetbrains-mono-600.woff2',
  'klassentreffen-festival.json',
  'amk-singleshow.json',
];

self.addEventListener('install', (e) => {
  // 'reload': am HTTP-Cache vorbei (Pages: max-age=600), sonst landen alte Kopien unter neuem Namen.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(HUELLE.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;   // nur eigene Domain

  const isNavigation = req.mode === 'navigate';
  const isAsset = /\.(?:js|mjs|css|html|json|woff2|svg)$/i.test(url.pathname);
  if (!isNavigation && !isAsset) return;

  // Online immer frisch; bei Erfolg Kopie in den Cache, bei Netzfehler daraus.
  event.respondWith(
    fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) {
        const kopie = res.clone();
        event.waitUntil(caches.open(CACHE).then((c) => c.put(req, kopie)).catch(() => {}));
      }
      return res;
    }).catch(async () => {
      const treffer = await caches.match(req, { ignoreSearch: true });
      if (treffer) return treffer;
      if (isNavigation) {
        const start = await caches.match('index.html', { ignoreSearch: true });
        if (start) return start;
      }
      return Response.error();
    })
  );
});
