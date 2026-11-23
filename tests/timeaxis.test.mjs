import { zoomAnchored, ticksFor, isoWeek, tickScale, nearestPreset, clampZoom, weekendBands, fitPx, ZOOM, rasterMin, schnapp, gezogen, planMinute, naechsteMitternacht, planSpanne, engpassText, fmtPuffer, fmtFloat, kettenEnde } from '../js/timeaxis.js';
import assert from 'node:assert/strict';
import { toMin } from '../js/schedule.js';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { const r = fn(); if (r && typeof r.then === 'function') throw new Error('async-Test im synchronen Helfer — nicht erlaubt'); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
};

console.log('\nZoom-Anker');
test('Zeitpunkt unter dem Cursor bleibt beim Reinzoomen stehen', () => {
  const oldPx = 0.5, newPx = 2.0, scrollLeft = 1000, anchorX = 300;
  const timeBefore = (scrollLeft + anchorX) / oldPx;
  const newScroll = zoomAnchored({ scrollLeft, anchorX, oldPx, newPx });
  const timeAfter = (newScroll + anchorX) / newPx;
  assert.ok(Math.abs(timeBefore - timeAfter) < 1e-6, `${timeBefore} !== ${timeAfter}`);
});
test('Zeitpunkt unter dem Cursor bleibt beim Rauszoomen stehen', () => {
  const oldPx = 2.0, newPx = 0.02, scrollLeft = 50000, anchorX = 640;
  const timeBefore = (scrollLeft + anchorX) / oldPx;
  const timeAfter = (zoomAnchored({ scrollLeft, anchorX, oldPx, newPx }) + anchorX) / newPx;
  assert.ok(Math.abs(timeBefore - timeAfter) < 1e-6);
});
test('Zoom am linken Rand (anchorX 0) erhält den Zeitpunkt', () => {
  const r = zoomAnchored({ scrollLeft: 720, anchorX: 0, oldPx: 0.5, newPx: 1.0 });
  assert.equal(r, 1440, 'derselbe Zeitpunkt, doppelte Skala');
});
test('clampZoom hält die Grenzen ein', () => {
  assert.equal(clampZoom(99), 4.0);
  assert.equal(clampZoom(0.0001), 0.008);
  assert.equal(clampZoom(0.5), 0.5);
});
test('nearestPreset trifft die Presets exakt', () => {
  for (const [k, v] of Object.entries(ZOOM)) assert.equal(nearestPreset(v.px), k);
});
test('nearestPreset vergleicht multiplikativ, nicht additiv', () => {
  // 0.04 ist additiv näher an 0.09 (Δ.05) als an 0.02 (Δ.02)? Nein — aber
  // 0.03: additiv näher an 0.02 (Δ.01) als 0.09 (Δ.06); multiplikativ ebenso.
  // Kritisch ist der große Zoombereich: 3.0 muss "stunden" (2.0) treffen, nicht "tage".
  assert.equal(nearestPreset(3.0), 'stunden');
  assert.equal(nearestPreset(0.03), 'monate');
});

console.log('\nTagesansicht: ein Tag füllt die Breite');
test('fitPx macht aus Viewport-Breite genau eine Tagesbreite', () => {
  // 1440 Minuten (ein Tag) × fitPx == Viewport-Breite (solange nicht geklemmt)
  for (const w of [1000, 1300, 2000, 3000]) {
    assert.ok(Math.abs(1440 * fitPx(w, 1440) - w) < 1e-6, w + 'px füllt keinen ganzen Tag');
  }
});
test('fitPx hält die Zoomgrenzen ein', () => {
  assert.equal(fitPx(9_000_000, 1440), 4.0);   // extrem breit → gedeckelt
  assert.equal(fitPx(1, 1440), 0.008);          // extrem schmal → Mindestzoom
});

