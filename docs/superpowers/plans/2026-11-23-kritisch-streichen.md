# «Kritisch» streichen, Mouseover mit Luft, Achse über alles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den Begriff «kritisch» entfernen, im Mouseover/Panel die echte Pufferzahl und die knappste Verknüpfung zeigen und die Zeitachse über Projektzeitraum, Vorgänge und Phasen spannen.

**Architecture:** Rechnung DOM-frei in `schedule.js` (`engpass` je Vorgang) und `timeaxis.js` (`planSpanne`, `engpassText`); gantt.js/inspector.js/app.js zeigen nur an. Kein neues Modul.

**Tech Stack:** Vanilla JS, ES-Module, kein Build. Tests: `node tests/run.mjs`; Browser: `tools/verify-*.mjs` (Playwright/Firefox).

**Spec:** `docs/superpowers/specs/2026-11-23-kritisch-stoss-mouseover-design.md`

## Global Constraints

- Branch `kritisch-einrichten`; ein Commit pro Task; Trailer `Co-Authored-By: Claude <Modell> <noreply@anthropic.com>`.
- Rechenlogik DOM-frei (`schedule.js`, `timeaxis.js`); neue Logik → Test in `tests/*.test.mjs`.
- Zeiten nur über `toMin()` aus echten Zeitstempeln, nie Ziffern auf Datumsstrings.
- Kein `confirm/alert/prompt`.
- Token `--crit` BLEIBT (wird für Verzug, Sync-Fehler, Löschen genutzt); nur Kritisch-Regeln fallen.
- Gestartete Prozesse (Server, Browser) beenden.

## Review Focus

- Vorgang ohne Termin, verknüpft mit einem terminierten: kein `engpass` über diese Kante, kein Absturz. → Test in Task 1.
- Ring in den Verknüpfungen: `computeSchedule` wirft wie bisher; Tooltip/Panel zeigen dann keinen Engpass statt Fehler. → Test Task 1 (wirft), Task 4 (Panel fängt, wie heute `try`).
- Alter Plan mit `ackCrit: true` importieren: lädt, Feld weg, keine Ungesichert-Marke. → Test Task 3.
- Leerer Plan (keine Vorgänge, keine Phasen): `planSpanne` = Projektzeitraum. → Test Task 2.
- Meilenstein (Dauer 0) als Nachbar: Luft korrekt (FS: `b.start − a.end`). → Test Task 1.

---

### Task 1: `engpass` je Vorgang in `computeSchedule`

**Files:**
- Modify: `js/schedule.js:292-379` (`computeSchedule`)
- Test: `tests/schedule.test.mjs`

**Interfaces:**
- Produces: `computeSchedule(tasks, deps)` → Map; jeder Eintrag hat zusätzlich
  `engpass: null | { depId: string, nachbarId: string, richtung: 'vor'|'nach', typ: 'FS'|'SS'|'FF'|'SF', luft: number /*Minuten*/ }`
  (`richtung: 'nach'` = Nachbar ist Nachfolger). Export `luftDerVerknuepfung(dep, von, nach) → number`.
  `critical`/`minFloat` bleiben in diesem Task noch (Task 3 entfernt sie).

- [ ] **Step 1: Failing tests** in `tests/schedule.test.mjs`:
  - `luftDerVerknuepfung` je Typ, lag 30: FS a 08–10, b 11–12 → `b.start − (a.end+30)` = 30; SS → `11:00 − (08:00+30)` = 150; FF → `12:00 − (10:00+30)` = 90; SF → `12:00 − (08:00+30)` = 210.
  - Festwiese-Form: Anlieferung 09.08. 06–14, Steelday 1 10.08. 09–18, Steelday 2 11.08. 09–18, FS Anl→S1, FS S1→S2 → `engpass('s1')` = `{ nachbarId:'s2', richtung:'nach', typ:'FS', luft: 900 }` (15 h; S1 hat zur Anlieferung 19 h = 1140, also gewinnt S2). `engpass('s2').luft === 900, richtung 'vor'`.
  - Überlappung: FS a 08–10, b 09–11 → `engpass('a').luft === -60`.
  - Meilenstein m 10:00 (start=end) nach a 08–10 FS → `engpass('m').luft === 0`.
  - unverknüpft → `engpass === null`; terminloser Nachbar (`start:null,end:null`) → `null`.
- [ ] **Step 2:** `node tests/schedule.test.mjs` → FAIL (`luftDerVerknuepfung` nicht exportiert).
- [ ] **Step 3:** Implementieren: `luftDerVerknuepfung` nach Spec-Formeln (geplante Zeiten über `toMin`, `lag ?? 0`); in `computeSchedule` nach dem Backward pass je terminiertem Vorgang über `predOf`/`succOf` die Kante mit kleinster Luft wählen (Gleichstand: erste in `deps`-Reihenfolge).
- [ ] **Step 4:** `node tests/schedule.test.mjs` → alles PASS.
- [ ] **Step 5:** Commit `feat(schedule): engpass = knappste Verknüpfung je Vorgang`.

