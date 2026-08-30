// ── Tabellen-Editor ───────────────────────────────────────────────────────────
// Der schnelle Weg rein. Tippen schlägt Ziehen, wenn 40 Vorgänge erstmalig
// anzulegen sind.
//
// Enter = neue Zeile darunter · Tab = nächstes Feld · ⌫ auf leerem Namen = weg.
// Dauer als Kurzform («4h», «2t», «90m») — das Ende rechnet sich; das Ende
// bearbeiten rechnet die Dauer zurück.

import { parseDuration, fmtDuration, local, mitUhrzeit, endeNachStart } from './conflicts.js';
import { toMin, toDate, byStart } from './schedule.js';
import { gewerkVar, gewerkTexture } from './palette.js';
import { el, toInput, STATUS } from './dom.js';
import { sichtGewerke, punktTypen, abschnitte, abschnittLabel, amTag, imAbschnitt } from './ebene.js';

// Die Spalten hängen an der Ebene (js/ebene.js). Sie stehen an EINER Stelle und
// bestimmen zugleich die Breite der Gruppenköpfe — zwei Listen liefen sonst
// auseinander und der Kopf säße schief.
//
// Der Showablauf trägt vier Spalten mehr: Typ, Soundcheck, Kontakt und die
// beiden Freitexte, die beim Anlegen des Zeitstrahls direkt mitgetippt werden.
const SPALTEN = {
  bau: [['Gewerk', 'c-gw'], ['Vorgang', 'c-title'], ['Start', 'c-start'],
    ['Dauer', 'c-dur'], ['Ende', 'c-end'], ['Crew', 'c-crew'], ['Status', 'c-st'], ['', 'c-act']],
  show: [['Bühne', 'c-gw'], ['Zeiteintrag', 'c-title'], ['Abschnitt', 'c-abs'], ['Typ', 'c-typ'], ['Start', 'c-start'],
    ['Dauer', 'c-dur'], ['Ende', 'c-end'], ['Kontakt', 'c-kon'],
    ['Anforderungen', 'c-anf'], ['Material', 'c-mat'], ['Status', 'c-st'], ['', 'c-act']],
};

