// ── Einstiegspunkt ────────────────────────────────────────────────────────────
// Verdrahtet die Bedienelemente mit der Gantt-Engine. Bewusst dünn: alles
// Fachliche liegt in gantt.js (Darstellung), schedule.js (Terminrechnung) und
// timeaxis.js (Zeit ↔ Pixel).

import { createGantt } from './gantt.js';
import { PROJECT, GEWERKE } from './data.js';

const root = document.getElementById('bz');
const g = createGantt(root, {
  rowH: 24, groupH: 28, barH: 12, sideW: 228, initialZoom: 'tage',
});

// ── Projektkopf ─────────────────────────────────────────────────────────────
document.getElementById('proj-name').textContent = PROJECT.name;
document.getElementById('proj-venue').textContent = PROJECT.venue;
document.title = PROJECT.name + ' — Bauzeitenplan';

// ── Zoom ────────────────────────────────────────────────────────────────────
const segs = [...document.querySelectorAll('[data-z]')];
const syncSeg = () => segs.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.z === g.zoomName)));
segs.forEach((b) => { b.onclick = () => { g.setZoomPreset(b.dataset.z); syncSeg(); }; });
document.getElementById('zin').onclick = () => { g.zoomIn(); syncSeg(); };
document.getElementById('zout').onclick = () => { g.zoomOut(); syncSeg(); };
document.getElementById('now').onclick = () => g.goToNow();
// Zoom per ⌘+Rad und Tastatur läuft an den Segmenten vorbei — nachziehen.
root.addEventListener('wheel', () => requestAnimationFrame(syncSeg), { passive: true });
root.addEventListener('keyup', syncSeg);
syncSeg();

// ── Zuklappen ───────────────────────────────────────────────────────────────
let folded = false;
const foldBtn = document.getElementById('fold');
foldBtn.onclick = () => {
  folded = !folded;
  folded ? g.collapseAll() : g.expandAll();
  foldBtn.textContent = folded ? 'Alle aufklappen' : 'Alle zuklappen';
};

// ── Minimap ─────────────────────────────────────────────────────────────────
if (g.minimapNode) document.getElementById('mini').append(g.minimapNode);

// ── Kennzahlen ──────────────────────────────────────────────────────────────
const s = g.stats();
document.getElementById('kpis').innerHTML = [
  ['Gewerke', s.gewerke],
  ['Vorgänge', s.total],
  ['läuft gerade', s.run],
  ['Crew im Einsatz', s.crew],
  ['kritisch', s.crit],
].map(([k, v]) => `<div class="kpi"><div class="kpi-v">${v}</div><div class="kpi-k">${k}</div></div>`).join('');

// ── Legende ─────────────────────────────────────────────────────────────────
// Pflicht, nicht Kür: drei Gewerk-Farben liegen auf hellem Grund unter 3:1
// Kontrast. Identität darf deshalb nie allein an der Farbe hängen.
document.getElementById('legend').innerHTML = GEWERKE
  .map((x) => `<span class="legend-i"><span class="bz-dot" style="--gw:var(--gw-${x.id})"></span>${x.name}</span>`)
  .join('');