console.log('\nZoom-Presets: was ist tatsächlich sichtbar?');
{
  const VIEW = 1300; // typische Breite des Zeitfelds in px
  const daysVisible = (px) => VIEW / (px * 1440);
  test('«Monate» zeigt mindestens 6 Wochen am Stück', () => {
    const d = daysVisible(ZOOM.monate.px);
    assert.ok(d >= 42, `nur ${d.toFixed(1)} Tage sichtbar`);
  });
  test('«Wochen» zeigt die Aufbauwoche plus Show (7–20 Tage)', () => {
    const d = daysVisible(ZOOM.wochen.px);
    assert.ok(d >= 7 && d <= 20, `${d.toFixed(1)} Tage sichtbar`);
  });
  test('«Tage» zeigt mehrere Tage — nicht nur einen Ausschnitt davon', () => {
    const d = daysVisible(ZOOM.tage.px);
    assert.ok(d >= 3 && d <= 8, `${d.toFixed(1)} Tage sichtbar — eine Tagesansicht muss Tage zeigen`);
  });
  test('«Stunden» zeigt einen Load-In-Tag (8–20 Std)', () => {
    const h = daysVisible(ZOOM.stunden.px) * 24;
    assert.ok(h >= 8 && h <= 20, `${h.toFixed(1)} Stunden sichtbar`);
  });
  test('Presets sind streng von grob nach fein geordnet', () => {
    const v = [ZOOM.monate.px, ZOOM.wochen.px, ZOOM.tage.px, ZOOM.stunden.px];
    for (let i = 1; i < v.length; i++) assert.ok(v[i] > v[i - 1], 'Preset ' + i + ' ist nicht feiner');
  });
  test('jedes Preset liegt im erlaubten Zoombereich', () => {
    for (const [k, o] of Object.entries(ZOOM)) assert.equal(clampZoom(o.px), o.px, k + ' wird abgeschnitten');
  });
}

console.log('\nTick-Skala');
test('Stundenzoom zeigt Tag über Stunden', () => {
  assert.deepEqual(tickScale(2.0), { major: 'day', minor: 'hour3' });
});
test('Monatszoom zeigt Monat über Tagen oder Wochen', () => {
  assert.equal(tickScale(0.02).major, 'month');
  assert.equal(tickScale(0.06).major, 'month');
});
test('Skala ist über den ganzen Zoombereich monoton grob→fein', () => {
  const rank = { hour3: 0, hour6: 1, day: 2, week: 3, month: 4 };
  let last = -1;
  for (const px of [4, 2, 1, 0.5, 0.2, 0.09, 0.05, 0.02, 0.008]) {
    const r = rank[tickScale(px).minor];
    assert.ok(r >= last, `bei px=${px} wird die Skala wieder feiner`);
    last = r;
  }
});

console.log('\nTicks');
test('Tages-Ticks liefern jeden Tag im Fenster', () => {
  const t = ticksFor('day', new Date('2026-07-13T00:00'), new Date('2026-07-16T23:59'));
  assert.equal(t.length, 4);
  assert.deepEqual(t.map((x) => x.label), ['13', '14', '15', '16']);
  assert.deepEqual(t.map((x) => x.sub), ['Mo', 'Di', 'Mi', 'Do']);
});
test('Wochenende wird auf Tages-Ticks markiert', () => {
  const t = ticksFor('day', new Date('2026-07-17T00:00'), new Date('2026-07-20T23:59'));
  assert.deepEqual(t.map((x) => !!x.weekend), [false, true, true, false], 'Fr So Sa Mo → Sa+So');
});
test('3-Stunden-Ticks rasten auf 00:00 ein, nicht auf der Fensterkante', () => {
  const t = ticksFor('hour3', new Date('2026-07-15T04:30'), new Date('2026-07-15T13:00'));
  assert.deepEqual(t.map((x) => x.label), ['06', '09', '12'], 'kein Tick um 04:30');
});
test('Stunden-Ticks liefern jede Stunde — für das A3-Tagesblatt', () => {
  const t = ticksFor('hour', new Date('2026-08-30T00:00'), new Date('2026-08-30T23:59'));
  assert.equal(t.length, 24, '00 bis 23');
  assert.deepEqual(t.slice(0, 4).map((x) => x.label), ['00', '01', '02', '03']);
  assert.equal(t[t.length - 1].label, '23');
});
test('Monats-Ticks decken den Rand mit ab', () => {
  const t = ticksFor('month', new Date('2026-05-04T00:00'), new Date('2026-07-22T00:00'));
  assert.deepEqual(t.map((x) => x.label), ['Mai 2026', 'Jun 2026', 'Jul 2026']);
});
test('leeres Fenster liefert keine Ticks statt zu hängen', () => {
  const t = ticksFor('day', new Date('2026-07-15T10:00'), new Date('2026-07-15T09:00'));
  assert.equal(t.length, 0);
});