export function createTable(root, { store, onConflicts, onHinweis } = {}) {
  root.classList.add('tb');
  let conflicts = new Map();
  // Welche Ebene die Tabelle zeigt. Anzeige-Zustand wie `collapsed` — die App
  // setzt ihn über setEbene(), die Tabelle entscheidet ihn nicht selbst.
  let ebene = 'bau';
  let ausBlend = new Set();
  let tag = null;         // Showablauf: der gezeigte Kalendertag (null = alle)
  let abschnitt = 'alle'; // Showablauf: Setup, Show oder beides
  // Eingeklappte Elternvorgänge (deren Untervorgänge verborgen sind). Tabellen-
  // eigener Anzeige-Zustand — kein Store-Belang, überlebt das render() hier.
  const collapsed = new Set();

  function render() {
    // Kommt dieser Aufbau aus einem Feld, in dem gerade getippt wird? Dann
    // später — sonst reißt er dem Cursor die Eingabe weg. Siehe `commitOn`.
    //
    // Bewusst NICHT zusätzlich gegen `document.activeElement` geprüft: Firefox
    // hat den Fokus beim `change` eines `type="time"` bereits abgegeben, der
    // Vergleich war immer falsch und der Schutz damit wirkungslos. Ob wirklich
    // noch jemand im Feld steht, entscheidet `commitOn` nach dem Befehl — dort
    // ist der Fokus verlässlich zu lesen.
    if (sendendesFeld) {
      nachholen = true;
      return;
    }
    const S = store.state;
    const scrollTop = root.scrollTop;
    root.replaceChildren();

    const table = el('table', 'tb-t');
    // Eigener Attributname: `data-ebene` gehört dem Umschalter in der Kopfzeile.
    // Mit demselben Namen setzte app.js hier ein `aria-pressed` auf die Tabelle,
    // und jeder Selektor auf den Umschalter traf zwei Knoten.
    table.dataset.tbEbene = ebene;
    const spalten = SPALTEN[ebene] || SPALTEN.bau;
    const breite = spalten.length;
    const thead = el('thead');
    const hr = el('tr');
    for (const [label, cls] of spalten) hr.append(el('th', cls, label));
    thead.append(hr);
    table.append(thead);

    const tbody = el('tbody');
    const gewerke = sichtGewerke(S, ebene, ausBlend);

    for (const g of gewerke) {
      // Denselben Tagesausschnitt wie der Gantt — sonst zeigt derselbe Plan in
      // zwei Ansichten zwei verschiedene Tage.
      // Denselben Ausschnitt wie der Gantt: Abschnitt, dann Tag.
      let all = S.tasks.filter((t) => t.gewerk === g.id);
      if (ebene === 'show') all = amTag(imAbschnitt(all, abschnitt), tag);
      const tops = all.filter((t) => t.parent == null).sort(byStart);
      const kidsOf = (id) => all.filter((t) => t.parent === id).sort(byStart);

      // Gruppenkopf — ziehbar zum Umsortieren (data-gewerk + Griff)
      const gr = el('tr', 'tb-group');
      gr.dataset.gewerk = g.id;
      const gc = el('td');
      gc.colSpan = breite;
      const grip = el('span', 'tb-drag', '⠿');
      grip.title = ebene === 'show' ? 'Ziehen, um die Bühne umzusortieren' : 'Ziehen, um das Gewerk umzusortieren';
      grip.setAttribute('aria-hidden', 'true');
      const dot = el('span', 'bz-dot');
      dot.style.setProperty('--gw', gewerkVar(g.slot));
      if (gewerkTexture(g.slot)) dot.dataset.tex = '1';
      const wort = ebene === 'show'
        ? (all.length === 1 ? ' Zeiteintrag' : ' Zeiteinträge')
        : (all.length === 1 ? ' Vorgang' : ' Vorgänge');
      gc.append(grip, dot, el('span', 'tb-gname', g.name), el('span', 'tb-gcount', all.length + wort));
      // Im Showablauf ein PRIMÄRKNOPF. Der randlose Text sah aus wie eine
      // Beschriftung, nicht wie ein Knopf. Im Bauzeitenplan bleibt er schlicht:
      // dort stehen 20 Gewerke untereinander, 20 Primärknöpfe wären eine Wand.
      const add = el('button', ebene === 'show' ? 'tb-add btn btn-p' : 'tb-add',
        ebene === 'show' ? '+ Zeiteintrag' : '+ Vorgang');
      add.onclick = () => addRow(g.id, tops[tops.length - 1]);
      gc.append(add);
      gr.append(gc);
      tbody.append(gr);

      // Erst die obersten Vorgänge (nach Start), darunter je Elternvorgang seine
      // Untervorgänge — eingerückt und einklappbar.
      for (const t of tops) {
        const kids = kidsOf(t.id);
        tbody.append(row(t, gewerke, { kids: kids.length }));
        if (kids.length && !collapsed.has(t.id)) {
          for (const k of kids) tbody.append(row(k, gewerke, { child: true }));
        }
      }
      if (!tops.length) {
        const er = el('tr', 'tb-empty');
        const ec = el('td'); ec.colSpan = breite;
        ec.textContent = 'Noch nichts eingetragen.';
        er.append(ec); tbody.append(er);
      }
    }

    // Ohne ein einziges Band ist die Tabelle kein Editor, sondern eine leere
    // Seite ohne Ausweg. Im Showablauf ist das der Normalfall beim ersten
    // Öffnen — die Bühne muss erst angelegt werden.
    if (!gewerke.length) {
      const er = el('tr', 'tb-empty');
      const ec = el('td'); ec.colSpan = breite;
      ec.textContent = ebene === 'show'
        ? 'Noch keine Bühne angelegt.'
        : 'Noch kein Gewerk angelegt.';
      er.append(ec); tbody.append(er);
    }

    // Projekt-Meilensteine. Sie gehören zum Bauzeitenplan; im Showablauf hat der
    // Tag seine eigenen Marken (Doors, Show-Ende).
    const proj = ebene === 'bau' ? S.tasks.filter((t) => t.gewerk === 'projekt').sort(byStart) : [];
    if (proj.length) {
      const gr = el('tr', 'tb-group');
      const gc = el('td'); gc.colSpan = breite;
      gc.append(el('span', 'tb-gname', 'Zieltermine'));
      gr.append(gc); tbody.append(gr);
      for (const t of proj) tbody.append(row(t, gewerke));
    }

    table.append(tbody);
    root.append(table);
    root.scrollTop = scrollTop;
  }

  function row(t, gewerke, opts = {}) {
    const { kids = 0, child = false } = opts;
    const isParent = kids > 0;                 // Sammelvorgang mit Untervorgängen
    const tr = el('tr', 'tb-r');
    tr.dataset.id = t.id;
    if (child) tr.classList.add('is-child');
    if (isParent) tr.classList.add('is-parent');
    const conf = conflicts.get(t.id);
    if (conf) tr.classList.add('is-conflict');
    if (t.milestone) tr.classList.add('is-ms');

    // ── Gewerk ──
    const gw = el('td', 'c-gw');
    if (child) {
      // Ein Untervorgang erbt das Gewerk des Elternvorgangs — keine Auswahl,
      // nur eine Einrückungsmarke.
      gw.append(el('span', 'tb-submark', '↳'));
    } else if (t.gewerk === 'projekt') {
      gw.append(el('span', 'tb-fixed', 'Projekt'));
    } else {
      const sel = el('select');
      for (const g of gewerke) {
        const o = el('option', null, g.name);
        o.value = g.id;
        if (g.id === t.gewerk) o.selected = true;
        sel.append(o);
      }
      sel.onchange = () => send({ type: 'setTaskField', id: t.id, field: 'gewerk', value: sel.value });
      gw.append(sel);
    }
    tr.append(gw);

    // ── Vorgang ──
    const ti = el('td', 'c-title');
    // Elternvorgang: Ein-/Ausklapp-Pfeil vor dem Namen.
    if (isParent) {
      const tog = el('button', 'tb-tog', collapsed.has(t.id) ? '▸' : '▾');
      tog.title = collapsed.has(t.id) ? 'Untervorgänge zeigen' : 'Untervorgänge einklappen';
      tog.setAttribute('aria-label', tog.title);
      tog.onclick = () => { collapsed.has(t.id) ? collapsed.delete(t.id) : collapsed.add(t.id); render(); };
      ti.append(tog);
    }
    const tin = el('input');
    tin.value = t.title;
    tin.setAttribute('aria-label', 'Vorgangsname');
    commitOn(tin, () => {
      const now = cur(t.id);
      if (!now) return;
      const v = tin.value.trim();
      if (v === now.title) return;
      if (!v) { tin.value = now.title; return; }
      send({ type: 'setTaskField', id: t.id, field: 'title', value: v });
    });
    tin.onkeydown = (e) => {
      // Enter legt die nächste Zeile auf DERSELBEN Ebene an: unter einem Kind ein
      // Geschwister-Kind, sonst einen normalen Vorgang.
      if (e.key === 'Enter') {
        e.preventDefault(); tin.blur();
        if (child) addSub(t.parent, t); else addRow(t.gewerk, t);
      }
      if (e.key === 'Backspace' && !tin.value && t.gewerk !== 'projekt') {
        e.preventDefault();
        send({ type: 'removeTask', id: t.id });
      }
    };
    ti.append(tin);
    if (conf) {
      const w = el('span', 'tb-conf', conf.message);
      ti.append(w);
    }
    tr.append(ti);

    // ── Abschnitt (nur Showablauf) ──
    // Setup läuft bis zum Showstart, Show danach. Zwei Abläufe auf DERSELBEN
    // Bühne — deshalb hängt das Feld am Eintrag, nicht am Band.
    if (ebene === 'show') {
      const ab = el('td', 'c-abs');
      const asel = el('select');
      // Der gespeicherte Wert, nicht der gefilterte: ein eigener Abschnitt wie
      // «Load-in» soll in seiner Zeile stehen bleiben und nicht als «Show»
      // erscheinen, nur weil die ANSICHT ihn dorthin zählt.
      const jetztAbs = t.abschnitt || 'show';
      for (const [v, label] of abschnitte(store.state)) {
        const o = el('option', null, label);
        o.value = v;
        if (v === jetztAbs) o.selected = true;
        asel.append(o);
      }
      const atrenner = el('option', null, '─────────');
      atrenner.disabled = true;
      const aneu = el('option', null, 'Neu');
      aneu.value = NEUE_ART;
      asel.append(atrenner, aneu);

      asel.setAttribute('aria-label', 'Abschnitt');
      asel.onchange = () => {
        if (asel.value === NEUE_ART) {
          asel.value = jetztAbs;
          neuFragen(asel, { titel: 'Neuer Abschnitt', cmd: { type: 'addAbschnitt' } }, (id) =>
            waehleAbschnitt(t.id, id));
          return;
        }
        waehleAbschnitt(t.id, asel.value);
      };
      ab.append(asel);
      tr.append(ab);
    }

    // ── Typ (nur Showablauf) ──
    // Steuert allein die Darstellung und die Live-Ansage: ein Changeover wird
    // als «Umbau» angesagt, nicht als Act. An den Zeiten ändert er nie etwas.
    if (ebene === 'show') {
      const ty = el('td', 'c-typ');
      const tsel = el('select');
      const jetzt = t.punktTyp || 'act';
      // Eingebaute UND selbst angelegte — punktTypen() führt beide zusammen.
      for (const [v, label] of punktTypen(store.state)) {
        const o = el('option', null, label);
        o.value = v;
        if (v === jetzt) o.selected = true;
        tsel.append(o);
      }
      // Anlegen dort, wo man ohnehin steht. Der Trenner davor macht sichtbar,
      // dass es keine Art ist, sondern eine Handlung.
      const trenner = el('option', null, '─────────');
      trenner.disabled = true;
      const neu = el('option', null, 'Neu');
      neu.value = NEUE_ART;
      tsel.append(trenner, neu);

      tsel.setAttribute('aria-label', 'Art des Zeiteintrags');
      tsel.onchange = () => {
        if (tsel.value === NEUE_ART) {
          // Auswahl SOFORT zurückstellen: bricht der Benutzer ab, stünde sonst
          // «Neu» als scheinbarer Wert in der Zeile.
          tsel.value = jetzt;
          neuFragen(tsel, { titel: 'Neue Art', kompaktFeld: true, cmd: { type: 'addPunktTyp' } },
            (id) => send({ type: 'setTaskField', id: t.id, field: 'punktTyp', value: id }));
          return;
        }
        send({ type: 'setTaskField', id: t.id, field: 'punktTyp', value: tsel.value });
      };
      ty.append(tsel);
      tr.append(ty);
    }

    // ── Start ──
    // Im Showablauf OHNE Datum: der Tag steht oben im Umschalter, und zwei
    // Spalten à 205 px für eine Information, die schon dasteht, drängen die
    // Anforderungen aus dem Bild. Im Bauzeitenplan bleibt es datiert — der läuft
    // über vierzehn Tage.
    const nurZeit = ebene === 'show';
    const st = el('td', 'c-start');
    const sin = el('input');
    sin.type = nurZeit ? 'time' : 'datetime-local';
    sin.value = nurZeit ? String(t.start).slice(11, 16) : toInput(t.start);
    sin.setAttribute('aria-label', 'Start');
    // Sammelvorgang: Start/Dauer/Ende sind die Hülle der Untervorgänge — nur lesen.
    if (isParent) { sin.disabled = true; sin.title = 'Ergibt sich aus den Untervorgängen'; }
    commitOn(sin, () => {
      const now = cur(t.id);
      if (!now || !sin.value) return;
      // Nur den Zeitteil ersetzen, das Datum behalten: ein Eintrag vom Vortag
      // ist über den Tagesfilter auch am Folgetag sichtbar und spränge sonst.
      const start = nurZeit ? mitUhrzeit(now.start, sin.value) : sin.value;
      if (!start || start === now.start) return;
      const dur = toMin(now.end) - toMin(now.start);   // Dauer beibehalten
      send({ type: 'moveTask', id: t.id, start, end: local(toDate(toMin(start) + dur)) });
    });
    st.append(sin);
    tr.append(st);

    // ── Dauer ──
    const du = el('td', 'c-dur');
    const din = el('input', 'tb-dur');
    const durMin = toMin(t.end) - toMin(t.start);
    din.value = fmtDuration(durMin);
    din.placeholder = '4h';
    din.setAttribute('aria-label', 'Dauer');
    if (t.milestone || isParent) din.disabled = true;
    commitOn(din, () => {
      const now = cur(t.id);
      if (!now) return;
      const real = toMin(now.end) - toMin(now.start);
      const m = parseDuration(din.value);
      if (m == null || m === 0) {
        din.value = fmtDuration(real);
        din.classList.add('is-bad');
        setTimeout(() => din.classList.remove('is-bad'), 900);
        return;
      }
      if (m === real) return;
      send({ type: 'setTaskField', id: t.id, field: 'end', value: local(toDate(toMin(now.start) + m)) });
    });
    du.append(din);
    tr.append(du);

    // ── Ende ──
    const en = el('td', 'c-end');
    const ein = el('input');
    ein.type = nurZeit ? 'time' : 'datetime-local';
    ein.value = nurZeit ? String(t.end).slice(11, 16) : toInput(t.end);
    ein.setAttribute('aria-label', 'Ende');
    if (t.milestone || isParent) { ein.disabled = true; if (isParent) ein.title = 'Ergibt sich aus den Untervorgängen'; }
    commitOn(ein, () => {
      const now = cur(t.id);
      if (!now || !ein.value) return;
      // «22:00 bis 03:00» meint den Folgetag — sonst lehnte der Store ab.
      const ende = nurZeit ? endeNachStart(now.start, ein.value) : ein.value;
      if (!ende || ende === now.end) return;
      send({ type: 'setTaskField', id: t.id, field: 'end', value: ende });
    });
    en.append(ein);
    tr.append(en);

    if (ebene === 'show') {
      // ── Kontakt · Anforderungen · Material ──
      // Drei Freitexte, die beim Anlegen des Zeitstrahls direkt mitgetippt
      // werden. Sie gehen denselben Weg wie jedes andere Feld: über den Store,
      // also mit ⌘Z, Auto-Save und JSON-Export.
      //
      // OHNE Platzhaltertext. Ein «z. B. 2× Wedge» in siebzehn Zeilen sieht aus
      // wie siebzehnmal eingetragener Inhalt — auf dem ersten Probebild war
      // SIDOs echtes «1 Riser 2×1 m» zwischen den Beispielen nicht zu finden.
      // Was die Spalte will, sagt ihre Überschrift.
      for (const [feld, cls, aria] of [
        ['kontakt', 'c-kon', 'Kontakt'],
        ['anforderungen', 'c-anf', 'Anforderungen'],
        ['material', 'c-mat', 'Benötigtes Material'],
      ]) {
        const td = el('td', cls);
        const inp = el('input');
        inp.value = t[feld] || '';
        inp.setAttribute('aria-label', aria);
        commitOn(inp, () => {
          const now = cur(t.id);
          if (!now || inp.value === (now[feld] || '')) return;
          send({ type: 'setTaskField', id: t.id, field: feld, value: inp.value });
        });
        td.append(inp);
        tr.append(td);
      }
    } else {
      // ── Crew ──
      const cr = el('td', 'c-crew');
      const cin = el('input');
      cin.type = 'number';
      cin.min = '0';
      cin.value = t.crew ?? '';
      cin.setAttribute('aria-label', 'Crew');
      commitOn(cin, () => {
        const now = cur(t.id);
        if (!now) return;
        const v = cin.value === '' ? null : Math.max(0, parseInt(cin.value, 10) || 0);
        if (v === now.crew) return;
        send({ type: 'setTaskField', id: t.id, field: 'crew', value: v });
      });
      cr.append(cin);
      tr.append(cr);
    }

    // ── Status ──
    const stt = el('td', 'c-st');
    const ssel = el('select');
    for (const [v, label] of STATUS) {
      const o = el('option', null, label);
      o.value = v;
      if (v === t.status) o.selected = true;
      ssel.append(o);
    }
    ssel.onchange = () => send({ type: 'setTaskField', id: t.id, field: 'status', value: ssel.value });
    stt.append(ssel);
    tr.append(stt);

    // ── Aktionen ──
    const ac = el('td', 'c-act');
    const msb = el('button', 'tb-ico' + (t.milestone ? ' is-on' : ''), '◆');
    // Ein Sammelvorgang hat eine abgeleitete Dauer und kann keine Raute sein.
    if (isParent) { msb.disabled = true; msb.title = 'Ein Vorgang mit Untervorgängen ist kein Meilenstein'; }
    else msb.title = t.milestone ? 'In einen Vorgang zurückverwandeln' : 'In einen Meilenstein verwandeln';
    msb.onclick = () => {
      if (t.milestone) {
        // Meilenstein → Vorgang: Dauer 0 wäre ungültig, also 2h vorgeben.
        send({ type: 'batch', label: 'Meilenstein aufheben', cmds: [
          { type: 'setTaskField', id: t.id, field: 'end', value: local(toDate(toMin(t.start) + 120)) },
          { type: 'setTaskField', id: t.id, field: 'milestone', value: false },
        ] });
      } else {
        send({ type: 'batch', label: 'Zu Meilenstein', cmds: [
          { type: 'setTaskField', id: t.id, field: 'end', value: t.start },
          { type: 'setTaskField', id: t.id, field: 'milestone', value: true },
        ] });
      }
    };
    const del = el('button', 'tb-ico tb-del', '×');
    del.title = isParent ? 'Vorgang samt Untervorgängen löschen' : 'Vorgang löschen';
    del.onclick = () => send({ type: 'removeTask', id: t.id });
    // „+ Untervorgang" nur auf oberster Ebene (eine Ebene) und nicht bei Zielterminen.
    if (!child && t.gewerk !== 'projekt') {
      const sub = el('button', 'tb-ico tb-subadd', '＋↳');
      sub.title = 'Untervorgang hinzufügen';
      sub.setAttribute('aria-label', 'Untervorgang hinzufügen');
      sub.onclick = () => addSub(t.id, kidsOfLast(t.id));
      ac.append(sub);
    }
    ac.append(msb, del);
    tr.append(ac);
    return tr;
  }

  // Neuen Untervorgang unter `parentId` anlegen: schließt zeitlich an den letzten
  // vorhandenen Untervorgang an (sonst an den Elternstart), 2h Vorgabe. Vor dem
  // Anlegen aufklappen, damit das neue Kind sichtbar ist.
  function addSub(parentId, after) {
    const S = store.state;
    const p = S.tasks.find((t) => t.id === parentId);
    if (!p) return;
    const start = after ? after.end : p.start;
    collapsed.delete(parentId);
    const r = send({
      type: 'addTask',
      task: { gewerk: p.gewerk, parent: parentId, title: 'Untervorgang', start, end: local(toDate(toMin(start) + 120)) },
    });
    if (r && r.id) {
      requestAnimationFrame(() => {
        const inp = root.querySelector(`tr[data-id="${r.id}"] .c-title input`);
        if (inp) { inp.focus(); inp.select(); }
      });
    }
  }

  // Der letzte Untervorgang eines Elternteils (nach Start), an den angeschlossen wird.
  const kidsOfLast = (parentId) =>
    store.state.tasks.filter((t) => t.parent === parentId).sort(byStart).pop();

  // Neue Zeile unter dem letzten Vorgang des Gewerks: schließt zeitlich an,
  // 2h Vorgabe. So tippt man eine Kette runter, ohne Daten einzugeben.
  function addRow(gewerkId, after) {
    const sichtbar = sichtGewerke(store.state, ebene, ausBlend);
    if (gewerkId === 'projekt') gewerkId = sichtbar[0] && sichtbar[0].id;
    if (!gewerkId) return;
    const start = after ? after.end : defaultStart();
    const r = send({
      type: 'addTask',
      task: {
        gewerk: gewerkId,
        title: ebene === 'show' ? 'Neuer Zeiteintrag' : 'Neuer Vorgang',
        start, end: local(toDate(toMin(start) + 120)),
        // Der neue Eintrag gehört in den Abschnitt, den man gerade ansieht —
        // sonst legt man ihn im Setup an und er erscheint in der Show. Bei
        // «alle» ist Show die Vorgabe.
        ...(ebene === 'show' ? { abschnitt: abschnitt === 'setup' ? 'setup' : 'show' } : {}),
      },
    });
    if (r && r.id) {
      requestAnimationFrame(() => {
        const inp = root.querySelector(`tr[data-id="${r.id}"] .c-title input`);
        if (inp) { inp.focus(); inp.select(); }
      });
    }
  }

  function defaultStart() {
    const S = store.state;
    if (ebene === 'show') {
      // Am GEZEIGTEN Tag anschließen, nicht am letzten Punkt des Plans.
      //
      // Vorher wurde über alle Bühnen und alle Tage gesucht: bei zwei Showtagen
      // kam der letzte Punkt des ZWEITEN heraus. Wer am ersten Tag auf einer
      // leeren Bühne etwas anlegte, bekam es an den zweiten gehängt — und der
      // Tagesfilter blendete es sofort wieder aus. Der Knopf tat also etwas,
      // nur unsichtbar, und das fühlte sich an wie «geht nicht».
      const buehnen = sichtGewerke(S, 'show', ausBlend).map((g) => g.id);
      const drin = amTag(imAbschnitt(S.tasks.filter((t) => buehnen.includes(t.gewerk)), abschnitt), tag);
      const letzter = drin.sort(byStart).pop();
      if (letzter) return toInput(letzter.start);
      // Der Tag ist noch leer: morgens anfangen. Ein Setup beginnt um acht,
      // nicht am Projektanfang zwei Wochen vorher.
      if (tag) return tag + 'T08:00';
    }
    const ph = (S.phases || []).find((p) => /aufbau|load/i.test(p.name));
    return toInput(ph ? ph.start : S.project.start);
  }

  let lastError = null;
  function send(cmd) {
    const r = store.apply(cmd);
    if (r && r.ok === false) {
      lastError = r.error;
      if (onConflicts) onConflicts({ error: r.error });
      render();   // abgelehnt → Felder auf den echten Stand zurücksetzen
    }
    return r;
  }

  // NUR 'change', nicht zusätzlich 'blur'. 'change' feuert bei einem Textfeld
  // ohnehin erst beim Verlassen mit geändertem Wert — 'blur' war nicht nur
  // überflüssig, sondern schädlich: das erste 'change' baut die Tabelle neu,
  // der alte Knoten wird abgehängt und feuert DANACH sein 'blur'. Dessen
  // Handler verglich gegen das inzwischen veraltete Aufgabenobjekt aus der
  // Closure und schickte denselben Befehl ein zweites Mal — jede Änderung lag
  // doppelt auf dem Undo-Stapel, ⌘Z wirkte kaputt.
  /**
   * Den Abschnitt eines Eintrags setzen — und sagen, wenn er dadurch aus der
   * gezeigten Ansicht fällt.
   *
   * Die Ansicht filtert nur nach Setup und Show; ein eigener Abschnitt zählt
   * zur Show (`abschnittOf` in ebene.js). Wer im Setup steht und «Load-in»
   * wählt, sähe seinen Eintrag sonst kommentarlos verschwinden — genau der
   * Fehler, der in CLAUDE.md schon einmal steht: «ein im Setup angelegter
   * Eintrag landete in der Show und war im gezeigten Abschnitt sofort
   * unsichtbar». Der Knopf tut etwas, nur unsichtbar, und das fühlt sich an wie
   * «geht nicht».
   */
  function waehleAbschnitt(id, wert) {
    const r = send({ type: 'setTaskField', id, field: 'abschnitt', value: wert });
    if (!r || r.ok === false) return;
    const wo = wert === 'setup' ? 'setup' : 'show';
    if (onHinweis && abschnitt !== 'alle' && abschnitt !== wo) {
      onHinweis('«' + abschnittLabel(wert, store.state) + '» steht in der '
        + (wo === 'setup' ? 'Setup' : 'Show') + '-Ansicht.');
    }
  }

  // ── Selbst angelegte Auswahlwerte ───────────────────────────────────────────
  // Eintragsarten und Abschnitte gehen denselben Weg: angelegt wird dort, wo man
  // ohnehin steht — im Auswahlfeld der Zeile, beim Anlegen einer neuen Zeile.
  // Ein eigener Verwaltungsort wäre zwei Klicks weiter weg.
  const NEUE_ART = '__neu__';

  /**
   * Fragt einen Namen ab und legt den Wert an. Ruft `fertig(id)` nur, wenn der
   * Store ihn angenommen hat.
   *
   * @param {HTMLElement} anker   Auswahlfeld, an dem der Kasten ausgerichtet wird
   * @param {object} opt          { titel, kompaktFeld, cmd }
   * @param {(id:string)=>void} fertig
   *
   * Hängt an `document.body`, nicht in die Tabelle: ein `render()` würde es
   * sonst mitten in der Eingabe wegräumen.
   */
  function neuFragen(anker, opt, fertig) {
    document.querySelector('.tb-neuart')?.remove();
    const box = el('div', 'tb-neuart');

    // Eine Überschrift statt eines Platzhalters im Feld: ein Beispielwort IM
    // Feld sieht aus wie ein eingetragener Wert. Was das Feld will, sagt die
    // Beschriftung darüber — dieselbe Regel wie bei den Freitextspalten.
    box.append(el('div', 'tb-neuart-h', opt.titel));

    const feld = el('input', 'tb-neuart-n');
    feld.setAttribute('aria-label', opt.titel);

    // Nur die Eintragsart kennt das Blattverhalten. Ein Abschnitt bestimmt
    // keine Zeilenhöhe — dort wäre das Häkchen eine Frage ohne Wirkung.
    let hk = null;
    if (opt.kompaktFeld) {
      hk = el('input');
      hk.type = 'checkbox';
      const lab = el('label', 'tb-neuart-k');
      lab.append(hk, el('span', null, 'tritt auf dem Blatt zurück, wie ein Changeover'));
      lab.title = 'Wie ein Changeover: niedrigere Zeile auf dem A3-Blatt, damit mehr Platz für die Acts bleibt.';
      box.append(feld, lab);
    } else {
      box.append(feld);
    }

    const ok = el('button', 'btn btn-p', 'Anlegen');
    const ab = el('button', 'btn', 'Abbrechen');
    const reihe = el('div', 'tb-neuart-a');
    reihe.append(ab, ok);
    box.append(reihe);
    document.body.append(box);

    const zu = () => {
      box.remove();
      window.removeEventListener('keydown', aufTaste, true);
      document.removeEventListener('pointerdown', aussen, true);
    };
    const aufTaste = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); zu(); }
      else if (e.key === 'Enter' && box.contains(e.target)) { e.preventDefault(); anlegen(); }
    };
    const aussen = (e) => { if (!box.contains(e.target)) zu(); };
    function anlegen() {
      const r = send({ ...opt.cmd, label: feld.value, kompakt: hk ? hk.checked : undefined });
      // Abgelehnt (leer oder doppelt): stehen lassen, der Fehler steht schon
      // oben. Sonst verschwände die Eingabe kommentarlos.
      if (!r || r.ok === false) { feld.focus(); feld.select(); return; }
      zu();
      fertig(r.id);
    }
    ok.onclick = anlegen;
    ab.onclick = zu;
    window.addEventListener('keydown', aufTaste, true);
    document.addEventListener('pointerdown', aussen, true);

    // Am Auswahlfeld ausrichten, am Rand umklappen — wie das Kontextmenü.
    const a = anker.getBoundingClientRect();
    const r = box.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(a.left, window.innerWidth - r.width - 8)) + 'px';
    box.style.top = (a.bottom + r.height > window.innerHeight - 8
      ? Math.max(8, a.top - r.height - 4) : a.bottom + 4) + 'px';
    feld.focus();
  }

  // ── Tippen überlebt den Neuaufbau ───────────────────────────────────────────
  // `render()` baut die Tabelle mit replaceChildren neu auf. Wer gerade in einem
  // Feld tippt, verliert dabei den Fokus — sein Knoten existiert nicht mehr.
  //
  // Bei Textfeldern fällt das nicht auf: ihr `change` kommt erst beim Verlassen.
  // Bei `<input type="time">` im Showablauf schon: es feuert, sobald ein
  // VOLLSTÄNDIGER Wert dasteht, und das Feld ist vorbelegt — also bereits nach
  // der getippten Stunde. Aus «0930» wurde so «08:09».
  //
  // Deshalb: einen Neuaufbau, den das fokussierte Feld SELBST ausgelöst hat,
  // aufschieben, bis der Fokus dieses Feld verlässt. Die Einschränkung auf das
  // auslösende Feld ist wesentlich — sonst verschluckte die Tabelle auch ein ⌘Z
  // oder eine Änderung aus dem Panel, während der Cursor zufällig irgendwo
  // steht, und zeigte stumm Veraltetes.
  let sendendesFeld = null;    // Feld, dessen change gerade einen Befehl schickt
  let nachholen = false;       // ein Aufbau wurde aufgeschoben

  function commitOn(input, fn) {
    input.addEventListener('change', () => {
      sendendesFeld = input;
      // `send()` läuft synchron bis in `render()` hinein — der Merker muss
      // danach wieder weg, auch wenn der Befehl unterwegs wirft.
      try { fn(); } finally { sendendesFeld = null; }
      // Aufgeschoben, obwohl hier gar niemand mehr tippt? Das ist der Fall beim
      // Verlassen per Tab oder Klick: `change` feuert, der Fokus ist schon
      // weiter, und ein `focusout` kommt nicht mehr — die Tabelle bliebe auf
      // altem Stand stehen.
      //
      // Erst im nächsten Tick prüfen, NICHT sofort: Firefox meldet während des
      // `change` eines `type="time"` kurzzeitig `body` als aktives Element,
      // obwohl der Cursor im Feld bleibt. Sofort geprüft hielt diese Absicherung
      // jedes Tippen für ein Verlassen und baute die Tabelle doch neu auf — sie
      // hat den Fehler, den sie absichern sollte, selbst wieder eingeführt.
      setTimeout(() => {
        if (!nachholen || document.activeElement === input) return;
        nachholen = false;
        render();
      }, 0);
    });
  }

  // Wo steht der Fokus? Als Kennung aus Zeile und Spalte, nicht als Knoten:
  // nach dem Neuaufbau gibt es den alten Knoten nicht mehr.
  function fokusJetzt() {
    const a = document.activeElement;
    if (!a || !root.contains(a)) return null;
    const tr = a.closest('tr[data-id]'), td = a.closest('td');
    return tr && td ? { id: tr.dataset.id, cls: td.className } : null;
  }

  function fokusZurueck(k) {
    if (!k) return;
    const feld = root.querySelector(`tr[data-id="${CSS.escape(k.id)}"] td.${k.cls.split(' ')[0]} input, `
      + `tr[data-id="${CSS.escape(k.id)}"] td.${k.cls.split(' ')[0]} select`);
    if (feld) feld.focus();
  }

  // Aufgeschobenes nachholen, sobald der Fokus kein Eingabefeld der Tabelle mehr
  // ist. Delegation auf root, damit der Handler jeden Neuaufbau überlebt.
  // Das setTimeout ist nötig, weil `document.activeElement` während focusout
  // noch das alte Feld ist — der neue Fokus steht erst danach fest.
  root.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!nachholen) return;
      const k = fokusJetzt();
      // Weitergetabbt in ein anderes Feld derselben Tabelle: jetzt neu zeichnen
      // (sonst stünde dort eine veraltete Dauer) und den Fokus mitnehmen.
      nachholen = false;
      render();
      fokusZurueck(k);
    }, 0);
  });

  // Immer den aktuellen Stand aus dem Store lesen, nie den aus der Closure.
  // Der Knoten kann längst abgehängt sein, wenn sein Ereignis eintrifft.
  const cur = (id) => store.state.tasks.find((x) => x.id === id);

  // ── Gewerke per Drag umsortieren (nur Gruppenköpfe) ──────────────────────────
  // Delegation auf root, damit die Handler ein render() überleben. Während des
  // Ziehens ändert sich der Store NICHT → kein Re-Render, die Knoten bleiben
  // stabil. Erst beim Loslassen geht EIN moveGewerk raus; der Store renummeriert
  // sort (slot/Farbe bleibt) und die Tabelle zeichnet sich in neuer Reihenfolge.
  let drag = null;   // { id }
  const groupRows = () => [...root.querySelectorAll('tr.tb-group[data-gewerk]')];
  const clearMarks = () => root.querySelectorAll('.is-dragging, .is-drop-before, .is-drop-end')
    .forEach((n) => n.classList.remove('is-dragging', 'is-drop-before', 'is-drop-end'));
  // Zielposition unter dem Zeiger: vor das erste Gewerk, dessen Mitte unter der
  // Zeigerhöhe liegt — sonst ans Ende (null).
  const dropBeforeAt = (clientY) => {
    for (const gr of groupRows()) {
      const r = gr.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return gr.dataset.gewerk;
    }
    return null;
  };
  const endDrag = () => { drag = null; clearMarks(); };

  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const handle = e.target.closest('.tb-drag');
    if (!handle) return;
    const gr = handle.closest('tr.tb-group[data-gewerk]');
    if (!gr) return;
    e.preventDefault();
    drag = { id: gr.dataset.gewerk };
    gr.classList.add('is-dragging');
    try { root.setPointerCapture(e.pointerId); } catch (_) { /* egal */ }
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const before = dropBeforeAt(e.clientY);
    root.querySelectorAll('.is-drop-before, .is-drop-end')
      .forEach((n) => n.classList.remove('is-drop-before', 'is-drop-end'));
    if (before) root.querySelector(`tr.tb-group[data-gewerk="${before}"]`)?.classList.add('is-drop-before');
    else groupRows().pop()?.classList.add('is-drop-end');
  });
  root.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const id = drag.id;
    const before = dropBeforeAt(e.clientY);
    endDrag();
    try { root.releasePointerCapture(e.pointerId); } catch (_) { /* egal */ }
    // Nur schicken, wenn es die Reihenfolge wirklich ändert — sonst gäbe der
    // Store ein „Steht schon dort." zurück und würde als Fehler getoastet.
    // Nur die Bänder DIESER Ebene: die Gruppenköpfe zeigen nur sie, und ein
    // Gewerk aus der anderen Ebene als „steht schon dort" mitzuzählen ergäbe
    // eine falsche Nachbarschaft.
    const list = sichtGewerke(store.state, ebene, ausBlend).map((g) => g.id);
    const curBefore = list[list.indexOf(id) + 1] ?? null;
    if (before !== id && before !== curBefore) send({ type: 'moveGewerk', id, before });
  });
  root.addEventListener('pointercancel', endDrag);
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') endDrag(); });

  return {
    render,
    /** Ebene wechseln — die App entscheidet, die Tabelle zeigt. */
    setEbene(name, aus = new Set(), showTag = null, absch = 'alle') {
      ebene = name;
      ausBlend = new Set(aus);
      tag = name === 'show' ? showTag : null;
      abschnitt = name === 'show' ? absch : 'alle';
      collapsed.clear();   // Eingeklapptes der anderen Ebene sagt hier nichts
    },
    get ebene() { return ebene; },
    setConflicts(list) { conflicts = new Map(list.map((c) => [c.taskId, c])); },
    get lastError() { return lastError; },
    focusFirst() {
      const i = root.querySelector('.c-title input');
      if (i) i.focus();
    },
  };
}
