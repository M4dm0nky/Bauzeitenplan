# Prüfpaket v0.19.1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die 19 bestätigten Funde der Komplettprüfung beheben (18 Korrekturen, eine neue Funktion «Plan verschieben»), jede mit einer Prüfung, die vorher rot war.

**Architecture:** Korrekturen im DOM-freien Kern (`store.js`, `persistence.js`, `sync.js`, `schedule.js`) mit Unit-Tests; Verdrahtung in `app.js`, `gantt.js`, `inspector.js`, `print.js` mit Prüfungen in den vorhandenen `tools/verify-*.mjs`. Kein neues Modul; neue Dialoge über `askDialog` und den `.dlg`-Baustein aus app.js.

**Tech Stack:** Vanilla JS (ES-Module, kein Build), Node-Testläufer `tests/run.mjs` (eigener `test()`-Helfer je Datei, `node:assert/strict`), Playwright-core/Firefox für `tools/verify-*.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-20-pruefpaket-design.md`

## Global Constraints

- Arbeitsordner: Worktree auf Branch `fix/pruefpaket` (ab `main`). Nie im Dropbox-Repo arbeiten.
- `CLAUDE.md` und `.claude/rules/*.md` gelten vollständig: Store ist der einzige Weg, Validierung VOR der Änderung (abgelehnter Befehl hinterlässt nichts), Kernmodule ohne DOM, neue Felder durch `addTask`, keine Browser-Dialoge (`grep -rn "window\.prompt\|[^.]prompt(\|confirm(\|alert(" js/*.js` bleibt leer), Zeiten über `toMin()`/`new Date(y,m,d+n,…)`, nie Ziffernarithmetik.
- Testmuster: bestehende Datei erweitern (`test('…', () => {…})` wie dort; `tests/sync.test.mjs` sammelt asynchron in `tests[]`). Ablehnung eines Store-Befehls: `r.ok === false` mit `r.error` (String).
- Rot-Nachweis: jeden neuen Test/Check VOR der Korrektur laufen lassen und das Fehlschlagen im Bericht nennen.
- Nur betroffene Testdatei bzw. betroffenes verify-Skript laufen lassen, Ausgabe gefiltert (`| grep -E '✗|FAIL|Error|bestanden|Alle'`). Volllauf in Task 11.
- Gestartete Server/Browser beenden; nach Abbruch `ps -ef | grep -E "verify-|firefox|http.server"` prüfen.
- Kommentare auf Deutsch, Begründung statt Beschreibung, im Stil der Datei. Wortlaut in der Oberfläche: Deutsch, «Zeiteintrag» im Showablauf.
- Keine Version stempeln, nicht pushen, nicht mergen, kein Tag.
- Commit-Trailer: `Co-Authored-By: Claude <Modell> <noreply@anthropic.com>` mit dem Modell, das committet.
- Modell je Task steht in der Überschrift (Sonnet = Logik, Haiku = Mechanik nach exakter Anweisung).

## Review Focus

1. Sync: Token verliert Repo-Zugriff (GitHub 404 auf die Liste) → kein lokales Projekt verschwindet, Status rot «Repo nicht sichtbar» (Task 3, Test in `tests/sync.test.mjs` + Check in `verify-sync.mjs`).
2. Zwei Tabs: Tab A tippt gerade (800-ms-Timer offen), Tab B speichert → Tab A verliert nichts, bekommt den Dreiknopf-Dialog (Task 5, Check in `verify-sync.mjs`).
3. Start mit `bzp_live=1` und aktivem Projekt → kein Dialog, Projekt offen, Live an (Task 4, Check in `verify-live.mjs`).
4. Import einer 300-Zeilen-Datei mit einem Ring → Ablehnung nennt die beteiligten Vorgänge, nichts importiert, keine JS-Fehler (Task 2, `tests/persistence.test.mjs`).
5. Plan verschieben um −7 Tage über die Sommerzeit-Grenze hinweg → Uhrzeiten bleiben, Dauer in echten Minuten bleibt, Phasen und Projektzeitraum wandern mit (Task 1, `tests/store.test.mjs`).

