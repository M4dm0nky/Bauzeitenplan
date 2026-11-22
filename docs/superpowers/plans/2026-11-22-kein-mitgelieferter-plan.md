# Kein mitgelieferter Plan — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die App öffnet und holt nie mehr einen mitgelieferten Plan; die JSONs werden reine Testdaten; Griffe auf Touch-Geräten sind per Tastatur erreichbar; Scheibensuche binär.

**Architecture:** Mechanismus `BUNDLED`/`openBundled` restlos aus app.js, print.js, sync.js entfernen; JSON-Dateien nach `tools/fixtures/`; neue Hilfe `tools/plan-fixture.mjs` seedet den Plan per `addInitScript` in den localStorage; `?plan=leer` bleibt der Testschalter. CSS-Regel für Griffe erweitert; `scheibe`/`scheibeBis` binär.

**Tech Stack:** Vanilla JS ES-Module, node:test (`tests/*.test.mjs`), Playwright-core (Firefox + Chromium) in `tools/verify-*.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-22-kein-mitgelieferter-plan-design.md`

## Global Constraints

- Nie `window.prompt`/`confirm`/`alert`; Bestätigung nur `askDialog`.
- Kommentare auf Deutsch, mit Begründung; Antworten/Berichte auf Deutsch.
- Store ist der einzige Weg, den Plan zu ändern; DOM-freie Module bleiben DOM-frei.
- `?plan=leer` behält sein Verhalten: aktives, sonst erstes Projekt ohne Dialog; ohne Projekt der Dialog.
- Keine Datei neu anlegen/löschen, ohne `HUELLE` in `sw.js` und die Sollliste in `tests/run.mjs` nachzuziehen.
- Jeder Subagent beendet Server/Browser, die er startet; `node tests/run.mjs` vor jedem Commit grün.
- Commit-Trailer: `Co-Authored-By: Claude <Modell> <noreply@anthropic.com>`.

## Review Focus

1. Frischer Browser mit `?plan=klassentreffen`: Projektdialog, kein `.json`-Abruf (Task 3 Negativprüfung).
2. Live-Monitor (`bzp_live=1`, aktives Projekt): öffnet das aktive Projekt ohne Abruf, ohne Dialog (Task 3).
3. Altes Projekt mit `project.quelle` in localStorage öffnet über die Projektzeile direkt, ohne Dialog «Zwei Fassungen» (Task 3, verify-klassentreffen).
4. `print.html` ohne aktives Projekt: Fehlermeldung «Kein Projekt in diesem Browser» bleibt (Task 2, verify-print Negativfall).
5. Touch-Tipp auf Balken A lässt Griff B unsichtbar UND nicht tippbar (`visibility: hidden`), Tastaturfokus macht ihn sichtbar (Task 4).

---

### Task 1: App ohne mitgelieferte Pläne

**Files:**
- Modify: `js/app.js` (Block «Mitgelieferte Pläne» ab Zeile ~102 bis `neuer()` ~223; `bootLokal` ~232–257; Projektzeile ~1648–1655; Dialogabschnitt ~1678–1694; Import aus sync.js Zeile 8)
- Modify: `js/print.js` (Zeilen 23–27, `ladePlan` 94–112)
- Modify: `js/sync.js` (`planHash`, `unveraendert` 143–157 entfernen, Kommentar 125 anpassen)
- Modify: `tests/sync.test.mjs` (Tests 248–263 entfernen, Import anpassen)
- Move: `klassentreffen-festival.json` → `tools/fixtures/klassentreffen-festival.json`; `amk-singleshow.json` → `tools/fixtures/amk-singleshow.json` (per `git mv`)
- Modify: `tools/make-klassentreffen.mjs:649`, `tools/make-amk.mjs:169` (Zielpfad `fixtures/`), `tests/persistence.test.mjs:528-533` (Pfad `../tools/fixtures/`)
- Modify: `sw.js` HUELLE (zwei Zeilen 76–77 weg), `tests/run.mjs:350` (die zwei Namen aus `soll` weg)
- Test: `tests/run.mjs` neue Struktursperre