console.log('\nKalenderwoche (ISO 8601 / DIN 1355)');
test('Wochen beginnen montags', () => {
  const t = ticksFor('week', new Date('2026-07-15T00:00'), new Date('2026-07-29T00:00'));
  for (const x of t) assert.equal(x.t.getDay(), 1, x.t.toString() + ' ist kein Montag');
});
test('4. Januar liegt immer in KW 1', () => {
  for (const y of [2024, 2025, 2026, 2027]) assert.equal(isoWeek(new Date(y, 0, 4)), 1, 'Jahr ' + y);
});
test('Silvester 2026 liegt in KW 53', () => {
  assert.equal(isoWeek(new Date(2026, 11, 31)), 53);
});
test('1. Januar 2027 gehört noch zur KW 53 des Vorjahres', () => {
  assert.equal(isoWeek(new Date(2027, 0, 1)), 53, 'Donnerstag entscheidet das Jahr');
});

console.log('\nWochenend-Bänder');
test('Band läuft von Samstag 00:00 bis Montag 00:00', () => {
  const b = weekendBands(new Date('2026-07-13T00:00'), new Date('2026-07-20T00:00'));
  assert.equal(b.length, 1);
  assert.equal(b[0].from.getDay(), 6, 'startet Samstag');
  assert.equal(b[0].to.getDay(), 1, 'endet Montag');
  assert.equal((b[0].to - b[0].from) / 3600000, 48, 'genau 48 Stunden');
});

console.log('\nBalken ziehen: Rechnung');
const T = (iso) => toMin(iso);
test('rasterMin je Zoomstufe', () => {
  assert.equal(rasterMin('stunden'), 15); assert.equal(rasterMin('tage'), 15);
  assert.equal(rasterMin('wochen'), 60); assert.equal(rasterMin('monate'), 1440);
});
test('schnapp rundet auf den naechsten Schritt', () => {
  assert.equal(schnapp(T('2026-07-13T10:07'), 15), T('2026-07-13T10:00'));
  assert.equal(schnapp(T('2026-07-13T10:08'), 15), T('2026-07-13T10:15'));
  assert.equal(schnapp(T('2026-07-13T11:10'), 1440), T('2026-07-13T00:00'));
  assert.equal(schnapp(T('2026-07-13T12:30'), 1440), T('2026-07-14T00:00'));
});
test('Verschieben behaelt die Dauer', () => {
  const s = T('2026-07-13T10:00'), e = T('2026-07-13T12:30');
  const r = gezogen({ start: s, end: e, modus: 'move', deltaMin: 52, schritt: 15 });
  assert.equal(r.end - r.start, 150);
  assert.equal(r.start, T('2026-07-13T10:45'));
});
test('Ende ziehen schnappt auf Raster', () => {
  const s = T('2026-07-13T10:00'), e = T('2026-07-13T12:00');
  const r = gezogen({ start: s, end: e, modus: 'end', deltaMin: 38, schritt: 15 });
  assert.equal(r.start, s); assert.equal(r.end, T('2026-07-13T12:45'));
});
test('Mindestdauer ist ein Rasterschritt (Ende)', () => {
  const s = T('2026-07-13T10:00'), e = T('2026-07-13T12:00');
  const r = gezogen({ start: s, end: e, modus: 'end', deltaMin: -500, schritt: 15 });
  assert.equal(r.end - r.start, 15);
});
test('Start ueber das Ende hinaus wird begrenzt', () => {
  const s = T('2026-07-13T10:00'), e = T('2026-07-13T12:00');
  const r = gezogen({ start: s, end: e, modus: 'start', deltaMin: 600, schritt: 15 });
  assert.equal(r.end, e); assert.equal(r.end - r.start, 15);
});
test('Meilenstein: Verschieben ja, Start/Ende ziehen wird ignoriert', () => {
  const m = T('2026-07-13T10:00');
  const a = gezogen({ start: m, end: m, modus: 'move', deltaMin: 30, schritt: 15, milestone: true });
  assert.equal(a.start, m + 30); assert.equal(a.end, a.start);
  for (const modus of ['start', 'end']) {
    const b = gezogen({ start: m, end: m, modus, deltaMin: 30, schritt: 15, milestone: true });
    assert.deepEqual(b, { start: m, end: m });
  }
});
test('Sommerzeit-Nacht 25.10.2026: Verschieben um 60 min behaelt echte Dauer', () => {
  const s = T('2026-10-25T01:00'), e = T('2026-10-25T04:00'); // 4 echte Stunden
  assert.equal(e - s, 240);
  const r = gezogen({ start: s, end: e, modus: 'move', deltaMin: 60, schritt: 15 });
  assert.equal(r.end - r.start, 240);
  assert.equal(r.start, s + 60);
});
test('Monate (1440): die Uhrzeit bleibt, es wandern ganze Tage', () => {
  const s = T('2026-07-13T08:00'), e = T('2026-07-13T18:00');
  const r = gezogen({ start: s, end: e, modus: 'move', deltaMin: 1440 + 200, schritt: 1440 });
  assert.equal(r.start, T('2026-07-14T08:00')); assert.equal(r.end, T('2026-07-14T18:00'));
  const k = gezogen({ start: s, end: e, modus: 'move', deltaMin: 5, schritt: 1440 });
  assert.deepEqual(k, { start: s, end: e }, 'ein paar Pixel verschieben nichts');
});
test('Monate: Ende ziehen behaelt die Uhrzeit des Endes, Start ebenso', () => {
  const s = T('2026-07-13T08:00'), e = T('2026-07-13T17:00');
  const r = gezogen({ start: s, end: e, modus: 'end', deltaMin: 2 * 1440, schritt: 1440 });
  assert.equal(r.end, T('2026-07-15T17:00')); assert.equal(r.start, s);
  const q = gezogen({ start: s, end: T('2026-07-20T17:00'), modus: 'start', deltaMin: -1440, schritt: 1440 });
  assert.equal(q.start, T('2026-07-12T08:00'));
});
test('Wochen (60): Start 10:20 bleibt 10:20 nach 0 Stunden Zug, 90 min werden 2 Stunden', () => {
  const s = T('2026-07-13T10:20'), e = T('2026-07-13T12:20');
  assert.deepEqual(gezogen({ start: s, end: e, modus: 'move', deltaMin: 10, schritt: 60 }), { start: s, end: e });
  assert.equal(gezogen({ start: s, end: e, modus: 'move', deltaMin: 90, schritt: 60 }).start, T('2026-07-13T12:20'));
});
test('Monate ueber die Sommerzeit-Nacht 25.10.2026: Uhrzeit bleibt, Dauer in echten Minuten', () => {
  const s = T('2026-10-25T01:00'), e = T('2026-10-25T04:00');
  const r = gezogen({ start: s, end: e, modus: 'move', deltaMin: 1440, schritt: 1440 });
  assert.equal(r.start, T('2026-10-26T01:00'));
  assert.equal(r.end - r.start, e - s);
  assert.equal(T('2026-10-26T01:00') - s, 1500, 'der Tag hat 25 Stunden');
});
test('planMinute: Versatz 5 liefert 5 min frueher', () => {
  const o = { T0: 1000, px: 0.5 };
  const a = planMinute(100, { ...o, versatz: 0 });
  const b = planMinute(100, { ...o, versatz: 5 });
  assert.equal(a, 1200); assert.equal(b, a - 5);
});