---

### Task 1 (Sonnet): Store — Feldlisten, `fuer`-Kaskade, `shiftPlan` (Funde 16, 17, 18)

**Files:**
- Modify: `js/store.js` (`removeTask` 329-352, `setDepField` 431-437, `removeGewerk` 460-468, `setGewerkField` 523-543, neuer Handler `shiftPlan`)
- Test: `tests/store.test.mjs`

**Interfaces:**
- Produces: Befehl `{ type: 'shiftPlan', tage: number, minuten: number }` → `ok()`; Ablehnung «Tage und Minuten müssen ganze Zahlen sein.» / «Nichts zu verschieben.» (beide 0). Verschiebt `start`/`end` aller Vorgänge, `res[].von/bis` (nur gesetzte), `phases[].start/end`, `project.start/end`: erst Tage über `new Date(y, m, d + tage, hh, mm)`, dann `minuten` über `toMin`+`toDate`, Ausgabe über `local()` (conflicts.js, schon importiert). Terminlose bleiben terminlos.
- Produces: interner Helfer `kaskadeIds(state, ids: Set<string>) → Set<string>` (Fixpunkt über `parent` und `fuer`), benutzt von `removeTask` und `removeGewerk`.
- `setDepField`: nur `type` (FS/SS/FF/SF) und `lag` (`Number.isInteger`), sonst «Dieses Feld lässt sich nicht ändern: <feld>». `setGewerkField`: nur `name`; `art`/`abschnitt` behalten ihre bisherigen Meldungen, alles andere dieselbe Ablehnung wie oben.

- [ ] **Step 1: Failing tests** in `tests/store.test.mjs` (Abschnitt «Prüfpaket»):

```js
test('setDepField lehnt fremde Felder und krummen Lag ab', () => {
  const s = createStore(seed());
  assert.equal(s.apply({ type: 'setDepField', id: 'd1', field: 'from', value: 'b' }).ok, false);
  assert.equal(s.apply({ type: 'setDepField', id: 'd1', field: 'lag', value: 1.5 }).ok, false);
  assert.equal(s.apply({ type: 'setDepField', id: 'd1', field: 'lag', value: -120 }).ok, true);
  assert.equal(s.state.deps[0].from, 'a'); assert.equal(s.canUndo, true);
});
test('setGewerkField schreibt nur den Namen', () => {
  const s = createStore(seed());
  assert.equal(s.apply({ type: 'setGewerkField', id: 'buehne', field: 'slot', value: 7 }).ok, false);
  assert.equal(s.apply({ type: 'setGewerkField', id: 'buehne', field: 'id', value: 'x' }).ok, false);
  assert.equal(s.state.gewerke[0].id, 'buehne');
});
test('removeGewerk nimmt Soundchecks auf anderen Bühnen mit (fuer)', () => {
  // seed + Bühne 'b2', Act 'act' in 'buehne', Soundcheck 'sc' in 'b2' mit fuer:'act' → removeGewerk buehne → 'sc' weg
});
test('shiftPlan verschiebt alles um Tage und Minuten, Uhrzeit bleibt über die Sommerzeit', () => {
  // seed mit project.start 2026-10-20, Vorgang 2026-10-24T22:00–2026-10-25T04:00 (6 h echte Dauer = 420 min am 25.10.!),
  // res-Fenster von/bis gesetzt, Phase aufbau 2026-10-24T08:00–2026-10-26T08:00.
  // shiftPlan { tage: 7, minuten: 30 } → start '2026-10-31T22:30', end '2026-11-01T04:30' (Kalendertage, dann +30),
  // res.von/bis ebenso, Phase und project.start/end ebenso; terminloser Vorgang bleibt null/null; ein ⌘Z holt alles zurück.
});
test('shiftPlan lehnt 0/0 und Nicht-Ganzzahlen ab, ohne Undo-Eintrag', () => { /* tage 0 minuten 0 → ok false; tage 1.5 → ok false; canUndo false */ });
```