**Interfaces:**
- Produces: `bootLokal()`: `?plan=<x>` mit `x !== 'leer'` wird ignoriert (wie ohne Parameter → Dialog). Projektzeile: immer `open(pl)`. Live: immer `open(aktiv)`. `print.js ladePlan()`: nur localStorage (aktiv → erstes → Fehler).
- Keine `quelle`-Felder löschen; `gleicherPlan` bleibt (Sync braucht es).

- [ ] **Step 1: Struktursperre schreiben (rot)** in `tests/run.mjs` neben «der Sync-Schlüssel (bzp_sync) kommt nie in die Plan-Schicht»:

```js
check('die App holt keinen mitgelieferten Plan (kein BUNDLED/openBundled, kein fetch einer .json in js/)', () => {
  const treffer = [];
  for (const f of rekursivJs) {            // alle js/*.js, wie die Import-Prüfung sie listet
    const s = readFileSync(join(root, f), 'utf8');
    if (/\bBUNDLED\b|openBundled|bundledKey/.test(s)) treffer.push(f + ': BUNDLED/openBundled');
    if (/fetch\([^)]*\.json/.test(s)) treffer.push(f + ': fetch(.json)');
  }
  return treffer.length ? treffer.join(' | ') : true;
});
```

- [ ] **Step 2: `node tests/run.mjs` → rot** mit `js/app.js: BUNDLED/openBundled`, `js/print.js: …`.
- [ ] **Step 3: app.js umbauen.** Block ersetzen durch Kommentar: «// ── Start ── Kein mitgelieferter Plan: die App holt nie eine JSON von selbst (Marco, 2026-11-22). Pläne kommen nur über Import, Vorlage oder Sync. `?plan=leer` ist der Schalter der Prüfwerkzeuge.» `bootLokal`: `wunsch === 'leer'`-Zweig bleibt, der Direktlink-Zweig und `bundledKey` am Live-Pfad entfallen (`if (live && aktiv && await open(aktiv)) return;`). Projektzeile: `if (await open(pl)) close();`. Dialogabschnitt «Mitgelieferte Pläne» samt `h3` entfernen. Import: `planHash, unveraendert` aus Zeile 8 streichen.
- [ ] **Step 4: print.js:** `BUNDLED` und Zweig 97–105 entfernen; `VERSION`-Import nur behalten, wenn noch benutzt (`grep -n VERSION js/print.js`).
- [ ] **Step 5: sync.js:** `planHash`, `unveraendert` samt Kommentar entfernen; `tests/sync.test.mjs` entsprechend.
- [ ] **Step 6: Dateien verschieben** (`git mv`), `make-*.mjs` Zielpfad `join(here, 'fixtures', '…json')`, `persistence.test.mjs` Pfad, `sw.js` HUELLE, `tests/run.mjs` Sollliste. `mkdir` nicht nötig (`tools/fixtures/` existiert).
- [ ] **Step 7: `node tests/run.mjs` → grün**, auch «kein Export, den niemand importiert» und HUELLE-Prüfung.
- [ ] **Step 8: Dialog-Grep leer:** `grep -rn "window\.prompt\|[^.]prompt(\|confirm(\|alert(" js/*.js` (Kommentare ausgenommen).
- [ ] **Step 9: Commit** `feat(app): kein mitgelieferter Plan mehr, JSONs sind Testdaten`.

---

### Task 2: Prüfhilfe und Prüfskripte Druck, Showablauf, Browser, AMK

