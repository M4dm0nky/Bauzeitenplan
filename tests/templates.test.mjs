import { TEMPLATES, planFromTemplate } from '../js/templates.js';
import { createStore } from '../js/store.js';
import { findConflicts } from '../js/conflicts.js';
import { computeSchedule, toMin, ohneTermin } from '../js/schedule.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { const r = fn(); if (r && typeof r.then === 'function') throw new Error('async-Test im synchronen Helfer — nicht erlaubt'); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
};

const VON = '2026-09-14T06:00';
const BIS = '2026-09-20T22:00';
const build = (key) => planFromTemplate(key, { name: 'Test', venue: 'Halle', von: VON, bis: BIS, timezone: 'Europe/Berlin' });
// Der frühere Stand MIT Terminen: die Vorlage trägt ihre Offsets (at/dur) weiter.
const mitTerminen = (key) => {
  const tpl = TEMPLATES.find((t) => t.key === key);
  const p = build(key);
  const anchor = new Date(VON).getTime();
  const f = (m) => { const d = new Date(anchor + m * 60000); const z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };
  p.tasks.forEach((t, i) => { t.start = f(tpl.tasks[i].at); t.end = f(tpl.tasks[i].at + tpl.tasks[i].dur); });
  return p;
};

console.log('\nVorlagen — Grundlagen');
test('es gibt fünf Vorlagen', () => assert.equal(TEMPLATES.length, 5));
test('jede Vorlage hat Schlüssel, Namen und Beschreibung', () => {
  for (const t of TEMPLATES) {
    assert.ok(t.key && t.name && t.description, 'unvollständig: ' + t.key);
  }
});
test('Schlüssel sind eindeutig', () => {
  const k = TEMPLATES.map((t) => t.key);
  assert.equal(new Set(k).size, k.length);
});
test('kein Gewerkname doppelt innerhalb einer Vorlage', () => {
  for (const t of TEMPLATES) {
    const n = t.gewerke.map((x) => x.toLowerCase());
    assert.equal(new Set(n).size, n.length, t.key + ' hat doppelte Gewerke');
  }
});
test('keine Vorlage überschreitet 16 Gewerke', () => {
  // Darüber trägt die Palette die Identität nicht mehr (8 Farben × 2 Schraffuren)
  for (const t of TEMPLATES) assert.ok(t.gewerke.length <= 16, t.key + ': ' + t.gewerke.length);
});
test('unbekannter Schlüssel fällt auf «leer» zurück statt zu werfen', () => {
  const p = planFromTemplate('gibtsnicht', { name: 'X', von: VON, bis: BIS });
  assert.ok(p.tasks.length === 0);
});

console.log('\nVorlage bringt keinen Demo-Status mit');
test('alle Vorgänge starten «geplant» mit 0 % — Status setzt nur ein Mensch', () => {
  for (const tpl of TEMPLATES) {
    for (const t of build(tpl.key).tasks) {
      assert.equal(t.status, 'geplant', tpl.key + ': ' + t.title);
      assert.equal(t.progress, 0, tpl.key + ': ' + t.title);
    }
  }
});

console.log('\nVorlage legt Vorgänge OHNE Termin an');
test('jeder Vorgang und Meilenstein hat start und end null', () => {
  for (const tpl of TEMPLATES) {
    const p = build(tpl.key);
    for (const t of p.tasks) {
      assert.equal(t.start, null, tpl.key + ': ' + t.title);
      assert.equal(t.end, null, tpl.key + ': ' + t.title);
      assert.ok(ohneTermin(t));
    }
  }
});
test('Projektzeitraum ist Event Von/Bis aus dem Dialog', () => {
  for (const tpl of TEMPLATES) {
    const p = build(tpl.key);
    assert.equal(p.project.start, VON);
    assert.equal(p.project.end, BIS);
  }
});
test('keine Vorlagen-Phasen mehr', () => {
  for (const tpl of TEMPLATES) assert.ok(!(build(tpl.key).phases || []).length, tpl.key);
});
test('Meilensteine bleiben Meilensteine, Verknüpfungen bleiben erhalten', () => {
  const p = build('festival');
  assert.ok(p.tasks.some((t) => t.milestone));
  assert.ok(p.deps.length > 0);
});
test('die «Crew»-Bezeichnung steht im Projekt', () => {
  assert.deepEqual(build('festival').project.ressourcen.map((r) => r.id), ['crew']);
});
test('jedes Projekt bekommt eine eigene id', () => {
  const a = build('festival'), b = build('tour');
  assert.notEqual(a.project.id, b.project.id);
});