- [ ] **Step 2: Rot-Nachweis.** `node tests/store.test.mjs | grep -E '✗|bestanden'` — Expected: die fünf neuen ✗.
- [ ] **Step 3: Umsetzen** in `js/store.js` (Signaturen oben). `shiftPlan` verschiebt auf dem `draft` in EINEM Handler; Uhrzeit-Erhalt über den Kalender wie `verschobenUm` in timeaxis.js (nicht importieren — Kern zeigt nicht auf die Ansichtsschicht; dieselbe Zeile nachbauen).
- [ ] **Step 4: Grün.** `node tests/store.test.mjs | grep -E '✗|bestanden'` — Expected: 0 ✗. Dazu `node tests/run.mjs | tail -3` (statische Prüfungen: unbenutzte Exporte).
- [ ] **Step 5: Commit** `fix(store): setDepField/setGewerkField geprueft, fuer-Kaskade bei removeGewerk, shiftPlan`.

---

### Task 2 (Sonnet): Import — Form, Ring, Gewerk/parent, `project.now` (Funde 6, 7, 8, 10)

**Files:**
- Modify: `js/persistence.js` (`migrate` 59-234, `inhaltFehler` 337-353, `deserialize` 355-380)
- Modify: `js/gantt.js:100-104` (`readNow`: `project.now`-Zweig entfernen), `js/gantt.js:1156` (`SCHED.get(d.from)?.critical && SCHED.get(d.to)?.critical`)
- Modify: `js/app.js:1367-1411` (`doImport`: `deserialize` in try/catch, Fehler → `toast(…, 'bad', 8000)`)
- Test: `tests/persistence.test.mjs`

**Interfaces:**
- `deserialize(text)` liefert NIE eine Ausnahme: `{ok:false, error}` mit «Die Datei ist beschädigt: <Grund>» bei falscher Form (`project` kein Objekt; `tasks`/`gewerke`/`deps`/`phases` vorhanden, aber kein Array; ein Eintrag kein Objekt) oder wenn `migrate` wirft.
- `inhaltFehler` lehnt ab: Ring («Ring in den Verknüpfungen: A → B», Titel über `topoSort`-`cycle`), `gewerk` nicht in `gewerke` und nicht `'projekt'` («Vorgang «X»: Unbekanntes Gewerk nix.»), `parent` nicht vorhanden oder selbst mit `parent` («Vorgang «X»: Übergeordneter Vorgang nicht gefunden.» / «… nur eine Ebene»).
- `migrate` löscht `project.now`.

- [ ] **Step 1: Failing tests** in `tests/persistence.test.mjs`: `deserialize` gibt `ok:false` (keine Ausnahme) für `tasks:"abc"`, `tasks:[null]`, `project:"x"`, `gewerke:{}`; lehnt Ring a↔b mit Nennung beider Titel ab; lehnt `gewerk:'nix'`, totes `parent`, parent-Kette (c→b→a) ab; `migrate({project:{now:'2026-08-05T12:00', …}})` hat kein `now`; gültige Datei mit `gewerk:'projekt'` bleibt ok.
- [ ] **Step 2: Rot-Nachweis.** `node tests/persistence.test.mjs | grep -E '✗|bestanden'`.
- [ ] **Step 3: Umsetzen** (persistence.js, gantt.js, app.js wie oben).
- [ ] **Step 4: Grün** + `node tests/run.mjs | tail -3` + `node tools/verify-amk.mjs | tail -3` (Import-Weg im Browser).
- [ ] **Step 5: Commit** `fix(import): kaputte Dateien, Ringe und Waisen werden abgelehnt statt die App zu brechen; project.now entfaellt`.

