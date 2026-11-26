// ── Mitglieder- und Verwaltungsdialog ─────────────────────────────────────────
// Rendert nur. Die Logik (Liste zusammenführen, Eingaben prüfen, Fehlertexte) steht in
// mitglieder-logik.js. Änderungen an mitglieder/einladungen/users gehen DIREKT an den
// Server (pb), nicht über den Plan-Store: sie sind kein Planinhalt und nicht im Undo.
// Nach jeder Änderung lädt der Dialog seine Liste neu. Den Einladungslink zeigt der
// Dialog nur an — er wird nirgends gespeichert (nicht im Plan, Export oder in der Kopie).
import { el } from './dom.js';
import { gewerkVar, gewerkInkVar, gewerkTexture } from './palette.js';
import { ROLLEN, mitgliederListe, rolleGewerke, einladungPruefen, entfernenInfo, verwaltungListe, leitungSchalterGesperrt, fehlerText } from './mitglieder-logik.js';

const idFilter = (ids) => ids.map((i) => 'id="' + String(i).replace(/[^A-Za-z0-9_-]/g, '') + '"').join(' || ');
const planFilter = (id) => 'plan_id="' + String(id).replace(/["\\]/g, '') + '"';

/** Ein eigenes Overlay (wie askDialog), damit askDialog darüber liegen kann. Escape schließt nur das oberste. */
function overlay(id, beimSchliessen) {
  const dlg = el('div', 'dlg');
  dlg.id = id;
  const box = el('div', 'dlg-box mg-box');
  dlg.append(box);
  const zu = () => { document.removeEventListener('keydown', onKey); dlg.remove(); beimSchliessen?.(); };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    const alle = document.querySelectorAll('.dlg');
    if (alle[alle.length - 1] === dlg) zu();
  };
  dlg.onclick = (e) => { if (e.target === dlg) zu(); };
  document.addEventListener('keydown', onKey);
  document.body.append(dlg);
  return { box, zu };
}

/** Gewerk-Chips (Farbe + Name; Auswahl als aria-pressed). gewaehlt = Set der ids; nurLesen: keine Knöpfe. */
function chips(gewerke, gewaehlt, { nurLesen = false, beiAenderung } = {}) {
  const wrap = el('div', 'mg-chips');
  for (const g of gewerke) {
    const an = gewaehlt.has(g.id);
    if (nurLesen && !an) continue;
    const c = el(nurLesen ? 'span' : 'button', 'mg-chip', g.name);
    if (!nurLesen) c.type = 'button';
    c.dataset.gewerk = g.id;
    c.style.setProperty('--gw', gewerkVar(g.slot ?? 0));
    c.style.setProperty('--gw-ink', gewerkInkVar(g.slot ?? 0));
    if (gewerkTexture(g.slot ?? 0)) c.dataset.tex = '1';
    if (!nurLesen) {
      c.setAttribute('aria-pressed', an ? 'true' : 'false');
      c.title = an ? 'Gewerk entziehen' : 'Gewerk zuweisen';
      c.onclick = () => {
        if (gewaehlt.has(g.id)) gewaehlt.delete(g.id); else gewaehlt.add(g.id);
        c.setAttribute('aria-pressed', gewaehlt.has(g.id) ? 'true' : 'false');
        c.title = gewaehlt.has(g.id) ? 'Gewerk entziehen' : 'Gewerk zuweisen';
        beiAenderung?.();
      };
    } else c.dataset.an = '1';
    wrap.append(c);
  }
  if (!wrap.children.length) wrap.append(el('span', 'mg-leer', 'kein Gewerk'));
  return wrap;
}

function rollenWahl(wert, anzeige) {
  const s = el('select', 'mg-feld mg-rolle');
  for (const r of ROLLEN) { const o = el('option', null, anzeige[r] || r); o.value = r; s.append(o); }
  s.value = wert;
  return s;
}

const knopf = (text, cls, titel) => { const b = el('button', 'btn ' + (cls || ''), text); b.type = 'button'; if (titel) b.title = titel; return b; };
const sicher = (n, an) => { n.disabled = an; return n; };

/**
 * Mitglieder des Plans verwalten.
 * opt: { pb, planId, planName, gewerke:[{id,name,slot}], ich:{id, rolle}, askDialog, toast, rollenAnzeige,
 *        beiSchliessen({ geaendert, selbstEntfernt }) }
 */
export function openMitglieder(opt) {
  const { pb, planId, gewerke, ich, askDialog, toast, rollenAnzeige } = opt;
  const bekannt = gewerke.map((g) => g.id);
  let geaendert = false, selbstEntfernt = false, zu;
  const o = overlay('mg-dlg', () => opt.beiSchliessen?.({ geaendert, selbstEntfernt }));
  const box = o.box; zu = o.zu;
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Mitglieder');

  let letzterLink = null; // { email, link, mail } — nur im Dialog, nie gespeichert
  let hinweis = '';

  async function laden() {
    const [pl, mi, ei] = await Promise.all([
      pb.liste('plaene', planFilter(planId)),
      pb.liste('mitglieder', planFilter(planId)),
      pb.liste('einladungen', planFilter(planId)),
    ]);
    const fehl = [pl, mi, ei].find((r) => !r.ok);
    if (fehl) return { fehler: fehlerText(fehl) };
    const plan = pl.items[0] || null;
    const ids = [...new Set([...mi.items.map((m) => m.user_id), plan?.besitzer].filter(Boolean))];
    let users = [];
    if (ids.length) {
      const u = await pb.liste('users', idFilter(ids));
      if (!u.ok) return { fehler: fehlerText(u) };
      users = u.items;
    }
    return { daten: mitgliederListe({ plan, mitglieder: mi.items, users, einladungen: ei.items }) };
  }

  async function neuZeichnen() {
    box.replaceChildren(el('h2', 'dlg-h', 'Mitglieder'), el('p', 'dlg-sub', 'Wird geladen …'));
    const l = await laden();
    if (!document.body.contains(box)) return;
    zeichne(l);
  }

  // Ein Schreibzugriff: Knöpfe sperren, Fehler als Hinweis, danach neu laden
  async function schreibe(arbeit, erfolgText) {
    box.querySelectorAll('button, select, input').forEach((n) => { n.disabled = true; });
    const r = await arbeit();
    if (r && r.ok === false) { hinweis = fehlerText(r); if (r.code === 'limit') toast(hinweis, 'bad', 6000); }
    else { hinweis = ''; geaendert = true; if (erfolgText) toast(erfolgText); }
    await neuZeichnen();
    return !(r && r.ok === false);
  }

  function zeichne(l) {
    const kopf = [el('h2', 'dlg-h', 'Mitglieder'), el('p', 'dlg-sub', opt.planName ? '«' + opt.planName + '» – wer den Plan sehen und ändern darf.' : 'Wer den Plan sehen und ändern darf.')];
    if (l.fehler) {
      const schliessen = knopf('Schließen', 'btn-p'); schliessen.onclick = zu;
      const act = el('div', 'dlg-act'); act.append(schliessen);
      box.replaceChildren(...kopf, el('p', 'mg-fehler', l.fehler), act);
      return;
    }
    const d = l.daten;
    box.replaceChildren(...kopf);
    if (hinweis) { const h = el('p', 'mg-fehler', hinweis); h.setAttribute('role', 'alert'); box.append(h); }

    // Liste
    box.append(el('h3', 'dlg-h3', 'Im Plan (' + (d.mitglieder.length + (d.besitzer ? 1 : 0)) + ')'));
    const liste = el('div', 'mg-liste');
    if (d.besitzer) {
      const z = el('div', 'mg-zeile'); z.dataset.besitzer = d.besitzer.user_id;
      z.append(personSpalte(d.besitzer.name, d.besitzer.email), el('span', 'mg-rolle-text', rollenAnzeige.besitzer || 'Besitzer'),
        el('span', 'mg-leer', 'Besitzer des Plans: bleibt immer drin (ändert nur der Superadmin)'));
      liste.append(z);
    }
    if (!d.mitglieder.length) liste.append(el('p', 'mg-leer', 'Noch keine weiteren Mitglieder.'));
    for (const m of d.mitglieder) liste.append(mitgliedZeile(m));
    box.append(liste);

    // Einladen
    box.append(einladenFormular(d));

    // Offene Einladungen
    if (d.einladungen.length) {
      box.append(el('h3', 'dlg-h3', 'Offene Einladungen (' + d.einladungen.length + ')'));
      const ul = el('div', 'mg-liste');
      for (const e of d.einladungen) {
        const z = el('div', 'mg-zeile'); z.dataset.einladung = e.id;
        z.append(personSpalte(e.email, e.abgelaufen ? 'abgelaufen' : 'gültig bis ' + String(e.ablauf).slice(0, 10)),
          el('span', 'mg-rolle-text', rollenAnzeige[e.rolle] || e.rolle));
        if (e.rolle === 'gewerkeleiter') z.append(chips(gewerke, new Set(e.gewerke), { nurLesen: true }));
        const weg = knopf('Zurückziehen', 'mg-weg');
        weg.onclick = async () => {
          const ja = await askDialog({ title: 'Einladung zurückziehen?', message: ['Der Link an ' + e.email + ' funktioniert danach nicht mehr.'], buttons: [{ label: 'Abbrechen', value: false }, { label: 'Zurückziehen', value: true, danger: true }] });
          if (ja) await schreibe(() => pb.batch([{ method: 'DELETE', url: '/api/collections/einladungen/records/' + e.id }]), 'Einladung an ' + e.email + ' zurückgezogen.');
        };
        z.append(weg);
        ul.append(z);
      }
      box.append(ul);
    }

    const act = el('div', 'dlg-act');
    const fertig = knopf('Fertig', 'btn-p'); fertig.id = 'mg-fertig'; fertig.onclick = zu;
    act.append(fertig);
    box.append(act);
  }

  const personSpalte = (name, sub) => {
    const s = el('span', 'mg-person');
    s.append(el('span', 'mg-name', name));
    if (sub) s.append(el('span', 'mg-mail', sub));
    return s;
  };

  function mitgliedZeile(m) {
    const z = el('div', 'mg-zeile'); z.dataset.mitglied = m.id;
    const gew = new Set(m.gewerke);
    const sel = rollenWahl(m.rolle, rollenAnzeige); sel.setAttribute('aria-label', 'Rolle von ' + m.name);
    const chipFeld = el('div', 'mg-chipfeld');
    const speichern = knopf('Speichern', 'btn-p mg-speichern'); speichern.hidden = true;
    const dirty = () => {
      const g1 = [...gew].sort().join(','), g0 = [...m.gewerke].sort().join(',');
      speichern.hidden = !(sel.value !== m.rolle || (sel.value === 'gewerkeleiter' && g1 !== g0));
    };
    const zeichneChips = () => {
      chipFeld.replaceChildren();
      if (sel.value === 'gewerkeleiter') chipFeld.append(chips(gewerke, gew, { beiAenderung: dirty }));
    };
    sel.onchange = () => { zeichneChips(); dirty(); };
    zeichneChips();
    speichern.onclick = async () => {
      const r = rolleGewerke(sel.value, [...gew], bekannt);
      if (r.fehler) { hinweis = r.fehler; zeichneHinweis(); return; }
      await schreibe(() => pb.batch([{ method: 'PATCH', url: '/api/collections/mitglieder/records/' + m.id, body: { rolle: r.rolle, gewerke: r.gewerke } }]), m.name + ': Rolle gespeichert.');
    };
    const info = entfernenInfo({ zeile: m, ichId: ich.id, ichRolle: ich.rolle });
    const weg = sicher(knopf('Entfernen', 'mg-weg', info.gesperrt || ''), !!info.gesperrt);
    weg.onclick = async () => {
      const ja = await askDialog({
        title: 'Mitglied entfernen?',
        message: ['«' + m.name + '» verliert den Zugriff auf diesen Plan.', info.warnung].filter(Boolean),
        buttons: [{ label: 'Abbrechen', value: false }, { label: 'Entfernen', value: true, danger: true }],
      });
      if (!ja) return;
      const ok = await schreibe(() => pb.batch([{ method: 'DELETE', url: '/api/collections/mitglieder/records/' + m.id }]), m.name + ' entfernt.');
      if (ok && m.user_id === ich.id) { selbstEntfernt = true; zu(); }
    };
    z.append(personSpalte(m.name, m.email), sel, chipFeld, speichern, weg);
    return z;
  }

  function zeichneHinweis() {
    box.querySelector('.mg-fehler')?.remove();
    if (!hinweis) return;
    const h = el('p', 'mg-fehler', hinweis); h.setAttribute('role', 'alert');
    box.querySelector('.dlg-sub')?.after(h);
  }

  function einladenFormular(d) {
    const f = el('div', 'mg-einladen');
    f.append(el('h3', 'dlg-h3', 'Einladen'));
    const mail = el('input', 'mg-feld'); mail.type = 'email'; mail.id = 'mg-mail'; mail.placeholder = 'E-Mail-Adresse'; mail.autocomplete = 'off';
    mail.setAttribute('aria-label', 'E-Mail-Adresse');
    const sel = rollenWahl('bearbeiter', rollenAnzeige); sel.id = 'mg-rolle-neu'; sel.setAttribute('aria-label', 'Rolle');
    const gew = new Set();
    const chipFeld = el('div', 'mg-chipfeld');
    const zeichneChips = () => { chipFeld.replaceChildren(); if (sel.value === 'gewerkeleiter') chipFeld.append(chips(gewerke, gew)); };
    sel.onchange = zeichneChips;
    const senden = knopf('Einladen', 'btn-p'); senden.id = 'mg-einladen';
    senden.onclick = async () => {
      const p = einladungPruefen({ email: mail.value, rolle: sel.value, gewerke: [...gew], bekannt, zeilen: d.mitglieder, einladungen: d.einladungen });
      if (p.fehler) { hinweis = p.fehler; zeichneHinweis(); return; }
      letzterLink = null;
      box.querySelectorAll('button, select, input').forEach((n) => { n.disabled = true; });
      const r = await pb.post('/api/collections/einladungen/records', { plan_id: planId, email: p.email, rolle: p.rolle, gewerke: p.gewerke });
      if (!r.ok) { hinweis = fehlerText(r); if (r.code === 'limit') toast(hinweis, 'bad', 6000); }
      else {
        hinweis = ''; geaendert = true;
        if (r.daten?.direkt) toast(p.email + ' ist jetzt Mitglied.');
        else if (r.daten?.link) letzterLink = { email: p.email, link: String(r.daten.link), mail: !!r.daten.mail };
        else { hinweis = 'Unerwartete Antwort des Servers.'; }
      }
      await neuZeichnen();
    };
    const zeile = el('div', 'mg-form');
    zeile.append(mail, sel, senden);
    f.append(zeile, chipFeld);
    if (letzterLink) f.append(linkFeld(letzterLink));
    return f;
  }

  function linkFeld(l) {
    const w = el('div', 'mg-link');
    w.append(el('p', 'dlg-sub', 'Einladung für ' + l.email + ' angelegt. ' + (l.mail ? 'Eine E-Mail ist unterwegs; den Link kannst du auch selbst schicken.' : 'Schick ihr oder ihm diesen Link (14 Tage gültig):')));
    const inp = el('input', 'mg-feld mg-link-feld'); inp.readOnly = true; inp.value = l.link; inp.id = 'mg-link';
    inp.setAttribute('aria-label', 'Einladungslink');
    const kop = knopf('Kopieren', 'btn-p'); kop.id = 'mg-kopieren';
    const meldung = el('span', 'mg-leer'); meldung.setAttribute('role', 'status');
    kop.onclick = async () => {
      try { await navigator.clipboard.writeText(l.link); meldung.textContent = 'Kopiert.'; }
      catch { inp.focus(); inp.select(); meldung.textContent = 'Markiert – mit Strg/⌘+C kopieren.'; }
    };
    const z = el('div', 'mg-form'); z.append(inp, kop);
    w.append(z, meldung);
    return w;
  }

  neuZeichnen();
  return { schliessen: zu };
}

/**
 * Verwaltung (nur Superadmin): Konten mit Schalter «Produktionsleitung», alle Pläne mit Besitzer.
 * Das Ändern des Besitzers ist bewusst nicht Teil dieses Dialogs (siehe Task-11-Bericht).
 * opt: { pb, toast }
 */
export function openVerwaltung(opt) {
  const { pb, toast } = opt;
  const o = overlay('vw-dlg');
  const box = o.box; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Verwaltung');
  let hinweis = '';

  async function neuZeichnen() {
    box.replaceChildren(el('h2', 'dlg-h', 'Verwaltung'), el('p', 'dlg-sub', 'Wird geladen …'));
    const [u, p, m] = await Promise.all([pb.liste('users', '', 'name'), pb.liste('plaene', '', 'created'), pb.liste('mitglieder', '')]);
    if (!document.body.contains(box)) return;
    const fehl = [u, p, m].find((r) => !r.ok);
    if (fehl) {
      const z = knopf('Schließen', 'btn-p'); z.onclick = o.zu;
      const act = el('div', 'dlg-act'); act.append(z);
      box.replaceChildren(el('h2', 'dlg-h', 'Verwaltung'), el('p', 'mg-fehler', fehlerText(fehl)), act);
      return;
    }
    zeichne(verwaltungListe({ users: u.items, plaene: p.items, mitglieder: m.items }));
  }

  function zeichne(d) {
    box.replaceChildren(el('h2', 'dlg-h', 'Verwaltung'), el('p', 'dlg-sub', 'Nur für den Superadmin: wer Pläne anlegen darf und wem welcher Plan gehört.'));
    if (hinweis) { const h = el('p', 'mg-fehler', hinweis); h.setAttribute('role', 'alert'); box.append(h); }
    box.append(el('h3', 'dlg-h3', 'Konten (' + d.konten.length + ')'));
    const kl = el('div', 'mg-liste');
    for (const k of d.konten) {
      const z = el('div', 'mg-zeile'); z.dataset.konto = k.id;
      const gesperrt = leitungSchalterGesperrt(k);
      const lab = el('label', 'mg-schalter');
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = k.produktionsleitung || k.superadmin; cb.disabled = !!gesperrt; cb.className = 'mg-leitung';
      cb.setAttribute('aria-label', 'Produktionsleitung: ' + k.name);
      if (gesperrt) lab.title = gesperrt;
      lab.append(cb, el('span', null, '🎬 Produktionsleitung'));
      cb.onchange = async () => {
        box.querySelectorAll('input').forEach((n) => { n.disabled = true; });
        const r = await pb.batch([{ method: 'PATCH', url: '/api/collections/users/records/' + k.id, body: { produktionsleitung: cb.checked } }]);
        if (!r.ok) { hinweis = fehlerText(r); if (r.code === 'limit') toast(hinweis, 'bad', 6000); } else { hinweis = ''; toast(k.name + (cb.checked ? ' darf jetzt Pläne anlegen.' : ' darf keine Pläne mehr anlegen.')); }
        await neuZeichnen();
      };
      z.append(personSpalte(k.name, k.email), k.superadmin ? el('span', 'mg-rolle-text', '⭐ Superadmin') : el('span'), lab);
      kl.append(z);
    }
    box.append(kl);
    box.append(el('h3', 'dlg-h3', 'Pläne (' + d.plaene.length + ')'));
    const pl = el('div', 'mg-liste');
    if (!d.plaene.length) pl.append(el('p', 'mg-leer', 'Es gibt noch keinen Plan.'));
    for (const p of d.plaene) {
      const z = el('div', 'mg-zeile'); z.dataset.plan = p.plan_id;
      z.append(personSpalte(p.name, p.venue), el('span', 'mg-rolle-text', '👑 ' + p.besitzer), el('span', 'mg-leer', p.mitglieder + (p.mitglieder === 1 ? ' Mitglied' : ' Mitglieder')));
      pl.append(z);
    }
    box.append(pl);
    const act = el('div', 'dlg-act');
    const fertig = knopf('Fertig', 'btn-p'); fertig.id = 'vw-fertig'; fertig.onclick = o.zu;
    act.append(fertig);
    box.append(act);
  }
  const personSpalte = (name, sub) => {
    const s = el('span', 'mg-person');
    s.append(el('span', 'mg-name', name));
    if (sub) s.append(el('span', 'mg-mail', sub));
    return s;
  };
  neuZeichnen();
  return { schliessen: o.zu };
}
