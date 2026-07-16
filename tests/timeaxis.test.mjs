import { zoomAnchored, ticksFor, isoWeek, tickScale, nearestPreset, clampZoom, weekendBands, fitPx, ZOOM } from '../js/timeaxis.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
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

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
