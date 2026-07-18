// ── Service Worker · Cache-Buster ─────────────────────────────────────────────
// Zweck: das „stale Sub-Modul"-Problem dauerhaft beheben.
//
// index.html lädt js/app.js?v=N — aber app.js importiert './gantt.js' OHNE
// Versionsangabe, und gantt.js importiert weiter data.js / schedule.js /
// timeaxis.js. Diese Untermodule nimmt der Browser aus dem HTTP-Cache
// (GitHub Pages sendet max-age=600). Nach einem Deploy kämen Änderungen daran
// also erst verspätet oder erst nach manuellem Hard-Reload an.
//
// Lösung (übernommen aus Crewplaner, dort seit v0.19 im Einsatz): für eigene
// JS/CSS/HTML eine Revalidierung erzwingen — network-first mit cache:'no-cache'.
//
// WICHTIG: Dieser SW CACHET NICHTS selbst (kein caches.put) → er kann NIEMALS
// eine alte Version einsperren. Fällt das Netz aus, fällt er auf den normalen
// Browser-Fetch zurück. Fremde Origins (ab Phase 1 die PocketBase-API) fasst er
// NICHT an — nur die eigene Domain.
//
// KILL-SWITCH (falls je nötig): Inhalt dieser Datei ersetzen durch
//   self.addEventListener('install',()=>self.skipWaiting());
//   self.addEventListener('activate',e=>e.waitUntil(self.registration.unregister()
//     .then(()=>self.clients.matchAll()).then(cs=>cs.forEach(c=>c.navigate(c.url)))));
// Danach deployen → der SW deinstalliert sich beim nächsten Aufruf selbst.

const SW_VERSION = 'v0.2.1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;   // nur eigene Domain

  const isNavigation = req.mode === 'navigate';
  const isAsset = /\.(?:js|mjs|css|html)$/i.test(url.pathname);
  if (!isNavigation && !isAsset) return;             // Bilder/Fonts normal lassen

  // Immer frisch vom Server holen; bei Netzfehler normaler Fetch als Rückfall.
  event.respondWith(
    fetch(req, { cache: 'no-cache' }).catch(() => fetch(req))
  );
});