**Files:**
- Create: `tools/plan-fixture.mjs`
- Modify: `tools/verify-print.mjs` (Zeilen 39, 178, 197, 221, 245, 249, 256, 291, 298, 308), `tools/verify-showablauf.mjs` (78, 552, 668, 883, 1351, 1426, 1521, 1541, 1564), `tools/verify-browser.mjs` (563, 621, Kommentar 74), `tools/verify-amk.mjs:41`, `tools/verify-edit.mjs:2736, 2772` (nur die zwei Stellen mit `?plan=klassentreffen`/`fetch('/klassentreffen-festival.json')`)

**Interfaces:**
- Produces: `export function planSeed(datei)` → `{ plan: object, id: string, scripts: string }`: liest `tools/fixtures/<datei>`, `id = plan.project.id`, `scripts` = JS-Text, der `localStorage` setzt: `bzp_p_<id>` = Dateitext, `bzp_projects` = `[{id, name: plan.project.name, venue: plan.project.venue || '', modified: new Date().toISOString(), remoteSha: null, dirty: false}]`, `bzp_active` = id. `export async function planLaden(ziel, datei = 'klassentreffen-festival.json')` → `ziel.addInitScript(scripts)` (Page oder BrowserContext), gibt `id` zurück. `export const FIXTURES = join(here, 'fixtures')`.
- Consumes: Task 1 (`?plan=leer` öffnet aktives Projekt; `print.html` liest aktives Projekt).

- [ ] **Step 1: `tools/plan-fixture.mjs`** schreiben (Kopfkommentar: warum localStorage statt Import-Knopf: ein Seed je Seite statt eines Imports je Theme; Import-Tür prüfen verify-klassentreffen/verify-amk weiter).
- [ ] **Step 2: verify-print:** vor jedem `goto(... print.html?plan=klassentreffen)` die betroffene Page/Context mit `planLaden` seeden, Adresse `print.html` (Parameter `ansicht`/`ebene`/`abschnitt` bleiben). Die zwei `fetch('/klassentreffen-festival.json')` in `page.evaluate` ersetzen durch `localStorage.getItem('bzp_p_klassentreffen-festival-2026')`. Negativfall ergänzen: frischer Context ohne Seed → `print.html` zeigt Text «Kein Projekt in diesem Browser».
- [ ] **Step 3: verify-showablauf, verify-browser, verify-edit (zwei Stellen), verify-amk (Pfad `FIXTURES`)** ebenso umstellen. verify-browser Zeile 74 Kommentar: «?plan=leer: Testschalter, öffnet das gesetzte Projekt ohne Dialog».
- [ ] **Step 4: Lauf:** `node tools/verify-print.mjs`, `verify-showablauf.mjs`, `verify-browser.mjs`, `verify-amk.mjs` → je «bestanden»/0 Probleme; `node tests/run.mjs` grün. Ausgabe nur gefiltert (`grep -E "✗|bestanden|Problem"`).
- [ ] **Step 5: Commit** `test: Prüfskripte laden den Plan als Testdaten statt per Direktlink`.

---

### Task 3: Prüfskripte Live, Sync, Edit, Klassentreffen mit Negativprüfung

**Files:**
- Modify: `tools/verify-live.mjs` (Block «LIVE-MONITOR UND NEUER PLANSTAND IN DER DATEI» ~425–535), `tools/verify-sync.mjs` (Block «MITGELIEFERTER PLAN (R1)» ~832–870), `tools/verify-edit.mjs` (Teil «(d) Mitgelieferten Plan aus dem Projektdialog öffnen» ~1668–1680), `tools/verify-klassentreffen.mjs` (Abschnitte «DIREKTLINK ?plan=klassentreffen», «ohne Projekte: Dialog mit … Mitgelieferte Pläne», «Zwei Fassungen» ~167–365, Seeds 369, 448, 488, 625)

**Interfaces:**
- Consumes: `planLaden`, `planSeed` aus Task 2.

