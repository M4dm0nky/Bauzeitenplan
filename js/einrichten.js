// ── Einrichten als eigene Seite ──────────────────────────────────────────────
// Die Seite liegt als `#ein-seite` fest im index.html (Kopf, Navigation, die
// Bereiche samt den umgezogenen Knöpfen mit ihren ids). Dieses Modul füllt, was
// sich ändert: Titel, Status je Bereich und das Formular «Projekt».
//
// Sie SCHREIBT nur über `send(cmd)` (= app.js `apply`, das Fehler anzeigt) und
// zeichnet aus dem Store. Ein abgelehnter Befehl setzt das Feld auf den
// Store-Wert zurück. Neuaufbau nur über `refresh()`: er ändert Werte an Ort und
// Stelle und lässt das Feld in Ruhe, in dem gerade getippt wird — nie ein
// Austausch des Knotens unter dem Cursor (dieselbe Regel wie in der Tabelle).
import { el } from './dom.js';
import { einrichtStatus } from './einrichten-status.js';
import { newId } from './store.js';

const BEREICHE = ['projekt', 'phasen', 'baender', 'res', 'arten'];
const ZEICHEN = { ok: '✓', warn: '⚠', leer: '○' };
const STATUS_TITEL = { ok: 'in Ordnung', warn: 'braucht einen Blick', leer: 'noch leer' };

/**
 * @param {HTMLElement} root  das feste `#ein-seite`
 * @param {{store, send:(cmd:object)=>any, zu:HTMLElement, onZu?:()=>void, onBereich?:(name:string)=>void}} o
 * @returns {{open(bereich?:string, opt?:{erst?:boolean}):void, close():void, refresh():void, readonly offen:boolean}}
 */
