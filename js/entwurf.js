// ── Entwurf für Start · Ende · Dauer ─────────────────────────────────────────
// Wer eines der drei Felder ändert, ändert nur einen ENTWURF: die Felder zeigen
// ihn, die Zeile ist gelb markiert, ✓ und ✗ erscheinen. Der Store bleibt unberührt
// — nichts wird einsortiert, nichts liegt auf dem Undo-Stapel.
//   ✓ oder Enter  → `uebernehmen({start, end})`: EIN Befehl, EIN Undo-Schritt
//   ✗ oder Escape → verwerfen
//   Fokus verlässt die drei Felder → verwerfen (wie Klick daneben)
// Eine ungültige Spanne sperrt ✓ und sagt neben dem Knopf, warum.
//
// Tabelle und Panel nutzen DASSELBE Modul; die Rechnung selbst steht DOM-frei in
// conflicts.js (entwurfAendern/entwurfFehler).

import { el, toInput } from './dom.js';
import { toMin } from './schedule.js';
import { fmtDuration, entwurfAendern, entwurfFehler } from './conflicts.js';

/**
 * @param {object}   o
 * @param {HTMLInputElement}  o.start
 * @param {HTMLInputElement}  o.ende
 * @param {HTMLInputElement=} o.dauer
 * @param {HTMLElement[]} o.gruppe   Container der Felder (Fokus darin = «noch in der Zeile»)
 * @param {HTMLElement}   o.markiere bekommt `is-entwurf`
 * @param {HTMLElement}   o.popIn    hier hinein kommt ✓ ✗ samt Grund
 * @param {() => object}  o.lesen    aktueller Vorgang aus dem Store (nie aus der Closure)
 * @param {(e:{start:?string,end:?string}, beruehrt:Set<string>) => void} o.uebernehmen
 * @param {boolean=} o.nurZeit  Felder ohne Datum («HH:MM»)
 * @param {() => ?string=} o.tag  Tag für ein Zeitfeld ohne Bezug (terminlose Zeile)
 * @param {{start:?string,end:?string,beruehrt?:Set<string>,fehler?:?string}=} o.anfang
 *   ein beim Neuaufbau wieder zu öffnender Entwurf (die Tabelle hält ihn)
 * @param {(e:?{start:?string,end:?string}, beruehrt:Set<string>, fehler:?string) => void} o.onAendern
 *   meldet jede Änderung des Entwurfs (null = geschlossen) — der Halter überlebt damit einen Neuaufbau
 * @param {(text:?string) => void} o.grundAnzeige  der Grund AUSSERHALB des Kästchens (Tabelle: Zeile darunter)
 */