### Task 2: `planSpanne` — Achse über Zeitraum, Vorgänge, Phasen

**Files:**
- Modify: `js/timeaxis.js` (neue Funktion), `js/gantt.js:138-139` und `:1398`, `js/bedarf.js:47`, `js/print.js:591-592`
- Test: `tests/timeaxis.test.mjs`, `tools/verify-browser.mjs`

**Interfaces:**
- Produces: `planSpanne(state) → { von: number, bis: number }` (Minuten wie `toMin`), Hülle aus `project.start/end`, allen Vorgängen mit `start`/`end` (terminlose ignoriert) und allen `phases`.

- [ ] **Step 1: Failing tests** in `tests/timeaxis.test.mjs`: Projekt 26.07.–12.08. 06:00 + Phase bis 30.08. 19:00 → `bis === toMin('2027-08-30T19:00')`; Vorgang ab 20.07. 08:00 → `von` = dieser; leerer Plan → Projektzeitraum; terminloser Vorgang ändert nichts.
- [ ] **Step 2:** `node tests/timeaxis.test.mjs` → FAIL.
- [ ] **Step 3:** `planSpanne` implementieren; einsetzen: gantt.js Bauzeitenplan-Zweig `T0/T1`, `weekendBands(toDate(von), toDate(bis))`, bedarf.js Tag-Zweig `von/bis`, print.js Rückfall (wenn `alle` leer) statt `project.start/end`.
- [ ] **Step 4:** In `tools/verify-browser.mjs` Prüfung «Phase nach Projektende sichtbar»: Plan per `tools/plan-fixture.mjs` seeden, vorher per `page.evaluate` eine Phase 10 Tage nach `project.end` über den Store anlegen (`addPhase`), dann prüfen, dass ihr Element in der Phasenleiste eine Breite > 0 und `left` < Canvasbreite hat. Rot-Nachweis: mit altem `T1 = project.end` schlägt die Prüfung fehl (einmal lokal zeigen, dann zurück).
- [ ] **Step 5:** `node tests/run.mjs` und `node tools/verify-browser.mjs` grün; Screenshot ansehen.
- [ ] **Step 6:** Commit `fix(gantt): Achse spannt über Zeitraum, Vorgänge und Phasen (planSpanne)`.

### Task 3: «Kritisch» entfernen

**Files:**
- Modify: `js/schedule.js` (`critical`, `minFloat`, `anchored`, `isolated`-Kritischlogik und Doku-Kommentar 292-308), `js/gantt.js:386-456, 533-558, 1166-1168, 1883-1899`, `js/app.js:373-375, 1400-1401, 1781-1888` (Kachel, Kritisch-Abschnitt; Konflikt-Abschnitt bleibt; `openReview(focus)` nur noch `'konflikt'`), `js/inspector.js:294-295` (vorerst `fmtFloat`), `js/store.js:109, 356` (`ackCrit` raus), `js/persistence.js:167-169` (`delete t.ackCrit`), `index.html:209` (`ft-crit`), alle fünf `styles/themes/*.css` (`.bz-crit-tag`, `.is-crit`, `.bz-ah-c`, `.ft-crit`, `.kpi:last-child .kpi-v`)
- Test: `tests/schedule.test.mjs:75-176, 525-534`, `tests/templates.test.mjs:166-173`, `tests/store.test.mjs:1216`, `tests/persistence.test.mjs`, `tests/run.mjs`

**Interfaces:**
- Consumes: Task 1 (`engpass`).
- Produces: `computeSchedule` ohne `critical`/`minFloat`; `gantt.stats()` ohne `crit`; kein `gantt.criticals()`.

- [ ] **Step 1: Failing tests:** `tests/run.mjs` Struktursperre: in `js/*.js` kein Treffer für `/\.critical\b|ackCrit|criticals\(|minFloat|KRIT|is-crit/` (Kommentarzeilen ausgenommen, zeilenbasiert wie die fetch-Sperre); in `styles/themes/*.css` kein `is-crit|bz-crit-tag|ft-crit`. `tests/persistence.test.mjs`: `deserialize` eines Plans mit `ackCrit: true` → Vorgang hat kein `ackCrit`-Feld, `ok`. Kritisch-Tests in schedule/templates/store löschen bzw. auf `float`/`engpass` umstellen (templates: Licht «Fokus & Programmierung» hat `float > 0`).
- [ ] **Step 2:** `node tests/run.mjs` → Sperre FAIL.
- [ ] **Step 3:** Entfernen wie unter Files; Kopf-Kacheln danach: Gewerke/Bühnen, Vorgänge/Zeiteinträge, läuft, Crew (Konflikte bleiben über `#resolve`).
- [ ] **Step 4:** `node tests/run.mjs` grün.
- [ ] **Step 5:** Commit `refactor: Begriff «kritisch» entfällt — Überlappung bleibt Konflikt`.