export function createEinrichten(root, { store, send, zu, onZu, onBereich }) {
  const titel = root.querySelector('.ein-titel');
  const navBtns = [...root.querySelectorAll('button[data-ein]')];
  const sektionen = [...root.querySelectorAll('[data-ein-tab]')];
  const host = root.querySelector('.ein-projekt-form');
  let offen = false;
  let bereich = 'projekt';

  // ── Formular «Projekt» ──
  const felder = {};            // Feldname → input/textarea
  const projekt = () => store.state.project;

  function feld(field, label, { id, multi = false, list, hint, rows } = {}) {
    const inp = multi ? el('textarea') : el('input');
    if (!multi) inp.type = 'text';
    if (rows) inp.rows = rows;
    inp.id = id;
    inp.autocomplete = 'off';
    inp.spellcheck = false;
    if (list) inp.setAttribute('list', list);
    inp.setAttribute('aria-label', label);
    // Nur `change`, nie zusätzlich `blur`: ein Befehl = ein ⌘Z.
    inp.addEventListener('change', () => {
      const r = send({ type: 'setProjectField', field, value: inp.value });
      // Abgelehnt: das Feld zeigt wieder, was im Store steht (auch im Fokus).
      if (r && r.ok === false) inp.value = projekt()[field] ?? '';
    });
    felder[field] = inp;
    const lab = el('label', 'ein-feld');
    lab.append(el('span', 'ein-lab', label), inp);
    if (hint) lab.append(el('span', 'ei-hint', hint));
    return lab;
  }

  // Ansprechpartner: eine Zeile je Kontakt, Zeilen nach id wiederverwendet.
  const kontaktBox = el('div', 'ein-kontakte');
  const kontaktLeer = el('p', 'ei-hint', 'Noch kein Ansprechpartner.');
  const zeilen = new Map();    // id → Zeile
  const kontakte = () => projekt().kontakte || [];
  const sendeKontakte = (liste) => send({ type: 'setProjectField', field: 'kontakte', value: liste });

  function kontaktZeile(id) {
    const z = el('div', 'ein-kontakt');
    z.dataset.id = id;
    const mk = (cls, feldName, label, type = 'text') => {
      const i = el('input', cls);
      i.type = type;
      i.autocomplete = 'off';
      i.setAttribute('aria-label', label);
      i.addEventListener('change', () => {
        // Frisch aus dem Store, nie aus der Closure.
        const r = sendeKontakte(kontakte().map((k) => (k.id === id ? { ...k, [feldName]: i.value } : k)));
        if (r && r.ok === false) i.value = (kontakte().find((k) => k.id === id) || {})[feldName] ?? '';
      });
      return i;
    };
    const del = el('button', 'btn k-del', '×');
    del.type = 'button';
    del.title = 'Ansprechpartner entfernen (⌘Z holt ihn zurück)';
    del.setAttribute('aria-label', 'Ansprechpartner entfernen');
    del.onclick = () => sendeKontakte(kontakte().filter((k) => k.id !== id));
    z.append(mk('k-name', 'name', 'Name'), mk('k-rolle', 'rolle', 'Rolle'), mk('k-tel', 'tel', 'Telefon', 'tel'), del);
    return z;
  }

  function zeichneKontakte() {
    const liste = kontakte();
    for (const [id, z] of zeilen) {
      if (!liste.some((k) => k.id === id)) { z.remove(); zeilen.delete(id); }
    }
    liste.forEach((k, i) => {
      let z = zeilen.get(k.id);
      if (!z) { z = kontaktZeile(k.id); zeilen.set(k.id, z); }
      if (kontaktBox.children[i] !== z) kontaktBox.insertBefore(z, kontaktBox.children[i] || null);
      for (const [cls, f] of [['.k-name', 'name'], ['.k-rolle', 'rolle'], ['.k-tel', 'tel']]) {
        const inp = z.querySelector(cls);
        if (document.activeElement !== inp && inp.value !== k[f]) inp.value = k[f];
      }
    });
    kontaktLeer.hidden = liste.length > 0;
  }

  function baueFormular() {
    host.replaceChildren();
    const zonen = el('datalist');
    zonen.id = 'ein-zonen';
    try {
      for (const z of Intl.supportedValuesOf('timeZone')) zonen.append(new Option(z));
    } catch { /* ältere Browser: freie Eingabe, der Store prüft */ }
    const zeile = el('div', 'ein-zeile');
    zeile.append(feld('name', 'Name', { id: 'ein-name' }), feld('venue', 'Ort', { id: 'ein-venue' }));
    const add = el('button', 'btn', '+ Ansprechpartner');
    add.type = 'button';
    add.id = 'ein-kontakt-add';
    add.onclick = () => {
      const id = newId('k');
      const r = sendeKontakte([...kontakte(), { id, name: '', rolle: '', tel: '' }]);
      if (r && r.ok === false) return;
      zeilen.get(id)?.querySelector('.k-name').focus();
    };
    const kopf = el('div', 'ein-kontakt ein-kontakt-kopf');
    kopf.append(el('span', null, 'Name'), el('span', null, 'Rolle'), el('span', null, 'Telefon'), el('span'));
    const sek = el('div', 'ein-gruppe');
    sek.append(el('h3', 'ei-h', 'Ansprechpartner'), kopf, kontaktBox, kontaktLeer, add);
    host.append(
      zeile,
      feld('adresse', 'Adresse', { id: 'ein-adresse' }),
      feld('kunde', 'Kunde / Veranstalter', { id: 'ein-kunde' }),
      feld('anfahrt', 'Anfahrt / Zufahrt / Ladezone', { id: 'ein-anfahrt', multi: true, rows: 3 }),
      feld('timezone', 'Zeitzone', { id: 'ein-timezone', list: 'ein-zonen',
        hint: 'Zeiten im Plan bleiben, nur die Jetzt-Linie richtet sich danach.' }),
      zonen,
      sek,
    );
  }

  // ── Zeichnen ──
  function refresh() {
    const st = einrichtStatus(store.state);
    titel.textContent = '⚙ Einrichten — ' + (projekt().name || '');
    for (const b of navBtns) {
      const s = st[b.dataset.ein];
      const mark = b.querySelector('.ein-st');
      if (!s || !mark) continue;           // «sync» hat kein Status-Zeichen
      mark.className = 'ein-st ein-st-' + s;
      mark.textContent = ZEICHEN[s];
      mark.title = STATUS_TITEL[s];
    }
    // Werte an Ort und Stelle; das Feld mit dem Cursor bleibt unberührt.
    for (const [f, inp] of Object.entries(felder)) {
      if (document.activeElement === inp) continue;
      const v = projekt()[f] ?? '';
      if (inp.value !== v) inp.value = v;
    }
    zeichneKontakte();
  }

  function zeigeBereich(name) {
    bereich = name;
    for (const b of navBtns) b.setAttribute('aria-pressed', String(b.dataset.ein === name));
    for (const s of sektionen) s.hidden = s.dataset.einTab !== name;
    onBereich?.(name);
  }

  navBtns.forEach((b) => { b.onclick = () => zeigeBereich(b.dataset.ein); });
  zu.onclick = () => onZu?.();
  // Was beim Tippen aufgeschoben wurde, nachholen, sobald der Fokus das Feld verlässt
  // (erst im nächsten Tick: `activeElement` ist während focusout noch das alte Feld).
  root.addEventListener('focusout', () => setTimeout(refresh, 0));

  baueFormular();
  refresh();

  return {
    open(name = 'projekt') {
      offen = true;
      root.hidden = false;
      refresh();
      zeigeBereich(BEREICHE.includes(name) || name === 'sync' ? name : 'projekt');
      zu.focus();
    },
    close() {
      offen = false;
      root.hidden = true;
    },
    refresh,
    get offen() { return offen; },
    get bereich() { return bereich; },
  };
}
