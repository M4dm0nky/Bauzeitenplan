import { TEMPLATES, planFromTemplate } from '../js/templates.js';
import { createStore } from '../js/store.js';
import { findConflicts } from '../js/conflicts.js';
import { computeSchedule, toMin } from '../js/schedule.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
};

const LOAD_IN = '2026-09-14T06:00';
const build = (key) => planFromTemplate(key, { name: 'Test', venue: 'Halle', loadIn: LOAD_IN, timezone: 'Europe/Berlin' });

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
  const p = planFromTemplate('gibtsnicht', { name: 'X', loadIn: LOAD_IN });
  assert.ok(p.tasks.length === 0);
});

console.log('\nVerschiebung auf das eigene Datum');
test('Aufbaubeginn liegt genau auf dem angegebenen Datum', () => {
  // Festival: Anlieferung Bühnenteile ist der Anker (Offset 0)
  const p = build('festival');
  const t = p.tasks.find((x) => x.title === 'Anlieferung Bühnenteile');
  assert.equal(t.start, '2026-09-14T06:00');
});
test('Projektzeitraum umschließt alle Vorgänge', () => {
  for (const tpl of TEMPLATES) {
    const p = build(tpl.key);
    if (!p.tasks.length) continue;
    const s = Math.min(...p.tasks.map((t) => toMin(t.start)));
    const e = Math.max(...p.tasks.map((t) => toMin(t.end)));
    assert.ok(toMin(p.project.start) <= s, tpl.key + ': Projektstart liegt nach dem ersten Vorgang');
    assert.ok(toMin(p.project.end) >= e, tpl.key + ': Projektende liegt vor dem letzten Vorgang');
  }
});
test('relative Abstände bleiben bei anderem Datum erhalten', () => {
  const a = planFromTemplate('festival', { name: 'A', loadIn: '2026-09-14T06:00' });
  const b = planFromTemplate('festival', { name: 'B', loadIn: '2027-03-02T06:00' });
  const dauer = (p, titel) => {
    const t = p.tasks.find((x) => x.title === titel);
    return toMin(t.end) - toMin(t.start);
  };
  assert.equal(dauer(a, 'Podest & Unterbau'), dauer(b, 'Podest & Unterbau'));
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

  test(`«${tpl.key}»: Ende liegt nie vor dem Start`, () => {
    const p = build(tpl.key);
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
    const p = build(tpl.key);
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
test('der kritische Pfad läuft über Bühne → Rigging → Ton', () => {
  const p = build('festival');
  const sched = computeSchedule(p.tasks, p.deps);
  const crit = p.tasks.filter((t) => sched.get(t.id).critical).map((t) => t.title);
  assert.ok(crit.includes('Podest & Unterbau'), 'Bühne fehlt');
  assert.ok(crit.includes('Traversen fliegen'), 'Rigging fehlt');
  assert.ok(crit.includes('Soundcheck'), 'Ton fehlt');
  assert.ok(!crit.includes('Fokus & Programmierung'), 'Licht hat Puffer und darf nicht kritisch sein');
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
