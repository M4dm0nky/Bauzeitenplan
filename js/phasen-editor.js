// ── Phasen bearbeiten ────────────────────────────────────────────────────────
// EIN Editor, zwei Orte: die Liste im Einrichten-Reiter «Phasen» und der
// schwebende Kasten, der beim Klick auf die Leiste über dem Zeitstrahl aufgeht.
// Beide bauen dieselbe Zeile (`zeile`) — zwei Orte, an denen dieselbe Eingabe
// auseinanderlaufen könnte, wären einer zu viel.
//
// Art und Name wirken sofort (ein Befehl je Änderung). Von/Bis sind ein ENTWURF
// mit ✓ und ✗ (js/entwurf.js) — dieselbe Haltung wie bei Vorgängen: ein Datum
// wird erst gültig, wenn man es bestätigt. Löschen geht über den App-Dialog
// (askDialog), nie über einen Browser-Dialog.
//
// Gezeichnet wird immer AUS DEM STORE; ein abgelehnter Befehl (Überlappung)
// hinterlässt nichts, was nur dieses Fenster kennt.

import { el, toInput } from './dom.js';
import { toMin, toDate } from './schedule.js';
import { local } from './conflicts.js';
import { PHASEN_ARTEN, phaseLabel, showTage } from './phasen.js';
import { entwurfBinden } from './entwurf.js';

