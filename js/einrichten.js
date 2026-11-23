// ── Einrichten als eigene Seite ──────────────────────────────────────────────
// Die Seite liegt als `#ein-seite` fest im index.html (Kopf, Navigation, die
// Bereiche samt den umgezogenen Knöpfen mit ihren ids). Dieses Modul füllt, was
// sich ändert: Titel, Status je Bereich, das Formular «Projekt», der Zeitraum und
// die Listen der Bereiche 3–5 (Gewerke/Bühnen, Personal/Maschinen, Arten/Abschnitte).
//
// Sie SCHREIBT nur über `send(cmd)` (= app.js `apply`, das Fehler anzeigt) und
// zeichnet aus dem Store. Ein abgelehnter Befehl setzt das Feld auf den
// Store-Wert zurück. Neuaufbau nur über `refresh()`: er ändert Werte an Ort und
// Stelle und lässt das Feld in Ruhe, in dem gerade getippt wird — nie ein
// Austausch des Knotens unter dem Cursor (dieselbe Regel wie in der Tabelle).
import { el } from './dom.js';
import { einrichtStatus, ausserhalb, zeitraumHuelle } from './einrichten-status.js';
import { planSpanne } from './timeaxis.js';
import { toMin } from './schedule.js';
import { phaseLabel, istPhasenArt } from './phasen.js';
import { newId, benutztVon } from './store.js';
import { mountAuswahlListe } from './listen-editor.js';
import { resNeuOpt } from './res-picker.js';
import { gewerkVar, gewerkTexture } from './palette.js';
import { artOf } from './ebene.js';

const BEREICHE = ['projekt', 'phasen', 'baender', 'res', 'arten'];
const ZEICHEN = { ok: '✓', warn: '⚠', leer: '○' };
const STATUS_TITEL = { ok: 'in Ordnung', warn: 'braucht einen Blick', leer: 'noch leer' };

/**
 * @param {HTMLElement} root  das feste `#ein-seite`
 * `loescheGewerk(id)` (Rückfrage + Löschen), `neuGewerk(ankerEl, art)` und
 * `neuFragen(opt, ankerEl, fertig)` (der schwebende «Neu…»-Kasten der Tabelle)
 * kommen von außen: dieses Modul importiert nichts aus app.js.
 * @param {{store, send:(cmd:object)=>any, zu:HTMLElement, zurueck:HTMLElement, weiter:HTMLElement, onZu?:()=>void, onBereich?:(name:string)=>void,
 *          loescheGewerk?:(id:string)=>any, neuGewerk?:(anker:HTMLElement, art:string)=>void,
 *          neuFragen?:(opt:object, anker:HTMLElement, fertig?:Function)=>void}} o
 * @returns {{open(bereich?:string, opt?:{erst?:boolean}):void, close():void, refresh():void, readonly offen:boolean}}
 */
