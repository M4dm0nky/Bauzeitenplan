// Konfliktauflösung beim Senden — DOM-frei.
//
// `server.senden` meldet bei einem Konflikt `[{coll, eid, art, fremd, unbekannt?}]` und gibt die
// gescheiterte Änderungsliste (`aend`) zurück. Dieses Modul beantwortet die Fragen der App:
// wie heißt der Eintrag, welche Art Konflikt ist es, und was ist die Änderungsliste NACH der
// Entscheidung des Nutzers (Ihre Fassung nehmen / Meine behalten / Wiederherstellen / Verwerfen).
// Die Dialoge selbst (askDialog) stehen in app.js.
import { COLLS, zerlegen, zusammensetzen } from './aenderungen.js';

const KLON = (x) => JSON.parse(JSON.stringify(x));
const TITEL_FELD = { vorgaenge: 'title', gewerke: 'name', phasen: 'name', ressourcen: 'name', plaene: 'name' };
const ART_NAME = { vorgaenge: 'Vorgang', gewerke: 'Gewerk', phasen: 'Phase', ressourcen: 'Bezeichnung', plaene: 'Plan', verknuepfungen: 'Verknüpfung' };

const sl = (aend, coll) => aend?.[coll] || { anlegen: [], aendern: [], loeschen: [] };

/** Antwort des Dialogs «Anmeldung abgelaufen» → 'login' | 'kopie'. NUR das ausdrückliche 'login' führt zur
 *  Anmeldung (die ungesendeten Änderungen gehen dann verloren); Escape/Klick daneben (null) und alles andere
 *  sind «Kopie ansehen», damit nichts still verloren geht. */
export const abgelaufenEntscheid = (wahl) => (wahl === 'login' ? 'login' : 'kopie');

/** Anzeigename eines Eintrags: aus dem fremden Stand, der Änderungsliste oder dem Plan. */
export function eintragTitel(coll, eid, { state = null, aend = null, fremd = null } = {}) {
  let rec = fremd || null;
  if (!rec && aend) {
    const x = sl(aend, coll);
    rec = x.aendern.find((e) => e.vorher.id === eid)?.vorher
      || x.loeschen.find((o) => o.id === eid)
      || x.anlegen.find((o) => o.id === eid) || null;
  }
  if (!rec && state) {
    const teile = zerlegen(state);
    rec = teile[coll]?.get(eid) || null;
  }
  const feld = TITEL_FELD[coll];
  const t = rec && feld && typeof rec[feld] === 'string' ? rec[feld].trim() : '';
  return t || ART_NAME[coll] || coll;
}

/** Art eines Konflikts für den Dialog: 'geaendert' | 'geloescht' | 'unbekannt'. */
export function konfliktArt(k) {
  if (k.unbekannt) return 'unbekannt';
  if (k.art === 'geloescht' || k.fremd === null || k.fremd === undefined) return 'geloescht';
  return 'geaendert';
}

/** Konflikte nach Art gruppieren (ein Dialog je Art): [{art, eintraege:[konflikt…]}]. */
export function gruppen(konflikte) {
  const out = [];
  for (const k of konflikte || []) {
    const art = konfliktArt(k);
    let g = out.find((x) => x.art === art);
    if (!g) { g = { art, eintraege: [] }; out.push(g); }
    g.eintraege.push(k);
  }
  return out;
}

const schluessel = (k) => k.coll + '|' + k.eid;

/** State mit dem fremden Stand der Konflikt-Einträge (fremd null = gelöscht). Ändert `state` nicht. */
export function fremdUebernehmen(state, konflikte) {
  const teile = zerlegen(state);
  for (const k of konflikte) {
    if (!COLLS.includes(k.coll)) continue;
    if (k.fremd === null || k.fremd === undefined) { if (k.coll !== 'plaene') teile[k.coll].delete(k.eid); }
    else teile[k.coll].set(k.eid, KLON(k.fremd));
  }
  const neu = zusammensetzen(teile);
  // Felder des States, die keine Sammlung sind, bleiben erhalten
  return { ...state, ...neu };
}

// Einträge einer Liste mit parallelen Positionslisten entfernen
function filtere(x, listeName, posNamen, behalte) {
  const liste = x[listeName];
  const idx = liste.map((o, i) => i).filter((i) => behalte(liste[i]));
  x[listeName] = idx.map((i) => liste[i]);
  for (const p of posNamen) if (Array.isArray(x[p])) x[p] = idx.map((i) => x[p][i]);
}

/** Änderungsliste ohne die Konflikt-Einträge (der Rest wird weitergesendet). */
export function ohne(aend, konflikte) {
  const weg = new Set(konflikte.map(schluessel));
  const out = KLON(aend);
  for (const c of COLLS) {
    const x = out[c]; if (!x) continue;
    filtere(x, 'anlegen', ['anlegenPos'], (o) => !weg.has(c + '|' + o.id));
    filtere(x, 'aendern', ['aendernPos', 'aendernPosNeu'], (e) => !weg.has(c + '|' + e.vorher.id));
    filtere(x, 'loeschen', ['loeschenPos'], (o) => !weg.has(c + '|' + o.id));
  }
  return out;
}

/** «Meine behalten»: ein Anlegen, das auf einen bestehenden Datensatz traf, wird zum Ändern.
 *  Alles andere bleibt: der Server nimmt die Änderung jetzt auf Basis der neuen Version an. */