- [ ] **Step 1: verify-live:** Block ersetzen durch «LIVE-MONITOR ÖFFNET DAS AKTIVE PROJEKT OHNE ABRUF»: Seed, `bzp_live=1`, Route-Zähler auf `**/*.json*` (ohne `?v=`-Modulabrufe: nur Pfade, die auf `.json` enden), `goto('/index.html')` → `#proj-name` enthält «Klassentreffen», `#dlg` hidden, Zähler 0. Dasselbe mit `?plan=klassentreffen` → Projekt offen (aktiv) und Zähler 0.
- [ ] **Step 2: verify-sync:** Block «MITGELIEFERTER PLAN (R1)» auf Seed umstellen (`planLaden(A.context, …)` vor `start(A)`), Überschrift «PLAN AUS DEM LOCALSTORAGE (R1)», Prüfnamen ohne «Direktlink».
- [ ] **Step 3: verify-edit (d):** Statt mitgeliefertem Plan eine zweite eigene Projektzeile anklicken (Projekt «Alpha» existiert laut Block (a)–(c), prüfen); Erwartung unverändert: Dialog «Nicht gespeichert», Abbrechen → Projektdialog bleibt, Projekt bleibt «Beta».
- [ ] **Step 4: verify-klassentreffen Negativprüfungen (rot zuerst):** Abschnitt «KEIN MITGELIEFERTER PLAN»: (a) frischer Context, Zähler auf `.json`-Abrufe, `goto('?plan=klassentreffen')` → `#dlg` sichtbar, kein `.dlg-h3` mit Text «Mitgelieferte Pläne», Zähler 0; (b) Seed eines Plans, dessen `project.quelle = {datei:'klassentreffen-festival.json', exported:'2000-01-01T00:00:00.000Z'}` (Altbestand), Projektzeile im Dialog anklicken → Projekt offen, kein Dialog «Zwei Fassungen», Zähler 0. Rot-Nachweis ohne `git stash`: `js/app.js` und `js/print.js` kurz vom Stand VOR Task 1 holen (`git checkout <BASE-Hash aus dem Auftrag> -- js/app.js js/print.js`), Lauf zeigt ✗ bei (a) und (b), dann `git checkout HEAD -- js/app.js js/print.js`. Ergebnis im Bericht nennen.
- [ ] **Step 5: Lauf:** `verify-live`, `verify-sync`, `verify-edit`, `verify-klassentreffen` → grün; `node tests/run.mjs` grün.
- [ ] **Step 6: Commit** `test: Negativprüfung «kein mitgelieferter Plan», Live/Sync/Edit umgestellt`.

---

### Task 4: Griffe auf Hybridgeräten

**Files:**
- Modify: `styles/base.css:323-329`
- Test: `tools/verify-edit.mjs`, Touch-Block ab ~1809 (Chromium, `hasTouch: true, isMobile: true`)

- [ ] **Step 1: Prüfung schreiben (rot):** im Touch-Kontext nach Laden: Tipp auf ersten `.bz-bar` (wird `is-sel`); `h2` = `.bz-link` des zweiten Balkens (`[data-link-from="<id>"]`): `getComputedStyle(h2).visibility === 'hidden'`; dann `page.keyboard.press('Tab')` so oft, bis `document.activeElement` der zweite Balken ist (höchstens 10, sonst Fehlermeldung) → `h2` Klasse `is-on` und `visibility === 'visible'`; `activeElement.blur()` → wieder `hidden`.
- [ ] **Step 2: Lauf → ✗** («visibility hidden trotz Fokus»).
- [ ] **Step 3: CSS:** Regel `.bz-link:not(.is-sel):not(.is-on) { visibility: hidden; }`, Kommentar ergänzen: «is-on kommt auf Touch nur über Tastaturfokus (`:focus-visible`) oder Zeiger auf dem Griff; der Fingertipp setzt es nicht (gantt.js bindLink), also bleibt der Kreis nach einem Tipp unantastbar.»
- [ ] **Step 4: `node tools/verify-edit.mjs` → grün** (gefiltert). Bestehende Prüfung «Griff am nicht gewählten Balken fängt keinen Tipp» muss weiter grün sein.
- [ ] **Step 5: Commit** `fix(gantt): Verknüpfen-Griff auf Touch per Tastatur erreichbar`.

