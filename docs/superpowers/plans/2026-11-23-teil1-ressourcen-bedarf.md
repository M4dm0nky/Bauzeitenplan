# Teil 1: Eingebaute Helfer/Maschinen in Kategorien + Bedarfsstatus — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feste Helfer-/Maschinen-Bezeichnungen in Kategorien mit gruppierter Suchauswahl, und ein Status je Bedarfszeile (angefragt/bestätigt/abgelehnt) mit Übersicht «Offene Bedarfe» — lauffähig in der heutigen lokalen App, ohne Server.

**Architecture:** Ein neues DOM-freies Modul `js/res-katalog.js` (ohne Imports) hält Kategorien + eingebaute Bezeichnungen; `store.js` und `resources.js` lesen daraus. Eigene Bezeichnungen bleiben in `project.ressourcen` (bekommen `kat`). Der Status steht an der Bedarfszeile in `t.res[]`. Eine gemeinsame Auswahlkomponente `js/res-picker.js` ersetzt die zwei `<select>` (Inspector, Tabelle).

**Tech Stack:** Vanilla JS, ES-Module, kein Build; Tests `node tests/run.mjs` (eigener `test()`-Helfer je Datei, `node:assert/strict`); Browserprüfung Playwright/Firefox (`tools/verify-*.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-23-online-mehrbenutzer-design.md`, Abschnitte 9a und 9b.

## Global Constraints

- Store ist der einzige Weg, den Plan zu ändern; Validierung VOR der Änderung; abgelehnter Befehl hinterlässt nichts.
- Rechenlogik DOM-frei (`res-katalog.js`, `resources.js`, `store.js`, `persistence.js`); neue Logik → Test.
- Neue Felder müssen durch `addTask` (und `setTaskRes`, Export/Import) durch.
- Niemals `window.prompt`/`confirm`/`alert`; Rückfragen `askDialog`, Namenseingabe `neuFragen`/`openNeuFragen`.
- Lange Listen nie als `<select>` → Such-Auswahl.
- Symbole statt Textkürzel; Status nie nur über Farbe (Symbol ⏳ ✓ ✕ + Farbe).
- Neue Datei → `HUELLE` in `sw.js`; neue CSS-Klassen/Bausteine → `needed`-Liste in `tests/run.mjs`.
- Eingebaute ids sind stabil (Export-Lesbarkeit) — ein Test pinnt sie.
- Kategorien und Einträge exakt (Spec 9b):

| kat-id | Label | kind | Einträge (id → Label) |
|---|---|---|---|
| `stapler` | Stapler | maschine | `m-stapler-bis35` Gabelstapler bis 3,5 t · `m-stapler-ueber35` Gabelstapler über 3,5 t · `m-gelstapler-bis35` Geländestapler bis 3,5 t · `m-gelstapler-ueber35` Geländestapler über 3,5 t |
| `telelader` | Teleskoplader | maschine | `m-tele-7` Teleskoplader starr 7 m · `m-tele-14` Teleskoplader starr 14 m · `m-tele-17` Teleskoplader starr 17 m · `m-tele-rotor` Teleskoplader Rotor (16–26 m) |
| `schere-halle` | Scherenbühne Halle (Elektro) | maschine | `m-schere-8` Scherenbühne 8 m · `m-schere-10` Scherenbühne 10 m · `m-schere-12` Scherenbühne 12 m · `m-schere-14` Scherenbühne 14 m |
| `schere-gelaende` | Gelände-Scherenbühne (Diesel, Allrad) | maschine | `m-gelschere-10` Gelände-Scherenbühne 10 m · `m-gelschere-12` … 12 m · `m-gelschere-15` … 15 m · `m-gelschere-18` … 18 m |
| `gelenk` | Gelenkteleskopbühne | maschine | `m-gelenk-16` Gelenkteleskopbühne 16 m · `m-gelenk-20` … 20 m · `m-gelenk-26` … 26 m |
| `buehne-sonst` | Sonstige Bühnen | maschine | `m-raupe` Raupenarbeitsbühne · `m-lkw-buehne` LKW-Arbeitsbühne |
| `sonstiges` | Sonstiges | maschine | `m-mobilkran` Mobilkran · `m-radlader` Radlader · `m-hubwagen` Hubwagen |
| `helfer` | Helfer | personal | `p-stagehand` Stagehand · `p-rigger` Rigger (Höhe) · `p-groundrigger` Ground-Rigger · `p-staplerfahrer` Staplerfahrer · `p-elektro` Elektrofachkraft · `p-runner` Runner |
| `eigene-m` | Eigene Maschinen | maschine | (nur eigene) |
| `eigene-p` | Eigenes Personal | personal | (nur eigene) |

(«…» steht für den vollen Namen wie in der ersten Zeile der Kategorie, z. B. `Gelände-Scherenbühne 12 m`.)

- Status-Werte: `angefragt` (fehlt = angefragt), `bestaetigt`, `abgelehnt`. Symbole: ⏳ angefragt, ✓ bestätigt, ✕ abgelehnt.

## Review Focus

1. **Altplan mit eigener Bezeichnung «Stagehand»** (gleich wie eingebaut, andere Schreibung egal): nach Import genau EIN «Stagehand» in der Auswahl, Zuweisungen zeigen auf `p-stagehand`, Anzahl unverändert. → Test in Task 1 (`migrate`).
2. **Vorgang wird verschoben, nachdem Bedarf bestätigt ist:** Status fällt auf `angefragt` zurück; Verschieben ohne echte Zeitänderung (gleiche Zeit) lässt ihn. → Test in Task 3.
3. **Undo nach Bestätigen** stellt `angefragt` wieder her (ein ⌘Z). → Test in Task 3.
4. **Suche in der Auswahl** «12» findet Scherenbühne 12 m UND Gelände-Scherenbühne 12 m, Kategorien bleiben als Kopf sichtbar; Suche ohne Treffer zeigt «Keine Treffer» + «+ Neu…». → Test in Task 1 (`resGruppen`) + verify in Task 2.
5. **Bereitstellungs-Vorgang** (`bereitstellung:true`): kein Status, nicht in «Offene Bedarfe». → Test in Task 4 (`offeneBedarfe`).

---

### Task 1: Katalog + Datenkern der eingebauten Bezeichnungen

**Files:**
- Create: `js/res-katalog.js`
- Modify: `js/resources.js` (`ressourcen`, `resLabel`, `resKind`, neu `resGruppen`)
- Modify: `js/store.js:47-50` (`LISTEN.ressourcen.eingebaut`), `resBekannt`, `addRessource` (Feld `kat`)
- Modify: `js/persistence.js` (`migrate`: Zusammenlegen gleichnamiger eigener mit eingebauten)
- Modify: `js/gantt.js:21` (Art über `resKind`, nicht direkt `project.ressourcen`)
- Modify: `js/einrichten-status.js:31` (`res` immer `'ok'`, eingebaute existieren immer)
- Modify: `sw.js` (`HUELLE` + `js/res-katalog.js`)
- Test: `tests/resources.test.mjs`, `tests/store.test.mjs`, `tests/persistence.test.mjs`, `tests/einrichten-status.test.mjs`

**Interfaces:**
- Produces (`js/res-katalog.js`, keine Imports):
  - `export const RES_KATEGORIEN: Array<{id, label, kind}>` — Reihenfolge wie Tabelle oben, `eigene-m`/`eigene-p` zuletzt.
  - `export const RES_EINGEBAUT: Array<{id, label, kind, kat}>` — Reihenfolge wie Tabelle.
- Produces (`js/resources.js`):
  - `ressourcen(state, kind?) → Array<{id, label, kind, kat, eingebaut: boolean, sort?}>` — eingebaute (Katalogreihenfolge) + eigene; eigene ohne gültiges `kat` bekommen `eigene-m`/`eigene-p` je `kind`. Reihenfolge: nach Kategorie-Reihenfolge, darin eingebaute vor eigenen, eigene per `nachSort`.
  - `resGruppen(state, kind, query = '') → Array<{kat, label, items: Array<wie ressourcen>}>` — Treffer, wenn `query` (trim, lowercase) im Label ODER im Kategorie-Label vorkommt; leere Gruppen fallen weg.
  - `resLabel(rid, state)`, `resKind(rid, state)` — kennen eingebaute.
- Produces (`store.js`): `addRessource({label, kind, kat?})` — `kat` muss eine Kategorie derselben `kind` sein, sonst Fehlertext `'Unbekannte Kategorie: ' + kat`; ohne `kat` → `eigene-m`/`eigene-p`. Gespeichert als `{id, label, kind, kat}` in `project.ressourcen`. Doppelte Namen gegen eingebaute abgelehnt (bestehende Meldung `'Diese Bezeichnung gibt es schon: '`).

- [ ] **Step 1: Failing tests schreiben**

`tests/resources.test.mjs`:
```js
test('eingebaute ids sind stabil (Export-Lesbarkeit)', () => {
  assert.deepEqual(RES_EINGEBAUT.map((r) => r.id), [
    'm-stapler-bis35','m-stapler-ueber35','m-gelstapler-bis35','m-gelstapler-ueber35',
    'm-tele-7','m-tele-14','m-tele-17','m-tele-rotor',
    'm-schere-8','m-schere-10','m-schere-12','m-schere-14',
    'm-gelschere-10','m-gelschere-12','m-gelschere-15','m-gelschere-18',
    'm-gelenk-16','m-gelenk-20','m-gelenk-26','m-raupe','m-lkw-buehne',
    'm-mobilkran','m-radlader','m-hubwagen',
    'p-stagehand','p-rigger','p-groundrigger','p-staplerfahrer','p-elektro','p-runner']);
});
test('jede eingebaute zeigt auf eine Kategorie derselben Art', () => { /* kat ∈ RES_KATEGORIEN, kind gleich */ });
test('ressourcen ohne eigene = eingebaute einer Art', () => {
  assert.equal(ressourcen({ project: {} }, 'maschine').length, 24);
  assert.equal(ressourcen({ project: {} }, 'personal').length, 6);
});
test('eigene ohne kat landen in eigene-m, hinter den eingebauten', () => { /* {id:'x',label:'Bagger',kind:'maschine'} → kat 'eigene-m', letzter Eintrag */ });
test('resGruppen «12» findet Halle 12 m und Gelände 12 m, Köpfe bleiben', () => {
  const g = resGruppen({ project: {} }, 'maschine', '12');
  assert.deepEqual(g.map((x) => x.kat), ['schere-halle', 'schere-gelaende']);
  assert.deepEqual(g.flatMap((x) => x.items.map((i) => i.id)), ['m-schere-12', 'm-gelschere-12']);
});
test('resGruppen Treffer im Kategorienamen liefert die ganze Kategorie', () => { /* 'stapler' → kat stapler mit 4 Einträgen (+ ggf. telelader nicht) */ });
test('resLabel/resKind kennen eingebaute', () => {
  assert.equal(resLabel('m-tele-14', { project: {} }), 'Teleskoplader starr 14 m');
  assert.equal(resKind('m-tele-14', { project: {} }), 'maschine');
});
```
`tests/store.test.mjs`: `setTaskRes` mit `rid:'p-stagehand'` geht ohne eigene Liste; `addRessource({label:'Gabelstapler bis 3,5 t',kind:'maschine'})` → Fehlertext beginnt mit `'Diese Bezeichnung gibt es schon: '`; `addRessource({label:'Bagger',kind:'maschine',kat:'stapler'})` → gespeichert mit `kat:'stapler'`; `kat:'helfer'` bei `kind:'maschine'` → `'Unbekannte Kategorie: helfer'`; `removeAuswahl({liste:'ressourcen', id:'m-raupe'})` → Text enthält `'fest eingebaut'`.
`tests/persistence.test.mjs`: Plan mit `project.ressourcen:[{id:'sh',label:'stagehand',kind:'personal'}]` und Vorgang `res:[{rid:'sh',n:3,von:null,bis:null}]` → nach `deserialize`: kein eigener `sh` mehr, Vorgang `res[0]` = `{rid:'p-stagehand', n:3, …}`; zweimal migriert = gleiches Ergebnis. Gleichnamig, aber andere `kind` → bleibt unangetastet.

- [ ] **Step 2:** `node tests/run.mjs` → die neuen Tests FAIL (Import `res-katalog.js` fehlt).
- [ ] **Step 3:** `js/res-katalog.js` mit den beiden Konstanten exakt nach Tabelle anlegen.
- [ ] **Step 4:** `resources.js` umstellen (`ressourcen`, `resGruppen`, `resLabel`, `resKind`); `store.js`: `LISTEN.ressourcen.eingebaut = RES_EINGEBAUT.map((r) => [r.id, r.label])`, `resBekannt` zählt eingebaute mit, `addRessource` mit `kat` (über `extra`); Kommentarblock über `addRessource` («keine eingebauten») ersetzen.
- [ ] **Step 5:** `persistence.js` `migrate`: eigene Ressource mit gleichem Label (case-insensitiv, `trim`) UND gleicher `kind` wie eine eingebaute → alle `t.res[].rid` umschreiben, eigenen Eintrag entfernen. Idempotent. Die bestehende `crew`-Migration bleibt davor.
- [ ] **Step 6:** `gantt.js:21` auf `resKind(z.rid, state) !== 'maschine'`; `einrichten-status.js` `res: 'ok'`; `sw.js` `HUELLE` ergänzen; bestehende Tests, die «leer» für Ressourcen erwarten, anpassen.
- [ ] **Step 7:** `node tests/run.mjs` → alles PASS.
- [ ] **Step 8:** Commit `feat: eingebaute Helfer/Maschinen in Kategorien (Datenkern)`.

### Task 2: Gruppierte Such-Auswahl `res-picker` + Verwalten-Liste

**Files:**
- Create: `js/res-picker.js`
- Modify: `js/inspector.js:604-700` (`resBlock`/`resRow`: `<select>` → Picker; «+ Personal»/«+ Maschine» öffnen den Picker statt den ersten Eintrag zu nehmen)
- Modify: `js/table.js:860-930` (`resKasten`: dasselbe)
- Modify: `js/einrichten.js:360-363` bzw. `js/listen-editor.js` (eingebaute je Kategorie schreibgeschützt anzeigen; «+ Personal/+ Maschine» fragt Name UND Kategorie)
- Modify: `styles/base.css` (Picker-Klassen), `sw.js` (`HUELLE`), `tests/run.mjs` (`needed`: `rp-pop`, `rp-kopf`, `rp-item`, `rp-such`)
- Test: `tools/verify-edit.mjs` (neuer Abschnitt «RESSOURCEN-AUSWAHL»)

**Interfaces:**
- Consumes: `resGruppen(state, kind, query)`, `resLabel`, `addRessource({label, kind, kat})`, `neuFragen`/`openNeuFragen` (table.js).
- Produces: `export function openResPicker({ anker: Element, kind: 'personal'|'maschine', state, aktuell?: rid, onWahl: (rid) => void, onNeu: () => void })` — schwebender Kasten (nur einer gleichzeitig, wie `neuFragen`), Suchfeld fokussiert, Gruppen mit Kopfzeile (`rp-kopf`), Einträge (`rp-item`, aktueller markiert), ↑/↓ bewegt, Enter wählt, Escape schließt ohne Änderung, Klick außerhalb schließt. Unten «+ Neu…» (ruft `onNeu`). Keine Treffer → Text «Keine Treffer».

- [ ] **Step 1:** Abschnitt «RESSOURCEN-AUSWAHL» in `tools/verify-edit.mjs` schreiben: Vorgang wählen → «+ Maschine» → Picker offen, 7 Kategorie-Köpfe sichtbar; «12» tippen → genau 2 Einträge; Enter → Zuweisung «Scherenbühne 12 m» am Vorgang; Escape bei offenem Picker → keine neue Zuweisung, kein Undo-Eintrag; Screenshot `rp-offen.png`.
- [ ] **Step 2:** `node tools/verify-edit.mjs` → FAIL im neuen Abschnitt.
- [ ] **Step 3:** `js/res-picker.js` bauen; Inspector und Tabelle darauf umstellen (beide `<select class="ins-res-r">`/`tb-verw-n` für Ressourcen entfallen). «+ Neu…» → `neuFragen` mit Namensfeld und Kategorie-Auswahl (Kategorien derselben `kind`, Vorgabe «Eigene …»), Befehl `addRessource({label, kind, kat})`.
- [ ] **Step 4:** Verwalten-Liste: eingebaute gruppiert und schreibgeschützt (Schloss-Symbol, kein Umbenennen/Löschen), eigene darunter in ihrer Kategorie wie bisher bearbeitbar.
- [ ] **Step 5:** `node tools/verify-edit.mjs` + `node tests/run.mjs` → PASS; Screenshot `rp-offen.png` ansehen (Kategorien lesbar, dunkles Theme).
- [ ] **Step 6:** Commit `feat: Such-Auswahl für Helfer/Maschinen, nach Kategorien gruppiert`.

### Task 3: Bedarfsstatus im Store

**Files:**
- Modify: `js/store.js` (`setTaskRes`, neuer Befehl `setResStatus`, Rückfall bei Zeitänderung in `moveTask`/`setTaskField` start/end/`shiftPlan`/`resNachziehen`, `duplicateTask`)
- Modify: `js/persistence.js` (nur prüfen: `status`/`notiz`/`bestaetigtAm` reisen im Export mit; kein Umschreiben nötig, fehlt = angefragt)
- Test: `tests/store.test.mjs`

**Interfaces:**
- Produces:
  - `RES_STATUS = ['angefragt','bestaetigt','abgelehnt']` exportiert aus `store.js`.
  - Befehl `{type:'setResStatus', id, index, status, notiz?, am?}` — `status ∈ RES_STATUS`, sonst `'Unbekannter Status: ' + status`; Bereitstellungs-Vorgang → `'Eine Bereitstellung hat keinen Status.'`; setzt `status`, `notiz` (gekürzt auf 200 Zeichen, leer → Feld entfernt), `bestaetigtAm = am` (ISO-String vom Aufrufer; Store bleibt uhrfrei) bei `bestaetigt`/`abgelehnt`, entfernt es bei `angefragt`.
  - `setTaskRes`: neue Zeile → `status` fehlt (= angefragt). Geänderte Zeile: bleibt `rid`, `n`, `von`, `bis` gleich → Status/Notiz bleiben; sonst Status-Felder entfernen (= angefragt).
  - Zeitänderung am Vorgang (Start oder Ende ändert sich wirklich) → bei allen Zeilen Status-Felder entfernen. Gleiche Zeit → nichts.
  - `duplicateTask` → Kopie ohne Status-Felder.

- [ ] **Step 1: Failing tests** in `tests/store.test.mjs`:
```js
test('setResStatus bestätigt, Undo holt angefragt zurück', () => { /* status 'bestaetigt', bestaetigtAm gesetzt; undo → kein status-Feld */ });
test('unbekannter Status hinterlässt nichts', () => { /* Fehlertext, canUndo unverändert, dirty unverändert */ });
test('Anzahl ändern setzt bestätigt zurück, gleiche Werte nicht', () => {});
test('Vorgang verschieben setzt bestätigt zurück, gleiche Zeit nicht', () => {});
test('Ende ändern (setTaskField end) setzt zurück', () => {});
test('duplicateTask: Kopie ohne Status, Original behält ihn', () => {});
test('Bereitstellung lehnt setResStatus ab', () => {});
```
- [ ] **Step 2:** `node tests/run.mjs` → FAIL.
- [ ] **Step 3:** Umsetzen wie im Interfaces-Block; Rückfall an EINER Stelle (Hilfsfunktion `statusZurueck(t)`), aufgerufen wo Start/Ende sich wirklich ändern.
- [ ] **Step 4:** `node tests/run.mjs` → PASS.
- [ ] **Step 5:** Commit `feat: Bedarf bekommt Status angefragt/bestätigt/abgelehnt`.

### Task 4: Bedarfsstatus in der Oberfläche + «Offene Bedarfe»

**Files:**
- Modify: `js/resources.js` (neu `offeneBedarfe`), `bedarfsRaster` (bestätigte Menge je Zelle zusätzlich)
- Modify: `js/inspector.js` (`resRow`: Status-Symbol + Bestätigen/Ablehnen), `js/table.js` (`resKasten`: Status-Symbol)
- Modify: `js/bedarf.js` (Bereich «Offene Bedarfe»; Raster zeigt bestätigt/offen unterscheidbar: Zahl + Symbol)
- Modify: `styles/base.css`, Themes falls nötig; `tests/run.mjs` (`needed`: `bd-offen`, `res-st`)
- Test: `tests/resources.test.mjs`, `tools/verify-edit.mjs` (Abschnitt «BEDARF-STATUS»), `tools/verify-browser.mjs` läuft in 5 Themes

**Interfaces:**
- Consumes: `setResStatus` (Task 3), `RES_STATUS`, `resLabel`.
- Produces: `offeneBedarfe(state) → Array<{gewerk: id, tag: 'YYYY-MM-DD', eintraege: Array<{taskId, index, rid, n, von, bis}>}>` — nur Zeilen mit Status `angefragt` (oder fehlend) an Vorgängen ohne `bereitstellung`, ohne `ohneTermin`; Tag = Kalendertag des Zeilenbeginns (Vorgangsstart, wenn `von` null) in lokaler Zeit; sortiert nach Gewerk-`sort`, dann Tag, dann Beginn.
- `bedarfsRaster(...)` liefert je Zelle zusätzlich `bestaetigt: number` (Summe der bestätigten), bestehende Felder unverändert.

- [ ] **Step 1: Failing tests** `tests/resources.test.mjs`: `offeneBedarfe` mit einer bestätigten, einer angefragten, einer Bereitstellungs-Zeile → genau die angefragte; Gruppierung nach Gewerk/Tag; `bedarfsRaster` zählt `bestaetigt` richtig. `verify-edit.mjs` «BEDARF-STATUS»: Zuweisung anlegen → ⏳ sichtbar; in «Offene Bedarfe» «✓ Bestätigen» → Zeile verschwindet aus der Liste, im Panel ✓; Anzahl ändern → wieder ⏳; ⌘Z nach Bestätigen → ⏳. Screenshot `bedarf-offen.png`.
- [ ] **Step 2:** Tests laufen lassen → FAIL.
- [ ] **Step 3:** `offeneBedarfe` + `bestaetigt` im Raster umsetzen.
- [ ] **Step 4:** UI: Symbol je Zeile (`res-st`, `title` = Klartext, abgelehnt mit Notiz im `title`); Bestätigen/Ablehnen-Knöpfe im Panel und in «Offene Bedarfe» (Ablehnen fragt optional eine Notiz über `neuFragen`); «Alle bestätigen» je Gewerk-Tag-Gruppe (ein Befehl je Zeile ist ok, aber als EIN Undo-Schritt nur, wenn der Store einen Sammelbefehl hat — sonst je Zeile; Entscheidung des Umsetzers, im Bericht nennen). `am` = `new Date().toISOString()` in der UI.
- [ ] **Step 5:** `node tests/run.mjs`, `node tools/verify-edit.mjs`, `node tools/verify-browser.mjs` → PASS; Screenshots `bedarf-offen.png` und Theme-Screenshots ansehen.
- [ ] **Step 6:** Commit `feat: Bedarf bestätigen/ablehnen, Übersicht Offene Bedarfe`.

### Task 5: Doku, Regeln, Gesamtprüfung

**Files:**
- Modify: `.claude/rules/personal-maschinen.md` («Keine eingebauten Bezeichnungen» → eingebaute in Kategorien, `res-katalog.js`, Picker, Status), `.claude/rules/auswahllisten.md` (falls Ressourcen erwähnt), `docs/entscheidungen.md` (Abschnitt «keine eingebauten» → neue Entscheidung mit Grund: Marco 2026-11-23, Standardgeräte der Vermieter; Status-Rückfall-Begründung), `README.md`, `CHANGELOG.md` (Abschnitt «Unveröffentlicht»), `CLAUDE.md` (Aufbau-Tabelle: `res-katalog.js`, `res-picker.js`)
- [ ] **Step 1:** `grep -rn "keine eingebauten\|Keine eingebauten\|project.ressourcen\|<select" .claude docs README.md CLAUDE.md` → jede veraltete Stelle anpassen.
- [ ] **Step 2:** Alle neun Prüfungen aus `CLAUDE.md` parallel → alle grün; Screenshots der neuen Abschnitte ansehen.
- [ ] **Step 3:** `grep -rn "window\.prompt\|[^.]prompt(\|confirm(\|alert(" js/*.js` → leer (Kommentare ausgenommen).
- [ ] **Step 4:** Commit `docs: Helfer/Maschinen-Katalog und Bedarfsstatus nachgezogen`.