---

### Task 3 (Sonnet): Sync — Löschen nur nach Rückfrage, Repo-404, gelöschtes offenes Projekt (Funde 1, 3)

**Files:**
- Modify: `js/sync.js:63-71` (`list()`), `js/persistence.js:296-312` (neuer Repo-Helfer), `js/app.js` (`fuehreAus` 680-695, `showProjectDialog` Löschknopf 1433-1448, `sichern` 1258-1274, `beforeunload` 457-461, neue Funktion `loescheProjekt`)
- Test: `tests/sync.test.mjs`, `tests/persistence.test.mjs`, Checks in `tools/verify-sync.mjs`

**Interfaces:**
- `sync.list()`: bei 404 oder Antwort ohne Array → `await pruefe()`; `pruefe` ok → `{ok:true, dateien:[]}`; sonst dessen Fehler (`grund:'repo'|'schluessel'|'offline'|'fehler'`).
- `repo.vergessenRemote(id)`: setzt `remoteSha` auf `null` (dirty unverändert). `repo.syncListe()` liefert danach `remoteSha:null` → `abgleich` ergibt `hochladen`.
- app.js `async loescheProjekt(id)`: ist `id` das offene Projekt → gibt es ein anderes: `await open(anderes)` (bei `false` abbrechen, nichts löschen), dann `entferne(id)`; gibt es keins: `entferne(id)`, `verworfen.add(id)`, `showProjectDialog({firstRun:true})`. Sonst nur `entferne(id)`. `sichern()` und `beforeunload` tun nichts, wenn `store.state.project.id` in `verworfen` steht; `open()` eines anderen Projekts überspringt für eine verworfene id das Sichern. Benutzt vom Dialog-× und von `lokal-loeschen`.
- `lokal-loeschen` in `fuehreAus`: `askDialog({ title: 'Im Daten-Repo gelöscht', message: ['«Name» ist im Daten-Repo nicht mehr vorhanden …'], buttons: [{label:'Behalten und neu hochladen', value:'behalten', primary:true}, {label:'Lokal löschen', value:'loeschen', danger:true}] })`; `null`/`behalten` → `repo.vergessenRemote(id)`, `abgleichNochmal = true`; `loeschen` → `loescheProjekt(id)` + Toast.

- [ ] **Step 1: Failing tests.** `tests/sync.test.mjs`: `list()` mit 404 und Repo-404 → `grund 'repo'`; 404 mit Repo-200 → `dateien []`; 200 mit `{}`-Körper + Repo-404 → `grund 'repo'`. `tests/persistence.test.mjs`: `vergessenRemote` → `syncListe()[0].remoteSha === null`, `dirty` unverändert. `tools/verify-sync.mjs` (Fake mit Schalter «Verzeichnis 404 + Repo 404»): zwei synchrone Projekte bleiben erhalten, Status rot mit «Repo»; Schalter «Datei gelöscht» → Dialog erscheint, «Behalten» → Datei wird erneut hochgeladen (`puts`+1); Löschen des OFFENEN Projekts im Projektdialog mit zweitem Projekt → nach einer Änderung (Alt+→ im Gantt) steht die alte id nicht mehr in `bzp_projects`; ohne zweites Projekt → Erststart-Dialog, nach `Projekt anlegen` ist die alte id weg.
- [ ] **Step 2: Rot-Nachweis** (`node tests/sync.test.mjs`, `node tools/verify-sync.mjs | grep -E '✗|bestanden'`).
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Grün** (`tests/sync.test.mjs`, `tests/persistence.test.mjs`, `tools/verify-sync.mjs`).
- [ ] **Step 5: Commit** `fix(sync): lokal loeschen nur nach Rueckfrage, 404 ist kein leeres Repo, geloeschtes offenes Projekt kehrt nicht zurueck`.

---

### Task 4 (Sonnet): Start — Projektdialog statt Autostart, Nachfrage beim Planstand (Funde 4, 5)