export function entwurfBinden({ start, ende, dauer, gruppe, markiere, popIn, lesen, uebernehmen, nurZeit = false, tag = () => null, anfang = null, onAendern = null, grundAnzeige = null }) {
  let e = null;                 // Entwurf; null = keiner offen
  let beruehrt = new Set();
  let fehlerEingabe = null;     // unlesbare Eingabe (Dauer «xyz»)
  let fehlerStore = null;       // der Store hat ✓ abgelehnt: Grund bleibt, bis man weiter editiert
  let fertig = false;           // nach erfolgreichem ✓: späte Ereignisse des abgehängten Knotens ignorieren

  const pop = el('span', 'en-pop');
  pop.hidden = true;
  const ok = el('button', 'tb-ico en-ok', '✓');
  const no = el('button', 'tb-ico en-no', '✗');
  ok.type = no.type = 'button';
  ok.title = 'Übernehmen (Enter)';
  no.title = 'Verwerfen (Esc)';
  ok.setAttribute('aria-label', 'Übernehmen');
  no.setAttribute('aria-label', 'Verwerfen');
  const grund = el('span', 'en-grund');
  grund.setAttribute('role', 'status');
  pop.append(ok, no);
  if (!grundAnzeige) pop.append(grund);
  popIn.append(pop);
  // Der Klick auf ✓/✗ darf den Fokus nicht aus dem Feld holen: sonst feuert das
  // focusout vor dem click, und der Entwurf wäre schon verworfen.
  for (const b of [ok, no]) b.addEventListener('mousedown', (ev) => ev.preventDefault());

  const zeige = (iso) => (!iso ? '' : nurZeit ? String(iso).slice(11, 16) : toInput(iso));
  const dauerText = (x) => (x.start && x.end ? fmtDuration(toMin(x.end) - toMin(x.start)) : '');

  function malen(eigenes) {
    const x = e || lesen();
    if (!x) return;
    if (eigenes !== start) start.value = zeige(x.start);
    if (eigenes !== ende) ende.value = zeige(x.end);
    if (dauer && eigenes !== dauer) dauer.value = dauerText(x);
    markiere.classList.toggle('is-entwurf', !!e);
    pop.hidden = !e;
    if (!e) { if (grundAnzeige) grundAnzeige(null); return; }
    const now = lesen();
    const f = fehlerEingabe || fehlerStore || entwurfFehler(e, { milestone: !!(now && now.milestone) });
    ok.disabled = !!f;
    ok.title = f || 'Übernehmen (Enter)';
    if (grundAnzeige) grundAnzeige(f || null);
    else { grund.textContent = f || ''; grund.hidden = !f; }
    if (dauer) dauer.classList.toggle('is-bad', !!fehlerEingabe);
  }

  const melden = () => { if (markiere.isConnected && onAendern) onAendern(e ? { ...e } : null, new Set(beruehrt), fehlerStore); };

  function zu() {
    e = null; fehlerEingabe = null; fehlerStore = null; beruehrt = new Set();
    markiere.classList.remove('is-entwurf');
    pop.hidden = true;
    if (grundAnzeige) grundAnzeige(null);
    if (dauer) dauer.classList.remove('is-bad');
  }

  function verwerfen() {
    if (!e) return;
    zu();
    malen(null);
    melden();
  }

  function aendern(feld, input, tippt = false) {
    if (fertig) return;
    const now = lesen();
    if (!now) return;
    const basis = e || { start: now.start ?? null, end: now.end ?? null };
    const r = entwurfAendern(basis, feld, input.value, { nurZeit, tag: tag(), milestone: !!now.milestone });
    fehlerEingabe = r.fehler || null;
    fehlerStore = null;
    const neu = { start: r.start, end: r.end };
    const gleich = neu.start === (now.start ?? null) && neu.end === (now.end ?? null);
    if (gleich && !fehlerEingabe) {
      // Wieder beim gespeicherten Stand angekommen: kein Entwurf mehr.
      zu();
      malen(input);
      melden();
      return;
    }
    e = neu;
    beruehrt.add(feld);
    // Beim Tippen (`input`) bleibt der getippte Text stehen, auch wenn er
    // unterwegs noch nichts ergibt («» auf dem Weg zu «6h»).
    malen(input === dauer && fehlerEingabe && !tippt ? null : input);
    melden();
  }

  function bestaetigen() {
    if (!e || fertig) return;
    const now = lesen();
    if (fehlerEingabe || fehlerStore || entwurfFehler(e, { milestone: !!(now && now.milestone) })) return;
    const x = { start: e.start, end: e.end }, b = new Set(beruehrt);
    zu();
    melden();
    fertig = true;
    const r = uebernehmen(x, b);
    // Nur bei Erfolg ist der Entwurf erledigt. Lehnt der Store ab (Vorgang
    // inzwischen Sammelvorgang, gelöscht …), bleibt er MARKIERT offen und
    // nennt den Grund — kein stilles Zurückspringen auf alte Werte.
    if (r && r.ok === false) {
      fertig = false;
      e = x; beruehrt = b; fehlerStore = r.error || 'Der Store hat die Änderung abgelehnt.';
      malen(null);
      if (!r.gehalten) melden();   // hält der Aufrufer den Entwurf selbst, schreibt dieser Knoten nichts mehr
    }
  }

  // Ein vom Halter gemerkter Entwurf wird nach einem Neuaufbau wieder geöffnet.
  // Gemalt wird erst im Microtask: bis dahin hängt die Zeile im DOM (der Grund
  // darunter braucht sie als Anker).
  if (anfang) {
    e = { start: anfang.start ?? null, end: anfang.end ?? null };
    beruehrt = new Set(anfang.beruehrt || []);
    fehlerStore = anfang.fehler || null;
    malen(null);
    queueMicrotask(() => { if (e && !fertig) malen(null); });
  }

  start.addEventListener('change', () => aendern('start', start));
  ende.addEventListener('change', () => aendern('end', ende));
  if (dauer) {
    dauer.addEventListener('change', () => aendern('dauer', dauer));
    // Ein Textfeld meldet `change` erst beim Verlassen — der Klick auf ✓ hält
    // aber den Fokus im Feld. Deshalb schon beim Tippen den Entwurf öffnen.
    dauer.addEventListener('input', () => aendern('dauer', dauer, true));
  }
  ok.addEventListener('click', () => {
    // Noch nicht abgegebener Feldinhalt zählt mit (Fokus liegt weiter im Feld).
    const a = document.activeElement;
    const f = felder.find(([i]) => i === a);
    if (f && e) aendern(f[1], f[0]);
    bestaetigen();
  });
  no.addEventListener('click', verwerfen);

  const felder = [[start, 'start'], [ende, 'end'], ...(dauer ? [[dauer, 'dauer']] : [])];
  for (const g of gruppe) {
    g.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && e) { ev.preventDefault(); ev.stopPropagation(); verwerfen(); return; }
      if (ev.key !== 'Enter') return;
      const f = felder.find(([i]) => i === ev.target);
      if (!f) return;
      ev.preventDefault();
      // Das `change` eines Textfelds kommt erst NACH diesem keydown — den
      // getippten Wert deshalb jetzt schon übernehmen.
      aendern(f[1], f[0]);
      bestaetigen();
    });
    // Fokus verlässt die Felder → verwerfen. activeElement erst im nächsten Tick
    // (während focusout steht noch das alte Element drin). Ein Fenster, das den
    // Fokus verliert (Tabwechsel, Kalender-Popup), ist kein Verlassen.
    g.addEventListener('focusout', () => {
      if (!e) return;
      setTimeout(() => {
        if (!e || !markiere.isConnected || !document.hasFocus()) return;
        const a = document.activeElement;
        if (a && gruppe.some((c) => c.contains(a))) return;
        verwerfen();
      }, 0);
    });
  }
}
