// ── Kontextmenü ───────────────────────────────────────────────────────────────
// Generisch, an der Maus. Muster aus dem Crewplaner (js/dropdown.js):
// position:fixed, damit kein Elternteil mit overflow:hidden es abschneidet.

import { el } from './dom.js';

let open = null;

/**
 * @param {number} x,y   Mausposition
 * @param {Array} items  {label, hint?, danger?, disabled?, run} · null = Trennlinie
 */
export function openMenu(x, y, items) {
  closeMenu();
  const box = el('div', 'mn');
  for (const it of items) {
    if (!it) { box.append(el('div', 'mn-sep')); continue; }
    const b = el('button', 'mn-i' + (it.danger ? ' is-danger' : ''));
    b.append(el('span', 'mn-l', it.label));
    if (it.hint) b.append(el('span', 'mn-h', it.hint));
    if (it.disabled) b.disabled = true;
    else b.onclick = () => { closeMenu(); it.run(); };
    box.append(b);
  }
  document.body.append(box);

  // Am Rand umklappen, statt aus dem Bild zu ragen.
  const r = box.getBoundingClientRect();
  const left = x + r.width > window.innerWidth - 8 ? Math.max(8, x - r.width) : x;
  const top = y + r.height > window.innerHeight - 8 ? Math.max(8, y - r.height) : y;
  box.style.left = left + 'px';
  box.style.top = top + 'px';

  open = box;
  // Erst im nächsten Zug lauschen — sonst schließt der Klick, der das Menü
  // geöffnet hat, es sofort wieder.
  setTimeout(() => {
    document.addEventListener('pointerdown', onAway, true);
    document.addEventListener('keydown', onKey, true);
  }, 0);
  const first = box.querySelector('.mn-i:not(:disabled)');
  if (first) first.focus();
}

// Nicht exportiert — nur dieses Modul schließt sein eigenes Menü.
function closeMenu() {
  if (!open) return;
  open.remove();
  open = null;
  document.removeEventListener('pointerdown', onAway, true);
  document.removeEventListener('keydown', onKey, true);
}

function onAway(e) { if (open && !open.contains(e.target)) closeMenu(); }
function onKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const items = [...open.querySelectorAll('.mn-i:not(:disabled)')];
    const i = items.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
    (items[(next + items.length) % items.length] || items[0]).focus();
  }
}