console.log('\nKalendertage');
test('naechsteMitternacht: 25.10.2026 (Ende der Sommerzeit) hat 25 Stunden', () => {
  const a = T('2026-10-25T00:00');
  assert.equal(naechsteMitternacht(a), T('2026-10-26T00:00'));
  assert.equal(naechsteMitternacht(a) - a, 1500);
});
test('naechsteMitternacht: 29.03.2026 (Beginn der Sommerzeit) hat 23 Stunden', () => {
  const a = T('2026-03-29T00:00');
  assert.equal(naechsteMitternacht(a) - a, 1380);
});
test('naechsteMitternacht: 23:59 und 00:00 am Monatsende', () => {
  assert.equal(naechsteMitternacht(T('2026-08-30T23:59')), T('2026-08-31T00:00'));
  assert.equal(naechsteMitternacht(T('2026-08-31T00:00')), T('2026-09-01T00:00'));
});

console.log('\nplanSpanne');
const P = (extra = {}) => ({ project: { start: '2027-07-26T00:00', end: '2027-08-12T06:00' }, tasks: [], phases: [], ...extra });
test('planSpanne: Phase nach Projektende verlängert die Achse', () => {
  const r = planSpanne(P({ phases: [{ id: 'ph1', art: 'abbau', start: '2027-08-20T08:00', end: '2027-08-30T19:00' }] }));
  assert.equal(r.bis, T('2027-08-30T19:00'));
  assert.equal(r.von, T('2027-07-26T00:00'));
});
test('planSpanne: Vorgang vor Projektstart verlängert nach links', () => {
  const r = planSpanne(P({ tasks: [{ id: 'a', start: '2027-07-20T08:00', end: '2027-07-20T10:00' }] }));
  assert.equal(r.von, T('2027-07-20T08:00'));
  assert.equal(r.bis, T('2027-08-12T06:00'));
});
test('planSpanne: Vorgang nach Projektende verlängert nach rechts', () => {
  const r = planSpanne(P({ tasks: [{ id: 'a', start: '2027-08-13T08:00', end: '2027-08-14T10:00' }] }));
  assert.equal(r.bis, T('2027-08-14T10:00'));
});
test('planSpanne: leerer Plan = Projektzeitraum', () => {
  assert.deepEqual(planSpanne(P()), { von: T('2027-07-26T00:00'), bis: T('2027-08-12T06:00') });
  assert.deepEqual(planSpanne({ project: P().project }), { von: T('2027-07-26T00:00'), bis: T('2027-08-12T06:00') });
});
test('planSpanne: terminloser Vorgang und Phase ohne Zeit ändern nichts', () => {
  const r = planSpanne(P({ tasks: [{ id: 'a', start: null, end: null }, { id: 'b' }], phases: [{ id: 'p', art: 'abbau', start: null, end: null }] }));
  assert.deepEqual(r, { von: T('2027-07-26T00:00'), bis: T('2027-08-12T06:00') });
});
test('planSpanne: Plan innerhalb des Projekts lässt es unverändert', () => {
  const r = planSpanne(P({ tasks: [{ id: 'a', start: '2027-08-01T08:00', end: '2027-08-01T10:00' }] }));
  assert.deepEqual(r, { von: T('2027-07-26T00:00'), bis: T('2027-08-12T06:00') });
});