export function createEinrichten(root, { store, send, zu, zurueck, weiter, onZu, onBereich, loescheGewerk, neuGewerk, neuFragen }) {
  const titel = root.querySelector('.ein-titel');
  const navBtns = [...root.querySelectorAll('button[data-ein]')];
  const sektionen = [...root.querySelectorAll('[data-ein-tab]')];
  const host = root.querySelector('.ein-projekt-form');
  const zrHost = root.querySelector('.ein-zeitraum');
  const gwHost = root.querySelector('.ein-gewerke');
  const resHost = root.querySelector('.ein-res');
  const artenHost = root.querySelector('.ein-arten');
  const zuText = zu.textContent;
  let offen = false;
  let erst = false;             // geführtes erstes Einrichten (Optik C)
  let bereich = 'projekt';
  let aufgeschoben = false;     // refresh hat ein Feld wegen Fokus übersprungen: beim Fokusverlust nachholen

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
        const v = k[f] ?? '';
        if (document.activeElement === inp) aufgeschoben = true;
        else if (inp.value !== v) inp.value = v;
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

  // ── Bereich «Zeitraum & Phasen»: Beginn/Ende, Warnung, Mini-Zeitleiste ──
  // Der Zeitraum ist jederzeit änderbar und verschiebt NIE Vorgänge oder Phasen;
  // liegt etwas außerhalb, warnt die Leiste und bietet die Hülle an (nie automatisch).
  const zrFelder = {};          // 'start' | 'end' → datetime-local
  const kurz = (s) => `${s.slice(8, 10)}.${s.slice(5, 7)}. ${s.slice(11, 16)}`;   // 'YYYY-MM-DDTHH:MM' → 'TT.MM. HH:MM'
  const plural = (n, eins, viel) => `${n} ${n === 1 ? eins : viel}`;
  const warn = el('div', 'ein-warn');
  const warnText = el('span', 'ein-warn-t');
  const warnKnopf = el('button', 'btn ein-warn-knopf');
  warnKnopf.type = 'button';
  warn.append(warnText, warnKnopf);
  warn.hidden = true;
  const zl = el('div', 'ein-zl');
  zl.setAttribute('role', 'img');

  function zeitFeld(field, label, id) {
    const inp = el('input');
    inp.type = 'datetime-local';
    inp.id = id;
    inp.setAttribute('aria-label', label);
    inp.addEventListener('change', () => {
      const r = send({ type: 'setProjectField', field, value: inp.value });
      if (r && r.ok === false) inp.value = projekt()[field] ?? '';
    });
    zrFelder[field] = inp;
    const lab = el('label', 'ein-feld');
    lab.append(el('span', 'ein-lab', label), inp);
    return lab;
  }

  warnKnopf.onclick = () => {
    // Frisch aus dem Store: ein Befehl-Bündel = ein ⌘Z.
    const h = zeitraumHuelle(store.state);
    send({ type: 'batch', cmds: [
      { type: 'setProjectField', field: 'start', value: h.start },
      { type: 'setProjectField', field: 'end', value: h.end },
    ] });
  };

  function baueZeitraum() {
    const zeile = el('div', 'ein-zeile ein-zr-felder');
    zeile.append(zeitFeld('start', 'Projektbeginn', 'ein-start'), zeitFeld('end', 'Projektende', 'ein-ende'));
    zrHost.append(zeile, warn, zl);
  }

  function zeichneZeitraum() {
    for (const [f, inp] of Object.entries(zrFelder)) {
      if (document.activeElement === inp) { aufgeschoben = true; continue; }
      const v = projekt()[f] ?? '';
      if (inp.value !== v) inp.value = v;
    }
    const st = store.state, a = ausserhalb(st);
    const teile = [];
    if (a.phasen) teile.push(plural(a.phasen, 'Phase', 'Phasen'));
    if (a.vorgaenge) teile.push(plural(a.vorgaenge, 'Vorgang', 'Vorgänge'));
    warn.hidden = !teile.length;
    if (teile.length) {
      const h = zeitraumHuelle(st);
      warnText.textContent = `⚠ ${teile.join(' und ')} ${a.phasen + a.vorgaenge === 1 ? 'liegt' : 'liegen'} außerhalb des Zeitraums`;
      warnKnopf.textContent = `Zeitraum auf ${kurz(h.start)} – ${kurz(h.end)} setzen`;
    }
    // Mini-Zeitleiste: Breite = planSpanne, Phasen als Balken (Farbe nach Art),
    // Projektzeitraum gestrichelt umrandet.
    const { von, bis } = planSpanne(st);
    const w = Math.max(1, bis - von);
    const pct = (m) => (((m - von) / w) * 100).toFixed(3) + '%';
    const rahmen = el('div', 'ein-zl-zeitraum');
    rahmen.style.left = pct(toMin(projekt().start));
    rahmen.style.width = (((toMin(projekt().end) - toMin(projekt().start)) / w) * 100).toFixed(3) + '%';
    const balken = [];
    for (const p of st.phases || []) {
      if (!p.start || !p.end) continue;
      const b = el('div', 'ein-zl-ph ein-zl-ph-' + (istPhasenArt(p.art) ? p.art : 'aufbau'), phaseLabel(p));
      b.style.left = pct(toMin(p.start));
      b.style.width = (((toMin(p.end) - toMin(p.start)) / w) * 100).toFixed(3) + '%';
      b.title = `${phaseLabel(p)}: ${kurz(p.start)} – ${kurz(p.end)}`;
      balken.push(b);
    }
    zl.style.setProperty('--zl-zeilen', String(Math.max(1, balken.length)));
    zl.setAttribute('aria-label', 'Zeitleiste: Phasen und Projektzeitraum');
    balken.forEach((b, i) => { b.style.top = `calc(${i} * var(--zl-h))`; });
    zl.replaceChildren(rahmen, ...balken);
  }

  // ── Bereich «Gewerke & Bühnen» ──
  // Zwei Listen (Art `gewerk`, Art `buehne`), je Zeile Farbfeld · Name · ↑ ↓ · ×.
  // Die Bühnenliste steht nur da, wenn es eine Bühne gibt; «+ Bühne» immer.
  const gwListen = {};          // art → { box, liste }
  const sortiert = () => [...(store.state.gewerke || [])].sort((a, b) => a.sort - b.sort);

  // `moveGewerk` statt `reorderGewerk`: Gewerke und Bühnen teilen EINE Reihenfolge
  // (`sort`). Stünde eine Bühne zwischen zwei Gewerken, tauschte `reorderGewerk`
  // mit ihr und die Gewerkliste bliebe sichtbar unverändert. Hier wird vor das
  // nächste Band GLEICHER Art eingefügt (↓: hinter das nächste, also vor dessen Nachfolger).
  function verschiebe(art, id, dir) {
    const alle = sortiert();
    const eigene = alle.filter((g) => artOf(g) === art);
    const i = eigene.findIndex((g) => g.id === id);
    const ziel = eigene[i + dir];
    if (i < 0 || !ziel) return;
    const before = dir < 0 ? ziel.id : (alle[alle.indexOf(ziel) + 1] || {}).id ?? null;
    send({ type: 'moveGewerk', id, before });
  }

  // Zeilen nach id wiederverwendet (wie die Kontakte): ein Neubau unter dem Mauszeiger
  // würde den ersten Klick verschlucken (mousedown → Fokusverlust → Neubau → mouseup
  // auf einem neuen Knoten = kein click). Handler lesen frisch aus dem Store.
  const gwZeilen = new Map();   // id → { z, art, nam, hoch, runter }
  const gwFrisch = (id) => (store.state.gewerke || []).find((x) => x.id === id);

  function gewerkZeile(g) {
    const z = el('div', 'tb-verw-z ein-gw-z');
    z.dataset.id = g.id;
    const farbe = el('span', 'ein-gw-farbe');
    farbe.setAttribute('aria-hidden', 'true');
    const nam = el('input', 'tb-verw-n ein-gw-n');
    nam.setAttribute('aria-label', 'Name');
    nam.addEventListener('change', () => {
      const r = send({ type: 'setGewerkField', id: g.id, field: 'name', value: nam.value });
      // Abgelehnt (leer, doppelt): das Feld zeigt wieder, was im Store steht.
      if (r && r.ok === false) nam.value = (gwFrisch(g.id) || g).name;
    });
    const hoch = el('button', 'tb-verw-b ein-gw-hoch', '↑');
    hoch.type = 'button'; hoch.title = 'Nach oben';
    const runter = el('button', 'tb-verw-b ein-gw-runter', '↓');
    runter.type = 'button'; runter.title = 'Nach unten';
    const weg = el('button', 'tb-verw-b tb-verw-x ein-gw-x', '×');
    weg.type = 'button'; weg.title = 'Löschen (fragt nach, ⌘Z holt es zurück)';
    weg.onclick = () => loescheGewerk?.(g.id);
    const rec = { z, nam, hoch, runter, farbe };
    hoch.onclick = () => verschiebe(artOf(gwFrisch(g.id) || g), g.id, -1);
    runter.onclick = () => verschiebe(artOf(gwFrisch(g.id) || g), g.id, 1);
    z.append(farbe, nam, hoch, runter, weg);
    gwZeilen.set(g.id, rec);
    return rec;
  }

  function zeichneGewerke() {
    const alleIds = new Set((store.state.gewerke || []).map((g) => g.id));
    for (const [id, r] of gwZeilen) if (!alleIds.has(id)) { r.z.remove(); gwZeilen.delete(id); }
    for (const [art, { liste }] of Object.entries(gwListen)) {
      const eigene = sortiert().filter((g) => artOf(g) === art);
      if (art === 'buehne') liste.hidden = !eigene.length;
      liste.querySelector('.tb-verw-leer')?.remove();
      eigene.forEach((g, i) => {
        const r = gwZeilen.get(g.id) || gewerkZeile(g);
        if (liste.children[i] !== r.z) liste.insertBefore(r.z, liste.children[i] || null);
        r.farbe.style.setProperty('--gw', gewerkVar(g.slot));
        if (gewerkTexture(g.slot)) r.farbe.dataset.tex = '1'; else delete r.farbe.dataset.tex;
        if (document.activeElement === r.nam) aufgeschoben = true;
        else if (r.nam.value !== g.name) r.nam.value = g.name;
        r.hoch.disabled = i === 0;
        r.runter.disabled = i === eigene.length - 1;
      });
      if (!eigene.length && art === 'gewerk') liste.append(el('div', 'tb-verw-leer', 'Noch kein Gewerk.'));
    }
  }

  function baueGewerke() {
    const knopf = (id, text, art) => {
      const b = el('button', 'btn', text);
      b.type = 'button';
      b.id = id;
      b.onclick = () => neuGewerk?.(b, art);
      return b;
    };
    const gruppe = (art, titel, add) => {
      const box = el('div', 'ein-gruppe ein-gw-gruppe');
      const liste = el('div', 'ein-liste ein-gw-liste');
      liste.dataset.art = art;
      gwListen[art] = { box, liste };
      box.append(el('h3', 'ei-h', titel), liste, add);
      return box;
    };
    gwHost.append(
      gruppe('gewerk', 'Gewerke', knopf('add-gewerk', '+ Gewerk', 'gewerk')),
      gruppe('buehne', 'Bühnen (Showablauf)', knopf('add-buehne', '+ Bühne', 'buehne')),
      el('p', 'ei-hint', 'Die Farbe gehört dem Gewerk und bleibt beim Sortieren. Rechtsklick im Plan geht weiter: dort auch «Vorgang hinzufügen».'),
    );
  }

  // ── Bereiche «Personal & Maschinen» und «Arten & Abschnitte»: eingebettete Auswahllisten ──
  const listen = [];            // { container, refresh }
  function einbetten(host, { titel, liste, kind, leerText, add }) {
    const box = el('div', 'ein-gruppe ein-liste-gruppe');
    const container = el('div', 'ein-liste');
    container.dataset.liste = liste;
    if (kind) container.dataset.kind = kind;
    const a = el('button', 'btn', add.text);
    a.type = 'button';
    a.id = add.id;
    a.onclick = () => neuFragen?.(add.opt, a, () => {});
    box.append(el('h3', 'ei-h', titel), a, container);
    host.append(box);
    const m = mountAuswahlListe(container, { store, send, liste, kind, leerText });
    listen.push({ container, liste, refresh: m.refresh, sig: null });
  }

  function baueListen() {
    einbetten(resHost, { titel: 'Personal', liste: 'ressourcen', kind: 'personal', leerText: 'Noch kein eigenes Personal.',
      add: { id: 'ei-res-personal', text: '+ Personal', opt: resNeuOpt('personal') } });
    einbetten(resHost, { titel: 'Maschinen', liste: 'ressourcen', kind: 'maschine', leerText: 'Noch keine eigene Maschine.',
      add: { id: 'ei-res-maschine', text: '+ Maschine', opt: resNeuOpt('maschine') } });
    resHost.append(el('p', 'ei-hint', 'Zugewiesen wird am Vorgang — im Panel oder in der Tabelle, Spalte «Ressourcen». Die eingebauten Helfer und Maschinen (🔒) sind fest; eigene legst du mit Kategorie an.'));
    einbetten(artenHost, { titel: 'Arten der Zeiteinträge', liste: 'punktTypen', leerText: 'Noch keine eigene Art.',
      add: { id: 'ein-art-add', text: '+ Art', opt: { titel: 'Neue Art', kompaktFeld: true, cmd: { type: 'addPunktTyp' } } } });
    einbetten(artenHost, { titel: 'Abschnitte', liste: 'abschnitte', leerText: 'Noch kein eigener Abschnitt.',
      add: { id: 'ein-abschnitt-add', text: '+ Abschnitt', opt: { titel: 'Neuer Abschnitt', cmd: { type: 'addAbschnitt' } } } });
    artenHost.append(el('p', 'ei-hint', 'Hier stehen deine eigenen Einträge; die eingebauten bleiben immer. Anlegen geht auch mitten im Tippen: «+ Neu…» im Auswahlfeld der Tabelle.'));
  }

  function zeichneListen() {
    for (const l of listen) {
      // Im Namensfeld wird gerade getippt: nicht unter dem Cursor austauschen.
      if (document.activeElement?.tagName === 'INPUT' && l.container.contains(document.activeElement)) { aufgeschoben = true; continue; }
      // Nur neu zeichnen, wenn sich der Inhalt der Liste (oder ihre Benutzung) geändert hat.
      const lst = store.state.project[l.liste] || [];
      const sig = JSON.stringify([lst, lst.map((x) => benutztVon(store.state, l.liste, x.id))]);
      if (sig === l.sig) continue;
      l.sig = sig;
      l.refresh();
    }
  }

  // ── Zeichnen ──
  function refresh() {
    if (!offen) return;       // open() zeichnet selbst
    aufgeschoben = false;
    const st = einrichtStatus(store.state);
    titel.textContent = '⚙ Einrichten — ' + (projekt().name || '');
    for (const b of navBtns) {
      const s = st[b.dataset.ein];
      const mark = b.querySelector('.ein-st');
      if (!s || !mark) continue;
      mark.className = 'ein-st ein-st-' + s;
      mark.textContent = ZEICHEN[s];
      mark.title = STATUS_TITEL[s];
      mark.setAttribute('aria-label', STATUS_TITEL[s]);
    }
    // Werte an Ort und Stelle; das Feld mit dem Cursor bleibt unberührt.
    for (const [f, inp] of Object.entries(felder)) {
      if (document.activeElement === inp) { aufgeschoben = true; continue; }
      const v = projekt()[f] ?? '';
      if (inp.value !== v) inp.value = v;
    }
    zeichneKontakte();
    zeichneZeitraum();
    zeichneGewerke();
    zeichneListen();
    zeichneSchritt();
  }

  // Erstes Einrichten: «Zurück»/«Weiter» am Fuß, «Fertig» statt «Zum Plan» im letzten Schritt.
  function zeichneSchritt() {
    const i = BEREICHE.indexOf(bereich), letzter = i === BEREICHE.length - 1;
    root.classList.toggle('ein-erst', erst);
    zurueck.disabled = i <= 0;
    // Schritt 1 ohne Namen: weiter geht es nicht (alle anderen Schritte sind frei).
    weiter.disabled = i === 0 && !(projekt().name || '').trim();
    weiter.hidden = letzter;
    zu.textContent = erst && letzter ? 'Fertig' : zuText;
  }

  function zeigeBereich(name) {
    bereich = name;
    zeichneSchritt();
    for (const b of navBtns) b.setAttribute('aria-pressed', String(b.dataset.ein === name));
    for (const s of sektionen) s.hidden = s.dataset.einTab !== name;
    onBereich?.(name);
  }

  navBtns.forEach((b) => { b.onclick = () => zeigeBereich(b.dataset.ein); });
  zu.onclick = () => onZu?.();
  const schritt = (d) => zeigeBereich(BEREICHE[Math.max(0, Math.min(BEREICHE.length - 1, BEREICHE.indexOf(bereich) + d))]);
  zurueck.onclick = () => schritt(-1);
  weiter.onclick = () => schritt(1);
  // Was beim Tippen aufgeschoben wurde, nachholen, sobald der Fokus das Feld verlässt
  // (erst im nächsten Tick: `activeElement` ist während focusout noch das alte Feld).
  root.addEventListener('focusout', () => { if (aufgeschoben) setTimeout(refresh, 0); });

  baueFormular();
  baueZeitraum();
  baueGewerke();
  baueListen();
  refresh();

  return {
    open(name = 'projekt', opt = {}) {
      offen = true;
      erst = !!opt.erst;
      root.hidden = false;
      refresh();
      zeigeBereich(BEREICHE.includes(name) ? name : 'projekt');
      zu.focus();
    },
    close() {
      offen = false;
      erst = false;
      root.classList.remove('ein-erst');
      root.hidden = true;
    },
    refresh,
    get offen() { return offen; },
    get bereich() { return bereich; },
    get erst() { return erst; },
  };
}
