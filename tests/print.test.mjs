// Die reinen Teile der Tagesblätter. js/print.js zieht beim Import die Seite auf
// (DOM), deshalb reicht hier ein minimaler Stub — geprüft werden die Funktionen,
// nicht das Rendern. Das Rendern prüft tools/verify-print.mjs im echten Browser.
globalThis.document = {
  createElement: () => ({ style: { setProperty() {} }, classList: { add() {}, toggle() {} }, dataset: {}, append() {} }),
  createElementNS: () => ({ setAttribute() {} }),
  getElementById: () => ({ replaceChildren() {}, append() {}, lastChild: { append() {} } }),
};
globalThis.location = { search: '' };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = () => Promise.reject(new Error('kein Netz im Test'));

const { notizFuerDruck, tageZwischen, fensterFuer } = await import('../js/print.js');
const { plan } = await import('../tools/make-klassentreffen.mjs');
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); } };

console.log('\nTagesblätter — Notiz fürs Blatt');
test('Dienstleister und Kopfzahl bleiben stehen', () => {
  assert.equal(notizFuerDruck('StageCo · Tag 1 von 3'), 'StageCo · Tag 1 von 3');
  assert.equal(notizFuerDruck('36StageXL · Michael + 4 Helfer'), '36StageXL · Michael + 4 Helfer');
});
test('Quellenhinweise fallen weg — sie gelten dem PDF, nicht der Arbeit', () => {
  // Sonst stünde bei «Sanitäter vor Ort» eine Bemerkung übers Quelldokument da,
  // wo die Firma hingehört.
  assert.equal(notizFuerDruck('Mobi Hub · Uhrzeit in V07 nicht angegeben'), 'Mobi Hub');
  assert.equal(notizFuerDruck('Uhrzeit in V07 nicht angegeben'), '');
  assert.equal(notizFuerDruck('BEST · Ende in V07 «open»'), 'BEST');
  assert.equal(notizFuerDruck('Wölkchen · Kram · schließende Klammer in V07 nicht gedruckt'), 'Wölkchen · Kram');
});
test('lange Stücklisten werden gekürzt, nicht abgeschnitten', () => {
  const t = plan.tasks.find((x) => x.title === 'Anlieferung Container');
  const s = notizFuerDruck(t.notes);
  assert.ok(s.length <= 38, s.length + ' Zeichen');
  assert.ok(s.endsWith('…'), 'gekürzt wird sichtbar gemacht');
  assert.ok(s.startsWith('Wölkchen'), 'der Dienstleister steht vorn');
});
test('keine Notiz gibt einen leeren String, keinen Absturz', () => {
  assert.equal(notizFuerDruck(''), '');
  assert.equal(notizFuerDruck(null), '');
  assert.equal(notizFuerDruck(undefined), '');
});

console.log('\nTagesblätter — Tage und Zeitfenster');
test('tageZwischen liefert jeden Kalendertag einschließlich der Ränder', () => {
  assert.deepEqual(tageZwischen('2026-08-29', '2026-09-01'),
    ['2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01']);
  assert.deepEqual(tageZwischen('2026-08-29', '2026-08-29'), ['2026-08-29']);
});
test('der ganze Klassentreffen-Plan sind 14 Blätter', () => {
  assert.equal(tageZwischen('2026-08-21', '2026-09-03').length, 14);
});

const gw = (name) => plan.gewerke.find((g) => g.name === name).id;
const ohne = (...namen) => {
  const raus = new Set(namen.map(gw));
  return plan.tasks.filter((t) => !raus.has(t.gewerk));
};
const AUFBAU = tageZwischen('2026-08-21', '2026-08-28');

test('mit allen Gewerken braucht ein Aufbautag die vollen 24 Stunden', () => {
  assert.deepEqual(fensterFuer(plan.tasks, AUFBAU), { von: 0, bis: 24 });
});
test('ohne Security schrumpft ein einzelner Aufbautag auf 08–18 Uhr', () => {
  // Der eigentliche Zweck des Wegklickens: allein die Objektbewachung
  // (00:01–23:59) zwingt das Blatt sonst auf 24 Stunden. Am 24.08. läuft sonst
  // nichts außerhalb von 08–18 — aus 14 mm je Stunde werden 34.
  assert.deepEqual(fensterFuer(plan.tasks, ['2026-08-24']), { von: 0, bis: 24 });
  assert.deepEqual(fensterFuer(ohne('Security'), ['2026-08-24']), { von: 8, bis: 18 });
});
test('über die ganze Aufbauwoche bleibt das Einleuchten bis Mitternacht drin', () => {
  // 27. und 28.08. leuchten 21:00–00:00 ein. Das gemeinsame Fenster muss das
  // tragen, sonst fehlte auf dem Blatt Arbeit, die stattfindet.
  const f = fensterFuer(ohne('Security'), AUFBAU);
  assert.equal(f.von, 8, 'der Aufbau beginnt um 08:00');
  assert.equal(f.bis, 24, 'und reicht bis Mitternacht');
});
test('das Fenster gilt über ALLE gewählten Blätter, damit sie vergleichbar sind', () => {
  // Der 23.08. allein liefe 08–18; zusammen mit dem 21.08. (bis 24:00 wegen der
  // Objektbewachung) muss das gemeinsame Fenster beide tragen.
  const eng = fensterFuer(ohne('Security'), ['2026-08-23']);
  const weit = fensterFuer(ohne('Security'), ['2026-08-23', '2026-08-30']);
  assert.ok(weit.bis > eng.bis, 'der Showtag zieht das Fenster auf');
});
test('leere Auswahl liefert den ganzen Tag statt NaN', () => {
  assert.deepEqual(fensterFuer([], AUFBAU), { von: 0, bis: 24 });
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