**Files:**
- Modify: `js/app.js` (`openBundled` 126-173, `bootLokal` 182-199, `showProjectDialog` 1414-1537), `CLAUDE.md` (Abschnitt «Die JSON ist die Wahrheit»), `docs/entscheidungen.md` («Der Autostart lädt die JSON …»), `README.md` (Start-Abschnitt per grep «Autostart»/«?plan=»)
- Test: Checks in `tools/verify-klassentreffen.mjs` (Autostart über die Adresse) und `tools/verify-live.mjs`

**Interfaces:**
- `bootLokal()`: `?plan=<key>` → `openBundled(key)` wie bisher; `?plan=leer` → Dialog. Sonst: `lsLies('bzp_live') === '1'` UND `repo.getActive()` lädt → `open(plan)`. Sonst `showProjectDialog({ firstRun: !store })` (Liste nach `modified`, mitgelieferte Pläne, Neu, Import); «Abbrechen» nur, wenn ein Projekt offen ist.
- `openBundled(key)`: Datei neuer UND lokal vorhanden UND `!gleicherPlan(lokal, datei)` → `askDialog` drei Knöpfe: «Neuen Stand nehmen» (primär, wie bisher), «Meine behalten» (lokale öffnen, `project.quelle` der lokalen auf den Stempel der Datei setzen und speichern), «Beide behalten (Kopie)» (lokale Kopie mit neuer id und Name «… (lokal vor Update)» speichern, dann Datei öffnen). `null` = «Meine behalten» ohne Stempel. Gleicher Inhalt → Datei still übernehmen.

- [ ] **Step 1: Failing checks.** `verify-klassentreffen.mjs`: Aufruf ohne `?plan=` bei vorhandenem lokalem Projekt «Alpha» → `#dlg` sichtbar, Zeile «Alpha» vorhanden, kein `#proj-name`-Wechsel bis zum Klick; Klick auf «Alpha» öffnet Alpha. Aufruf ohne Projekte → Dialog mit «Klassentreffen Festival 2026» unter «Mitgelieferte Pläne». `?plan=klassentreffen` weiter direkt. Planstand: lokale Kopie mit geändertem Titel eines Vorgangs und älterem Stempel + Datei → Dialog «Zwei Fassungen»; «Beide behalten» → zwei Projekte, Kopie heißt «… (lokal vor Update)». `verify-live.mjs`: `bzp_live=1` + aktives Projekt → kein Dialog, `#live[aria-pressed=true]`.
- [ ] **Step 2: Rot-Nachweis.**
- [ ] **Step 3: Umsetzen** inkl. Doku (CLAUDE.md-Satz zu `boot()`, entscheidungen.md-Absatz, README).
- [ ] **Step 4: Grün:** `verify-klassentreffen.mjs`, `verify-live.mjs`, `verify-edit.mjs` (hängt an `?plan=leer`), `verify-browser.mjs`.
- [ ] **Step 5: Commit** `feat(start): Projektdialog beim Start, Live-Monitor oeffnet direkt, Nachfrage bei neuem Planstand`.

---

### Task 5 (Sonnet): Zwei Tabs (Fund 2)

**Files:**
- Modify: `js/app.js` (neuer Block «Anderer Tab» neben dem Sync-Block, Listener auf `window` `storage`)
- Test: Check in `tools/verify-sync.mjs` (zwei Seiten in EINEM Kontext)

**Interfaces:**
- `fremderTab(e: StorageEvent)`: Schlüssel `'bzp_p_' + offenId()` → `repo.load(id)`; `gleicherPlan(store.state, plan)` → nichts. Sonst: `ueberschreibenSicher(id)` → `open(plan)` (gleiche id, fragt nie) + Toast «In einem anderen Tab geändert — übernommen». Nicht sicher → `askDialog` «Dieses Projekt wurde in einem anderen Tab geändert» mit «Meine behalten» (primär, `save()` sofort), «Die aus dem anderen Tab nehmen» (`open(plan)`), «Beide behalten (Kopie)» (fremden Stand als Kopie «… (anderer Tab)» speichern). Höchstens ein Dialog gleichzeitig (Merker). Schlüssel `bzp_projects` ohne offenes Projekt → `verworfen.add(id)`, Toast, Projektdialog.