export function meineBehalten(aend, konflikte) {
  const out = KLON(aend);
  for (const k of konflikte) {
    if (k.art !== 'existiert') continue;
    const x = out[k.coll]; if (!x) continue;
    const i = x.anlegen.findIndex((o) => o.id === k.eid);
    if (i < 0) continue;
    const [o] = x.anlegen.splice(i, 1);
    const pos = Array.isArray(x.anlegenPos) ? x.anlegenPos.splice(i, 1)[0] : undefined;
    x.aendern.push({ vorher: KLON(o), nachher: o });
    if (Array.isArray(x.aendernPos)) { x.aendernPos.push(pos); x.aendernPosNeu.push(pos); }
  }
  return out;
}

/** «Wiederherstellen»: was ich ändern wollte, der Datensatz aber fremd gelöscht ist, wird neu angelegt.
 *  Ein von mir gelöschter (und von anderen gelöschter) Datensatz entfällt einfach. */
export function wiederherstellen(aend, konflikte) {
  const out = KLON(aend);
  for (const k of konflikte) {
    const x = out[k.coll]; if (!x) continue;
    const i = x.aendern.findIndex((e) => e.vorher.id === k.eid);
    if (i >= 0) {
      const e = x.aendern[i];
      const pos = x.aendernPosNeu?.[i];
      x.aendern.splice(i, 1);
      if (Array.isArray(x.aendernPos)) { x.aendernPos.splice(i, 1); x.aendernPosNeu.splice(i, 1); }
      x.anlegen.push(e.nachher);
      if (Array.isArray(x.anlegenPos)) x.anlegenPos.push(pos ?? x.anlegen.length - 1);
    }
  }
  return ohneLoeschen(out, konflikte);
}

function ohneLoeschen(aend, konflikte) {
  const weg = new Set(konflikte.map(schluessel));
  for (const c of COLLS) {
    const x = aend[c]; if (!x) continue;
    filtere(x, 'loeschen', ['loeschenPos'], (o) => !weg.has(c + '|' + o.id));
  }
  return aend;
}

/** Die Datensätze (coll|eid), die eine Liste von Änderungslisten berührt (anlegen, ändern, löschen). */
export function offeneSchluessel(listen) {
  const out = new Set();
  for (const a of listen || []) {
    for (const c of COLLS) {
      const x = a?.[c]; if (!x) continue;
      for (const o of x.anlegen || []) out.add(c + '|' + o.id);
      for (const e of x.aendern || []) out.add(c + '|' + e.vorher.id);
      for (const o of x.loeschen || []) out.add(c + '|' + o.id);
    }
  }
  return out;
}

/** Fremden Stand übernehmen, aber Datensätze mit noch offener eigener Änderung behalten (nie still
 *  überschreiben): für sie gilt der lokale Stand (auch «lokal gelöscht»). Ändert die Eingänge nicht. */
export function uebernehmeOhneOffene(lokal, fremd, offene) {
  if (!offene || !offene.size) return fremd;
  const l = zerlegen(lokal), f = zerlegen(fremd);
  for (const k of offene) {
    const i = k.indexOf('|');
    const c = k.slice(0, i), eid = k.slice(i + 1);
    if (!f[c]) continue;
    if (l[c].has(eid)) f[c].set(eid, KLON(l[c].get(eid)));
    else if (c !== 'plaene') f[c].delete(eid);
  }
  return { ...fremd, ...zusammensetzen(f) };
}

const HUELLE = ['start', 'end', 'milestone'];   // abgeleitete Felder eines Sammelvorgangs (wie HUELLE_FELDER im Store)
const ohneHuelle = (o) => { const c = { ...o }; HUELLE.forEach((f) => delete c[f]); return JSON.stringify(Object.keys(c).sort().map((k) => [k, c[k]])); };

/** Konflikte an einem Sammelvorgang, die KEINE sind: Die Hülle (Start/Ende) ist aus den Kindern abgeleitet.
 *  Ändern zwei Nutzer verschiedene Kinder, kollidieren sie sonst am Elternvorgang (Spec §9: verschiedene Einträge
 *  kollidieren nie). Ein Konflikt gilt als Hüllenkonflikt, wenn der Eintrag ein Vorgang mit Untervorgängen ist, noch
 *  existiert (kein «gelöscht»/«existiert») und die eigene Änderung dort NUR Hüllenfelder berührt. Dann gilt der
 *  fremde Stand (ohne Dialog), die eigene Hüllenänderung entfällt, die Hülle rechnet jeder Store neu aus den Kindern.
 *  → {auto:[Konflikt…], rest:[Konflikt…]} */
export function huellenKonflikte(aend, konflikte, state) {
  const eltern = new Set((state?.tasks || []).map((t) => t.parent).filter(Boolean));
  const auto = [], rest = [];
  for (const k of konflikte || []) {
    const e = k.coll === 'vorgaenge' && k.art === 'aendern' && k.fremd && !k.unbekannt && eltern.has(k.eid)
      ? sl(aend, 'vorgaenge').aendern.find((x) => x.vorher.id === k.eid) : null;
    if (e && ohneHuelle(e.vorher) === ohneHuelle(e.nachher)) auto.push(k); else rest.push(k);
  }
  return { auto, rest };
}