console.log('\nEngpass und Puffer');
const titel = (id) => ({ s2: 'Steelday 2', an: 'Anlieferung' }[id]);
test('engpassText: Nachfolger mit Luft', () => {
  assert.equal(engpassText({ nachbarId: 's2', richtung: 'nach', typ: 'FS', luft: 900 }, titel), '15 h Luft bis Steelday 2 (Ende → Start)');
});
test('engpassText: Vorgänger mit Luft', () => {
  assert.equal(engpassText({ nachbarId: 'an', richtung: 'vor', typ: 'FS', luft: 1140 }, titel), '19 h Luft nach Anlieferung (Ende → Start)');
});
test('engpassText: Luft 0 schließt direkt an', () => {
  assert.equal(engpassText({ nachbarId: 's2', richtung: 'nach', typ: 'FS', luft: 0 }, titel), '0 min Luft — Steelday 2 schließt direkt an');
  assert.equal(engpassText({ nachbarId: 'an', richtung: 'vor', typ: 'FS', luft: 0 }, titel), '0 min Luft — schließt direkt an Anlieferung an');
});
test('engpassText: negative Luft = Überlappung', () => {
  assert.equal(engpassText({ nachbarId: 's2', richtung: 'nach', typ: 'FS', luft: -120 }, titel), 'überlappt Steelday 2 um 2 h');
});
test('engpassText: Typ-Wörter', () => {
  const t = (typ) => engpassText({ nachbarId: 's2', richtung: 'nach', typ, luft: 60 }, titel);
  assert.equal(t('SS'), '1 h Luft bis Steelday 2 (Start → Start)');
  assert.equal(t('FF'), '1 h Luft bis Steelday 2 (Ende → Ende)');
  assert.equal(t('SF'), '1 h Luft bis Steelday 2 (Start → Ende)');
});
test('engpassText: null bleibt null', () => assert.equal(engpassText(null, titel), null));
test('fmtPuffer: Kettenende nur ohne Nachfolger', () => {
  assert.equal(fmtPuffer({ float: 0 }, false), '— Kettenende');
  assert.equal(fmtPuffer({ float: 900 }, true), fmtFloat(900));
});
test('kettenEnde: nur mit Vorgänger und ohne Nachfolger', () => {
  assert.equal(kettenEnde([{ from: 'a', to: 'x' }], 'x'), true);
  assert.equal(kettenEnde([], 'x'), false);
  assert.equal(kettenEnde([{ from: 'x', to: 'b' }], 'x'), false);
  assert.equal(kettenEnde([{ from: 'a', to: 'x' }, { from: 'x', to: 'b' }], 'x'), false);
});
test('fmtPuffer + kettenEnde: Kettenende nur mit Vorgänger, ohne Links Puffertext', () => {
  const s = { float: 0 };
  assert.equal(fmtPuffer(s, !kettenEnde([{ from: 'a', to: 'x' }], 'x')), '— Kettenende');
  assert.equal(fmtPuffer(s, !kettenEnde([], 'x')), fmtFloat(0));
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