- [ ] **Step 1: Failing check** in `verify-sync.mjs` ohne Sync-Schlüssel: Seite A und B gleicher Kontext, gleiches Projekt. B verschiebt Vorgang «Dach» (Alt+→) → A zeigt nach 1 s `data-from` des Balkens geändert und Toast «anderen Tab». A tippt im Panel (Entwurf offen, Store dirty via Alt+→ ohne Warten) und B ändert → A bekommt den Dialog; «Meine behalten» → localStorage trägt A-Stand.
- [ ] **Step 2: Rot-Nachweis.** — [ ] **Step 3: Umsetzen.** — [ ] **Step 4: Grün** (`verify-sync.mjs`). — [ ] **Step 5: Commit** `fix(app): Aenderungen aus einem anderen Tab werden uebernommen oder erfragt`.

---

### Task 6 (Sonnet): Druck — Zeitumstellung (Fund 9)

**Files:**
- Modify: `js/schedule.js:60-80` (`tagesScheiben`), `js/print.js` (`fensterFuer` 66-78, `blatt` 405-412, `baueFenster` 227-240)
- Test: `tests/schedule.test.mjs`, `tests/print.test.mjs`, Check in `tools/verify-print.mjs`

**Interfaces:**
- `tagesScheiben(tasks, tagISO)`: `b = toMin(naechsterTag(tagISO) + 'T00:00')` mit `naechsterTag` über `new Date(y, m, d + 1, 12)` → `local().slice(0,10)` (Helfer im Modul, nicht exportiert, außer ein Test braucht ihn).
- `fensterFuer` liefert Stunden aus `toDate(s.von).getHours()` (+ Minutenanteil) und für ein Ende um Mitternacht des Folgetags 24; auf einem 25-Stunden-Tag darf `bis` 24 bleiben, die Scheibe läuft dann bis zur echten Mitternacht.
- `blatt()`: `wVon = toMin(tag + 'T' + p2(fv) + ':00')`, `wBis = fb === 24 ? toMin(naechsterTag(tag) + 'T00:00') : toMin(tag + 'T' + p2(fb) + ':00')`; `--pr-grid` aus `spanne / 60` statt `stunden`.

- [ ] **Step 1: Failing tests** (TZ=Europe/Berlin setzt `tests/run.mjs`): `tagesScheiben` Nacht 25.10.2026 22:00–26.10. 02:00 → Blatt 25.10. `bis − von === 120`, Blatt 26.10. 120; Eintrag 30.03.2026 00:15 erscheint NICHT auf Blatt 29.03.; `fensterFuer` am 25.10. mit 12:00–14:00 → `{von:12, bis:14}`. `verify-print.mjs`: Plan mit der Nachtschicht am 25.10.2026 → Blatt 25.10. hat einen Balken bis an die rechte Kante (`is-cut-r`), Blatt 26.10. einen ab der linken Kante, keine JS-Fehler.
- [ ] **Step 2: Rot-Nachweis.** — [ ] **Step 3: Umsetzen.** — [ ] **Step 4: Grün** (`tests/schedule.test.mjs`, `tests/print.test.mjs`, `tests/klassentreffen.test.mjs`, `tools/verify-print.mjs`, Screenshot `tools/shots/druck-*.png` ansehen). — [ ] **Step 5: Commit** `fix(druck): Tagesgrenzen ueber den Kalender, Zeitumstellung verliert keine Stunde mehr`.

---