### Task 4: Mouseover und Panel zeigen Puffer und Engpass

**Files:**
- Modify: `js/timeaxis.js` (neben `fmtFloat`), `js/gantt.js:1476-1503` (`bindTip`), `js/inspector.js:290-297`
- Test: `tests/timeaxis.test.mjs`, `tools/verify-edit.mjs:241-264, 444-446`

**Interfaces:**
- Consumes: Task 1 `engpass`; Task 3 (kein `critical`).
- Produces: `engpassText(engpass, titelVon: (id) => string) → string | null` und `fmtPuffer(sched, hatNachfolger: boolean) → string`.

- [ ] **Step 1: Failing tests** (`tests/timeaxis.test.mjs`), exakte Texte:
  - `engpassText({nachbarId:'s2',richtung:'nach',typ:'FS',luft:900}, t)` → `'15 h Luft bis Steelday 2 (Ende → Start)'`
  - richtung `'vor'`, luft 1140, Nachbar Anlieferung → `'19 h Luft nach Anlieferung (Ende → Start)'`
  - luft 0 → `'0 min Luft — Steelday 2 schließt direkt an'` (bei `'vor'`: `'0 min Luft — schließt direkt an Anlieferung an'`)
  - luft −120 → `'überlappt Steelday 2 um 2 h'`
  - Typ-Wörter: FS `Ende → Start`, SS `Start → Start`, FF `Ende → Ende`, SF `Start → Ende`; Dauer über `fmtDur`.
  - `null` → `null`. `fmtPuffer({float:0}, false)` → `'— Kettenende'`; `fmtPuffer({float:900}, true)` → `fmtFloat(900)`.
- [ ] **Step 2:** `node tests/timeaxis.test.mjs` → FAIL.
- [ ] **Step 3:** Implementieren; `bindTip`: Zeile `Puffer` = `fmtPuffer`, danach `Engpass` = `engpassText` (nur wenn nicht null). Inspector: Feld «Puffer» = `fmtPuffer`, darunter Feld «Engpass» (Klasse `ins-ro`).
- [ ] **Step 4:** `tools/verify-edit.mjs`: Abschnitt «PRÜF-LISTE: KRITISCH» (241-264) ersetzen durch «Mouseover zeigt Engpass»: über einen verknüpften Balken hovern, `.bz-tip` enthält `/Luft (bis|nach) .+\(/`. Zeile 444-446: Panel zeigt «Puffer» und «Engpass». `verify-browser.mjs:194-196` («kritischer Pfad markiert») ersetzen: `.is-crit`-Anzahl === 0 und Tooltip-Engpass vorhanden.
- [ ] **Step 5:** `node tests/run.mjs`, `node tools/verify-edit.mjs`, `node tools/verify-browser.mjs` grün; Screenshot des Mouseovers ansehen.
- [ ] **Step 6:** Commit `feat: Mouseover und Panel zeigen Puffer und knappste Verknüpfung`.

### Task 5: Doku und Volllauf

**Files:** `docs/entscheidungen.md:35-53`, `CLAUDE.md` (Aufbau-Tabelle `schedule.js` «kritischer Pfad»), `.claude/rules/store-daten.md` (Abhaken-Satz: nur `ackConflictMin`), `.claude/rules/gantt-darstellung.md`, `README.md`, `CHANGELOG.md` (Abschnitt «Unveröffentlicht»).

- [ ] **Step 1:** `grep -rn -i "kritisch\|critical\|ackCrit\|KRIT\|minFloat" README.md CHANGELOG.md CLAUDE.md docs/*.md .claude/rules/*.md` und jede Stelle nachziehen (Historie im CHANGELOG bleibt). `entscheidungen.md`-Abschnitt ersetzen: «Kritisch entfiel (2026-11-23)», Anlass Festwiese, Überlappung = Konflikt.
- [ ] **Step 2:** Alle neun Prüfungen aus CLAUDE.md parallel: `node tests/run.mjs` + acht `tools/verify-*.mjs` → alle grün; Screenshots ansehen. `grep -rn "window\.prompt\|[^.]prompt(\|confirm(\|alert(" js/*.js` leer.
- [ ] **Step 3:** Festwiese gegenrechnen: `computeSchedule` auf `pmwltssqe0.json` aus dem Daten-Repo → Steelday 1 Engpass 15 h zu Steelday 2.
- [ ] **Step 4:** Commit `docs: kritisch entfällt, planSpanne, Engpass`.