---

### Task 5: Scheibensuche binär

**Files:**
- Modify: `js/resources.js:128-141`
- Test: `tests/resources.test.mjs`

- [ ] **Step 1: Test (rot nur für Export):** `export function scheibeIndex(grenzen, m, exklusiv = false)` — liefert größtes i in `[0, n-2]` (n = grenzen.length) mit `grenzen[i] <= m` (exklusiv: `< m`); i = 0, wenn keins. Test: 200 Zufallsfälle gegen die lineare Referenz (im Test ausgeschrieben), Grenzfälle `m === grenzen[k]` beide Modi, `m < grenzen[0]`, `m > grenzen[n-1]`, `grenzen.length === 1` → 0.
- [ ] **Step 2: Lauf → rot** («scheibeIndex is not a function»).
- [ ] **Step 3: Implementieren** (binäre Suche), `scheibe`/`scheibeBis` in `bedarfsRaster` rufen `scheibeIndex(grenzen, m)` bzw. `scheibeIndex(grenzen, m, true)`; Kommentar zur Gleitkomma-Begründung bleibt.
- [ ] **Step 4: `node tests/run.mjs` → grün** (inkl. bestehende 19 resources-Tests).
- [ ] **Step 5: Commit** `perf(resources): Scheibensuche binär`.

---

### Task 6: Doku

**Files:**
- Modify: `README.md:134-160`, `CLAUDE.md:16-17, 50-51`, `.claude/rules/sync-offline.md:17`, `docs/entscheidungen.md:948-980`, `CHANGELOG.md` (neuer Abschnitt `## Unreleased — kein mitgelieferter Plan`), `docs/superpowers/plans/2026-11-22-kein-mitgelieferter-plan.md` (Häkchen)

- [ ] **Step 1:** README: Absätze «Weitergeben», «Neuer Planstand», `?plan=amk` ersetzen durch: Pläne kommen per Import/Export oder Sync; `?plan=leer` ist ein Testschalter; `tools/make-klassentreffen.mjs` baut Testdaten nach `tools/fixtures/`.
- [ ] **Step 2:** CLAUDE.md: Zeile 50 ersetzen («**Die App holt nie eine Plan-JSON:** kein `BUNDLED`/`openBundled`; `tests/run.mjs` sperrt es. Testdaten in `tools/fixtures/`.»), Zeile 51 ohne `?plan=<key>`, verify-Kommentar Zeile 17 («V07-Plan importieren + Negativprüfung Direktlink»). Längenlimit 130 Zeilen/9 200 Zeichen prüfen (`node tests/run.mjs`).
- [ ] **Step 3:** sync-offline.md Absatz 17 ersetzen durch eine Zeile zur Sperre; entscheidungen.md Abschnitt umschreiben («Der Start fragt, und die App holt nichts von selbst» mit Marcos Anlass 2026-11-22); CHANGELOG-Abschnitt mit vier Punkten (kein mitgelieferter Plan, Testdaten verschoben, Griffe, Scheibensuche).
- [ ] **Step 4:** `grep -rn "openBundled\|BUNDLED\|Mitgelieferte\|mitgeliefert\|?plan=klassentreffen\|?plan=amk" README.md CLAUDE.md .claude/rules docs/*.md` → nur noch historische Stellen in CHANGELOG/entscheidungen (als Vergangenheit formuliert).
- [ ] **Step 5:** `node tests/run.mjs` grün; Commit `docs: kein mitgelieferter Plan`.

---

### Volllauf (Controller)

Alle neun Prüfungen parallel (`voll`-Skript im Scratchpad an den Worktree angepasst); Screenshots `tools/shots/klassentreffen-*.png` ansehen; Dialog-Grep leer; keine Prozesse übrig.