### Task 7 (Haiku): Mechanische Korrekturen (Funde 11, 13, 14, 15, 19)

**Files:**
- Modify: `js/app.js:444-454` (keydown: vor `if (!mod) return;` → `if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]') && e.key.toLowerCase() === 'z') return;`), `js/app.js:1055` (`liveStats(gantt.sichtbareTasks(), …)`), `js/inspector.js:264-271` (`import { abschnitte } from './ebene.js'` statt `ABSCHNITTE`; Optionen aus `abschnitte(store.state)`, gewählt `t.abschnitt || 'show'`; `ABSCHNITTE`-Import entfernen, wenn sonst unbenutzt), `js/gantt.js:1468` (`d.style.setProperty('--gw', gewerkVar(g.slot)); if (gewerkTexture(g.slot)) d.dataset.tex = '1';`), `.claude/rules/tabelle-einrichten.md:26` und `README.md:227` («vier» → «sechs» Reiter, Reiternamen wie in index.html)
- Test: `tests/run.mjs` (statische Prüfung «gantt.js benutzt kein `g.light`»), Checks in `tools/verify-edit.mjs`

- [ ] **Step 1: Failing checks.** `tests/run.mjs`: `check('gantt.js liest keine erfundene Gewerk-Eigenschaft (g.light)', …)` → grep auf `/\bg\.light\b/` in js/gantt.js. `verify-edit.mjs`: Vorgang per Alt+→ verschoben, dann in der Tabelle ins Titelfeld «QQ» tippen und ⌘Z → Feld enthält weiter «QQ» (bzw. Browser-Undo) und `data-from` des Balkens bleibt verschoben; Panel eines Eintrags mit eigenem Abschnitt «Load-in» zeigt im Abschnittsfeld «Load-in».
- [ ] **Step 2: Rot-Nachweis.** — [ ] **Step 3: Umsetzen** exakt wie oben. — [ ] **Step 4: Grün** (`node tests/run.mjs | tail -3`, `node tools/verify-edit.mjs | grep -E '✗|bestanden'`). — [ ] **Step 5: Commit** `fix: Cmd-Z im Feld, Panel-Abschnitte, Live-Leiste je Sicht, Tooltip-Farbe, Doku Reiter`.

---

### Task 8 (Sonnet): Touch — Verknüpfen-Griff nur am ausgewählten Balken (Fund 12)

**Files:**
- Modify: `styles/base.css:319` (Regel entfernen), `js/gantt.js` `paintSelection` 1117-1133 (nach dem Markieren: alle `.bz-link.is-on` ohne Hover/Fokus löschen; `linkLayer.querySelector('.bz-link[data-link-from="' + id + '"]')` des ausgewählten Vorgangs bekommt `is-on`), `bindLink` 636-661 (`pointerleave`/`blur` dürfen den Griff des AUSGEWÄHLTEN Balkens nicht ausblenden)
- Test: Check in `tools/verify-edit.mjs` (Kontext `hasTouch:true, isMobile:true`, 390×844)

- [ ] **Step 1: Failing check:** auf Touch sind vor der Auswahl alle `.bz-link` unsichtbar (`opacity` 0), nach Tipp auf «Podest» genau einer sichtbar und sein `data-link-from` ist die id von Podest; Beschriftung `.bz-bar-t` des Nachbarbalkens wird von keinem Griff überdeckt (Rechtecke überschneiden sich nicht).
- [ ] **Step 2: Rot-Nachweis.** — [ ] **Step 3: Umsetzen.** — [ ] **Step 4: Grün** (`verify-edit.mjs`, Handy-Screenshot ansehen). — [ ] **Step 5: Commit** `fix(gantt): Touch zeigt den Verknuepfen-Griff nur am ausgewaehlten Balken`.

---

### Task 9 (Sonnet): «Plan verschieben» in der Oberfläche (Fund 18)