export function createPhasenEditor({ store, askDialog, onError, onHinweis }) {
  const lesen = (id) => (store.state.phases || []).find((p) => p.id === id);
  let liste = null;            // Host im Einrichten-Reiter
  let kastenZu = null;         // offener Kasten
  let kastenRefresh = null;

  function senden(cmd) {
    const r = store.apply(cmd);
    if (r && r.ok === false) { onError(r.error); refresh(); }
    return r;
  }

  /** Eine Zeile: Art · Name · Von · Bis · ✓ ✗ · Löschen. */
  function zeile(id) {
    const p = lesen(id);
    const row = el('div', 'ph-z');
    row.dataset.phase = id;

    const art = el('select', 'ph-art');
    art.setAttribute('aria-label', 'Art');
    for (const a of PHASEN_ARTEN) { const o = el('option', null, a.icon + ' ' + a.label); o.value = a.id; art.append(o); }
    art.value = p.art;
    art.dataset.art = p.art;

    const name = el('input', 'ph-name');
    name.value = p.name || '';
    name.setAttribute('aria-label', 'Name');
    name.title = 'Leer: die Art ist der Name («' + phaseLabel({ art: p.art, name: '' }) + '»)';

    const von = el('input', 'ph-von'); von.type = 'datetime-local';
    von.value = toInput(p.start); von.setAttribute('aria-label', 'Von');
    const bis = el('input', 'ph-bis'); bis.type = 'datetime-local';
    bis.value = toInput(p.end); bis.setAttribute('aria-label', 'Bis');
    const popIn = el('span', 'ph-pop');
    // Fokus innerhalb dieses Blocks (Felder UND ✓ ✗) = «noch in der Zeile».
    const entw = el('span', 'ph-entw');
    entw.append(von, el('span', 'ph-bis-z', '–'), bis, popIn);

    const tag = p.art === 'show' ? showTage(store.state.phases).find((t) => t.phase === id) : null;
    const tageTxt = tag ? 'Show-Tag ' + tag.n : '';
    const info = el('span', 'ph-tage', tageTxt);

    const del = el('button', 'tb-ico ph-del', '×');
    del.type = 'button';
    del.title = 'Phase löschen';
    del.setAttribute('aria-label', 'Phase löschen');

    // «Show-Tag 1–4» steht UNTER der Art: so hat die Zeile auf dem Desktop genau
    // eine Reihe, und das × bleibt nie allein in einer eigenen Zeile.
    const artz = el('div', 'ph-artz');
    artz.append(art, info);
    row.append(artz, name, entw, del);

    art.addEventListener('change', () => { if (art.value !== lesen(id)?.art) senden({ type: 'setPhase', id, art: art.value }); });
    name.addEventListener('change', () => { if (name.value.trim() !== (lesen(id)?.name || '')) senden({ type: 'setPhase', id, name: name.value }); });
    del.addEventListener('click', async () => {
      const aktuell = lesen(id);
      if (!aktuell) return;
      const ok = await askDialog({
        title: 'Phase löschen?',
        message: [`«${phaseLabel(aktuell)}» löschen? Die Vorgänge bleiben unberührt. ⌘Z holt die Phase zurück.`],
        buttons: [{ label: 'Abbrechen', value: false }, { label: 'Löschen', value: true, danger: true }],
      });
      if (ok) senden({ type: 'removePhase', id });
    });
    entwurfBinden({
      start: von, ende: bis, gruppe: [entw], markiere: row, popIn, onHinweis,
      lesen: () => lesen(id),
      uebernehmen: (e) => store.apply({ type: 'setPhase', id, start: e.start, end: e.end }),
    });
    return row;
  }

  function zeichneListe() {
    if (!liste) return;
    // Nicht neu bauen, solange der Reiter verborgen ist (jede Store-Änderung
    // käme sonst hier an) oder in einer Zeile ein Entwurf offen ist — er läge
    // sonst nur im abgehängten Knoten und ginge verloren.
    const sichtbar = !!(liste.offsetParent || liste.getClientRects().length);
    if (liste.children.length && (!sichtbar || liste.querySelector('.is-entwurf'))) return;
    const phasen = [...(store.state.phases || [])].sort((a, b) => (toMin(a.start) - toMin(b.start)) || (toMin(a.end) - toMin(b.end)));
    liste.replaceChildren();
    if (!phasen.length) liste.append(el('p', 'ei-hint ph-leer', 'Noch keine Phasen.'));
    for (const p of phasen) liste.append(zeile(p.id));
  }

  function refresh() {
    zeichneListe();
    kastenRefresh?.();
  }

  /** Die Liste im Einrichten-Reiter einhängen. */
  function mountListe(host, addKnopf) {
    liste = host;
    addKnopf.addEventListener('click', () => {
      const S = store.state;
      const benutzt = new Set((S.phases || []).map((p) => p.art));
      const art = (PHASEN_ARTEN.find((a) => !benutzt.has(a.id)) || PHASEN_ARTEN[2]).id;
      // Hinter die letzte Phase derselben Art — sonst lehnt der Store die
      // Überlappung gleich ab und der Knopf täte «nichts».
      const letzte = (S.phases || []).filter((p) => p.art === art).map((p) => toMin(p.end)).sort((a, b) => a - b).pop();
      const start = letzte != null ? local(toDate(letzte)) : S.project.start;
      const r = senden({ type: 'addPhase', phase: { art, start, end: local(toDate(toMin(start) + 1440)) } });
      if (r && r.id) liste.querySelector(`.ph-z[data-phase="${r.id}"] .ph-name`)?.focus();
    });
    zeichneListe();
  }

  /** Der Kasten über der Leiste. Merkt sich das RECHTECK, nicht den Knoten (die Leiste baut sich bei jeder Änderung neu auf). */
  function openBox(id, rect) {
    kastenZu?.();
    if (!lesen(id)) return;
    const box = el('div', 'tb-neuart ph-box');
    document.body.append(box);
    const zeichne = () => {
      if (!lesen(id)) { zu(); return; }
      // Mitten in einem Entwurf nicht neu zeichnen: er läge sonst nur im abgehängten Knoten.
      if (box.querySelector('.is-entwurf')) return;
      box.replaceChildren(el('div', 'tb-neuart-h', 'Phase'), zeile(id));
      platziere(box, rect);
    };
    const zu = () => {
      box.remove();
      window.removeEventListener('keydown', aufTaste, true);
      document.removeEventListener('pointerdown', aussen, true);
      if (kastenZu === zu) { kastenZu = null; kastenRefresh = null; }
    };
    // Escape verwirft zuerst einen offenen Entwurf (das erledigt entwurf.js mit
    // stopPropagation); erst ohne Entwurf schließt es den Kasten.
    const aufTaste = (e) => { if (e.key === 'Escape' && !box.querySelector('.is-entwurf')) { e.preventDefault(); zu(); } };
    const aussen = (e) => { if (!box.contains(e.target) && !document.querySelector('.dlg:not([hidden])')) zu(); };
    kastenZu = zu; kastenRefresh = zeichne;
    window.addEventListener('keydown', aufTaste, true);
    document.addEventListener('pointerdown', aussen, true);
    zeichne();
    box.querySelector('.ph-name')?.focus();
  }

  function platziere(box, a) {
    const r = box.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(a.left, window.innerWidth - r.width - 8)) + 'px';
    box.style.top = (a.bottom + r.height > window.innerHeight - 8
      ? Math.max(8, a.top - r.height - 4) : a.bottom + 4) + 'px';
  }

  return { mountListe, openBox, refresh, schliesse: () => kastenZu?.() };
}