console.log('\nVorlagen sind in sich stimmig');
for (const tpl of TEMPLATES) {
  test(`«${tpl.key}»: jeder Vorgang zeigt auf ein vorhandenes Gewerk`, () => {
    const p = build(tpl.key);
    const ids = new Set(p.gewerke.map((g) => g.id));
    for (const t of p.tasks) {
      assert.ok(t.gewerk === 'projekt' || ids.has(t.gewerk), `«${t.title}» → unbekanntes Gewerk ${t.gewerk}`);
    }
  });

  test(`«${tpl.key}»: jede Verknüpfung zeigt auf vorhandene Vorgänge`, () => {
    const p = build(tpl.key);
    const ids = new Set(p.tasks.map((t) => t.id));
    // Wichtig: planFromTemplate filtert unbekannte Schlüssel STILL heraus.
    // Deshalb hier gegen die Vorlage zählen, nicht gegen das Ergebnis.
    const keys = new Set(tpl.tasks.filter((t) => t.key).map((t) => t.key));
    for (const [f, to] of tpl.deps) {
      assert.ok(keys.has(f), `${tpl.key}: Verknüpfung nennt unbekannten Vorgänger «${f}»`);
      assert.ok(keys.has(to), `${tpl.key}: Verknüpfung nennt unbekannten Nachfolger «${to}»`);
    }
    for (const d of p.deps) {
      assert.ok(ids.has(d.from) && ids.has(d.to));
    }
  });

  test(`«${tpl.key}»: Ende liegt nie vor dem Start (Offsets der Vorlage)`, () => {
    const p = mitTerminen(tpl.key);
    for (const t of p.tasks) {
      const d = toMin(t.end) - toMin(t.start);
      if (t.milestone) assert.equal(d, 0, `Meilenstein «${t.title}» hat Dauer ${d}`);
      else assert.ok(d > 0, `«${t.title}» hat Dauer ${d}`);
    }
  });

  test(`«${tpl.key}»: keine Ringe`, () => {
    const p = build(tpl.key);
    assert.doesNotThrow(() => computeSchedule(p.tasks, p.deps));
  });

  test(`«${tpl.key}»: der Store nimmt die Vorlage an`, () => {
    // Fängt alles, was die Store-Validierung ablehnen würde — z.B. leere Titel.
    const p = build(tpl.key);
    const s = createStore({ project: p.project, gewerke: [], tasks: [], deps: [] });
    for (const g of p.gewerke) {
      const r = s.apply({ type: 'addGewerk', gewerk: g });
      assert.notEqual(r.ok, false, `Gewerk «${g.name}»: ${r.error}`);
    }
    for (const t of p.tasks.filter((x) => x.gewerk !== 'projekt')) {
      const r = s.apply({ type: 'addTask', task: t });
      assert.notEqual(r.ok, false, `Vorgang «${t.title}»: ${r.error}`);
    }
  });

  test(`«${tpl.key}»: keine Konflikte — die Vorlage ist widerspruchsfrei`, () => {
    // Eine Vorlage, die schon rot startet, wäre eine schlechte Vorlage.
    const p = mitTerminen(tpl.key);
    const c = findConflicts(p);
    assert.deepEqual(c, [], c.map((x) => {
      const t = p.tasks.find((y) => y.id === x.taskId);
      return `«${t && t.title}» ${x.message}`;
    }).join(' | '));
  });
}

console.log('\nFestival — der abgenommene Stand bleibt erhalten');
test('8 Gewerke, 40 Vorgänge', () => {
  const p = build('festival');
  assert.equal(p.gewerke.length, 8);
  assert.equal(p.tasks.length, 40);
});
test('der kritische Pfad läuft über Bühne → Rigging → Ton (mit Terminen)', () => {
  const p = mitTerminen('festival');
  const sched = computeSchedule(p.tasks, p.deps);
  const crit = p.tasks.filter((t) => sched.get(t.id).critical).map((t) => t.title);
  assert.ok(crit.includes('Podest & Unterbau'), 'Bühne fehlt');
  assert.ok(crit.includes('Traversen fliegen'), 'Rigging fehlt');
  assert.ok(crit.includes('Soundcheck'), 'Ton fehlt');
  assert.ok(!crit.includes('Fokus & Programmierung'), 'Licht hat Puffer und darf nicht kritisch sein');
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