**Files:**
- Modify: `index.html` (Reiter Projekt: `<button class="btn" id="plan-verschieben">Plan verschieben…</button>` in der `.ei-row`), `js/app.js` (Handler auf Modulebene bei `#new-proj`; neue Funktion `showShiftDialog()` nach dem Muster von `showProjectDialog`: `.dlg` > `.dlg-box` mit `dlg-h` «Plan verschieben», zwei Felder `type=number` «Tage» und «Minuten» (Vorzeichen erlaubt, Vorgabe 0), Vorschau-Zeile «Aufbaubeginn <alt> → <neu>» aus `aufbauPhase` bzw. `project.start`, Knöpfe «Abbrechen» / «Verschieben» (primär); «Verschieben» → `apply({type:'shiftPlan', tage, minuten})`, Toast «Plan um … verschoben — ⌘Z nimmt es zurück»), `sw.js` unverändert (keine neue Datei), `tests/run.mjs` (die ID-Prüfung «alle in index.html verdrahteten IDs kommen in app.js vor» greift automatisch)
- Test: Check in `tools/verify-edit.mjs`

- [ ] **Step 1: Failing check:** Einrichten → Projekt → «Plan verschieben…» → Tage 7 → Vorschau nennt das Datum +7 → «Verschieben» → Balken «Podest» `data-from` um 7 Kalendertage größer, Phase in der Achse ebenso, ⌘Z stellt alles zurück; 0/0 → Knopf «Verschieben» gesperrt.
- [ ] **Step 2: Rot-Nachweis.** — [ ] **Step 3: Umsetzen.** — [ ] **Step 4: Grün** (`verify-edit.mjs`, `tests/run.mjs`). — [ ] **Step 5: Commit** `feat(app): Plan verschieben (Tage und Minuten) unter Einrichten -> Projekt`.

---

### Task 10 (Haiku): Doku und CHANGELOG

**Files:**
- Modify: `CHANGELOG.md` (Abschnitt «Unreleased»/nächste Version: alle 19 Punkte je ein Satz, im Stil der Datei), `README.md` (Startverhalten, Plan verschieben, Sync-Rückfrage), `CLAUDE.md` (Zeile zu `boot()`/Autostart; neuer Befehl `shiftPlan` im Store-Absatz nur, wenn dort Befehle genannt sind), `.claude/rules/sync-offline.md` («Gelöscht vs. dirty» → «Gelöscht im Repo → Rückfrage; 404 der Liste ist kein leeres Repo»), `.claude/rules/druck.md` (Tagesgrenzen über den Kalender), `docs/entscheidungen.md` (je Entscheidung ein kurzer Absatz: Startdialog, Rückfrage beim Löschen, zwei Tabs, Plan verschieben)

- [ ] **Step 1:** `grep -rn "Autostart\|vier Reiter\|lokal-loeschen\|project.now\|Demo-Übersteuerung" README.md CLAUDE.md .claude/rules docs/*.md` — jede Fundstelle nachziehen.
- [ ] **Step 2:** `node tests/run.mjs | tail -3` (CLAUDE.md-Länge, Rules-Frontmatter, CHANGELOG-Abschnitt).
- [ ] **Step 3: Commit** `docs: Pruefpaket nachgezogen`.

---

### Task 11 (Hauptsitzung): Volllauf und Abnahme

- [ ] `node tests/run.mjs` und alle acht `tools/verify-*.mjs` grün; Screenshots `tools/shots/*` der geänderten Bereiche ansehen (Start-Dialog, Handy-Showablauf, Druck 25.10.).
- [ ] `grep -rn "window\.prompt\|[^.]prompt(\|confirm(\|alert(" js/*.js` leer.
- [ ] Review des gesamten Diffs (Sonnet) gegen Spec; Befunde beheben.
- [ ] Halt: Marco nennt die Versionsnummer; danach `node tools/version.mjs <neu>`, Merge nach `main`, Push, Live-Gegenprüfung, Tag nach Rückfrage.
