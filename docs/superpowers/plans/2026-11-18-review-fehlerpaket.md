# Fehlerpaket aus dem Review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zehn Review-Befunde beheben (neun im Code, einer dokumentiert), jeder mit Test, der vorher rot war.

**Architecture:** Korrekturen im DOM-freien Kern (`store.js`, `persistence.js`) mit Unit-Tests; drei Korrekturen in `app.js` mit Playwright-Prüfungen in den vorhandenen `tools/verify-*.mjs`. Kein neues Modul.

**Tech Stack:** Vanilla JS (ES-Module), Node-Testläufer (`tests/run.mjs`, eigenes `test()`-Muster mit `node:assert/strict`), Playwright-core (Firefox) für `tools/verify-*.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-18-review-fehlerpaket-design.md`

## Global Constraints

- Arbeitsordner: der Worktree auf Branch `fix/review-fehler`. Nie im Dropbox-Repo arbeiten.
- `CLAUDE.md` gilt vollständig. Besonders: Store ist der einzige Weg, Validierung VOR der Änderung (abgelehnter Befehl hinterlässt nichts), Kernmodule ohne DOM, neue Felder müssen durch `addTask`, kein `prompt/confirm/alert`.
- Testmuster: bestehende Datei erweitern, `test('…', () => { … })` wie in `tests/store.test.mjs`; Befehle über `s.apply({type, …})`, Rückgabe ist bei Ablehnung ein Fehlertext (prüfen, wie bestehende Tests eine Ablehnung abfragen, und genauso machen).
- Rot-Nachweis: jeden neuen Test VOR der Korrektur laufen lassen und das Fehlschlagen im Bericht nennen.
- Prüfskripte nur mit Filter einlesen (`grep -E '✗|FAIL|fehlgeschlagen|Error'`), nur die betroffene Testdatei bzw. das betroffene verify-Skript laufen lassen; der Volllauf kommt in Task 6.
- Gestartete Server/Browser beenden; nach Abbruch `ps -ef | grep -E "http.server|firefox|playwright"` prüfen.
- Kommentare im Code auf Deutsch, im Stil der Datei (Begründung, nicht Beschreibung).
- Keine Version stempeln, nicht pushen, nicht mergen.
- Commit-Trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (bzw. das Modell, das committet).

## Review Focus

1. Sync-Update während Live-Betrieb mit gesetztem Versatz → Versatz bleibt, Anzeige springt nicht (Task 5, Prüfung in `verify-sync.mjs`).
2. Vorgang mit Teil-Zeitfenster per Tabelle auf einen anderen Tag gelegt → Fenster wandert mit, Bedarfsraster zeigt den neuen Tag (Task 2, Test über `bedarfsRaster`).
3. Import einer Datei mit einem einzigen kaputten Vorgang unter 300 guten → Ablehnung mit dem Titel des kaputten, kein halber Import (Task 4).
4. Altplan aus localStorage mit `punktTyp` einer inzwischen gelöschten eigenen Art → `setTaskField` auf ANDERE Felder dieses Vorgangs geht weiter (Whitelist prüft nur das geschriebene Feld) (Task 1).
5. Blockierter Speicher (`localStorage` wirft bei jedem Zugriff) → App startet, Ansicht umschaltbar (Task 5).

---

### Task 1: Feldprüfung für `setTaskField` und `addTask` (#5, #6)

**Files:**
- Modify: `js/store.js` (`setTaskField` ~242–295, `addTask` ~178–222, Konstanten oben bei `TYPEN_EINGEBAUT`)
- Test: `tests/store.test.mjs`

**Interfaces:**
- Produces: `const STATUS_IDS = ['geplant','laeuft','fertig']` (exportiert aus store.js); interne Funktion `feldFehler(state, t, field, value) → string|null` (eine Prüfung pro Feld, von beiden Befehlen benutzt); `const SCHREIBBAR` = Set der per `setTaskField` erlaubten Felder.

- [ ] **Step 1: Feldliste ermitteln.** `SCHREIBBAR` = alle Felder, die `migrate` (persistence.js ~121–160) an Vorgängen normalisiert, plus `title, gewerk, start, end`, MINUS `id, parent, res, crew`. Gegenprobe: `grep -rn "setTaskField" js/` — jedes dort benutzte `field` muss in der Liste stehen, sonst bricht die UI.

- [ ] **Step 2: Failing tests schreiben**

```js
test('setTaskField lehnt unbekannte Felder und id ab', () => {
  const s = createStore(seed());
  for (const field of ['id', 'quatsch', 'res']) {
    const r = s.apply({ type: 'setTaskField', id: 'a', field, value: 'x' });
    assert.ok(typeof r === 'string' /* bzw. Ablehnungsmuster der Datei */, field);
  }
  assert.equal(taskById(s, 'a').id, 'a');
  assert.equal(taskById(s, 'a').quatsch, undefined);
});
test('setTaskField prüft status und punktTyp', () => {
  // status 'kaputt' abgelehnt, 'fertig' angenommen; punktTyp 'gibtsnicht' abgelehnt,
  // 'changeover' angenommen; eigene Art aus project.punktTypen angenommen
});
test('setTaskField trimmt den Titel', () => { /* '  Neu  ' → 'Neu' */ });
test('setTaskField: Vorgang mit veraltetem punktTyp bleibt in anderen Feldern bearbeitbar', () => {
  // task.punktTyp = 'geloescht' direkt im seed; setTaskField notes → angenommen
});
test('addTask übernimmt slot, punktTyp, estimated, anforderungen, material, kontakt', () => {
  // addTask mit allen Feldern → Vorgang trägt sie; serialize/deserialize-Rundlauf
  // (import aus ../js/persistence.js) behält sie
});
test('addTask prüft slot und punktTyp wie setTaskField', () => { /* slot 99 / punktTyp 'x' abgelehnt, nichts angelegt, kein Undo-Eintrag */ });
test('STATUS_IDS deckt sich mit STATUS aus dom.js', () => {
  // import { STATUS } from '../js/dom.js' — dom.js ist im Node-Test importierbar? Wenn nicht
  // (DOM-Zugriff auf Modulebene), Text von js/dom.js lesen und die ids per RegExp ziehen.
});
```

- [ ] **Step 3: Rot-Nachweis.** Run: `node tests/store.test.mjs | grep -E '✗|bestanden'` — Expected: die neuen Tests ✗ (außer evtl. dem Gleichheitstest, falls STATUS_IDS noch fehlt → ebenfalls ✗).

- [ ] **Step 4: Umsetzen.** `feldFehler` sammelt die vorhandenen Einzelprüfungen aus `setTaskField` (title, gewerk, abschnitt, fuer, slot, bereitstellung) plus neu status/punktTyp. `setTaskField`: zuerst `SCHREIBBAR` prüfen (Meldung «Dieses Feld lässt sich nicht ändern: <name>»), dann `feldFehler`, title trimmen. `addTask`: für jedes übergebene Feld aus der neuen Liste `feldFehler` aufrufen, Defaults wie `migrate` (`punktTyp 'act'`, `slot null`, `estimated false`, `anforderungen/material/kontakt ''`, `ackCrit false`, `ackConflictMin null`). Bestehende Sonderregeln (parent, Sammelvorgang-Zeiten, Untervorgang-Gewerk, res via setTaskRes) bleiben.

- [ ] **Step 5: Grün.** Run: `node tests/store.test.mjs | grep -E '✗|bestanden'` — Expected: `0 fehlgeschlagen`. Dann `node tests/run.mjs 2>&1 | grep -E '[1-9][0-9]* fehlgeschlagen|✗'` — Expected: keine Ausgabe.

- [ ] **Step 6: Commit** `fix(store): feste Feldliste fuer setTaskField, addTask uebernimmt alle Felder`

### Task 2: Zeitfenster folgen dem Vorgang (#2)

**Files:**
- Modify: `js/store.js` (`moveTask` ~297, `setTaskField` start/end-Zweig)
- Test: `tests/store.test.mjs`, ein Test in `tests/resources.test.mjs`

**Interfaces:**
- Consumes: `toMin`, `toDate` aus schedule.js.
- Produces: interne `resNachziehen(t, altStart, altEnd)` — mutiert `t.res` (neue Liste, neue Objekte).

- [ ] **Step 1: Failing tests**

```js
test('moveTask verschiebt Zuweisungs-Fenster um dieselbe Differenz', () => {
  // Vorgang 08–12, res {von 09:00, bis 10:00}; moveTask auf 14–18 (gleiche Dauer)
  // → res {von 15:00, bis 16:00}, Zeitstempel im Format 'YYYY-MM-DDTHH:MM'
});
test('Dauer ändern beschneidet Fenster auf den Vorgang', () => {
  // Vorgang 08–12, res 10:00–12:00; setTaskField end 11:00 → res 10:00–11:00
});
test('Fenster ganz außerhalb wird zum ganzen Vorgang', () => {
  // Vorgang 08–12, res 11:00–12:00; setTaskField end 10:00 → res von null, bis null
});
test('Fenster null bleibt null beim Verschieben', () => {});
test('Verschieben über den Sommerzeit-Wechsel 25.10.2026 behält die Uhrzeit-Differenz in echten Minuten', () => {});
// tests/resources.test.mjs:
test('bedarfsRaster folgt einem verschobenen Vorgang', () => { /* über createStore + moveTask, dann bedarfsRaster */ });
```

- [ ] **Step 2: Rot-Nachweis.** `node tests/store.test.mjs | grep -E '✗|bestanden'`, `node tests/resources.test.mjs | grep -E '✗|bestanden'`.

- [ ] **Step 3: Umsetzen.** `moveTask`: gleiche Dauer (`toMin(end)-toMin(start)` alt = neu) → Fenster um `toMin(neuStart)-toMin(altStart)` Minuten verschieben; sonst beschneiden. `setTaskField` start/end → beschneiden. Beschneiden: `von = max(von, start)`, `bis = min(bis, end)`; `bis <= von` → beide `null`. Ausgabeformat wie die Eingabefelder (lokale Zeit `YYYY-MM-DDTHH:MM`; vorhandenen Formatierer in conflicts.js/schedule.js suchen und nutzen, sonst lokale Hilfsfunktion im Store).

- [ ] **Step 4: Grün** (beide Dateien + `tests/run.mjs` gefiltert).

- [ ] **Step 5: Commit** `fix(store): Zuweisungs-Zeitfenster folgen verschobenen Vorgaengen`

### Task 3: Löschen kaskadiert vollständig (#8)

**Files:** Modify `js/store.js` (`removeTask` ~224). Test `tests/store.test.mjs`.

- [ ] **Step 1: Failing test** `removeTask: Sammelvorgang nimmt Soundcheck seines Kind-Acts mit` — Sammel P, Kind A (`parent:P`), Soundcheck S (`fuer:A`) plus Dep auf S; `removeTask P` → P, A, S weg, Dep weg, ein ⌘Z bringt alle drei zurück.
- [ ] **Step 2: Rot-Nachweis.**
- [ ] **Step 3: Umsetzen.** `gone` in einer Schleife erweitern, bis keine Aufgabe mit `parent`/`fuer` in `gone` mehr dazukommt.
- [ ] **Step 4: Grün.**
- [ ] **Step 5: Commit** `fix(store): Loeschen kaskadiert ueber parent und fuer bis zum Ende`

### Task 4: Speichern und Import ehrlich (#3, #4)

**Files:** Modify `js/persistence.js` (`save` ~221–231, `deserialize` ~268). Test `tests/persistence.test.mjs`.

**Interfaces:** `deserialize` behält Signatur und Rückgabe `{ok:true, plan} | {ok:false, error}`.

- [ ] **Step 1: Failing tests**

```js
test('save meldet Fehler, wenn der Index nicht geschrieben werden kann', () => {
  // Fake-Storage: setItem wirft QuotaExceededError nur für den Index-Schlüssel
  // → r.ok === false, r.error enthält 'Speicher'
});
test('deserialize lehnt kaputte Zeit ab und nennt den Vorgang', () => {
  // 3 Vorgänge, einer mit start:'x', title:'Kaputt' → ok:false, error enthält 'Kaputt'
});
test('deserialize lehnt Ende vor Start ab (kein Meilenstein)', () => {});
test('deserialize akzeptiert Meilenstein mit start === end', () => {});
test('deserialize lehnt doppelte Task-ids ab', () => {});
test('deserialize entfernt Verknüpfungen auf unbekannte Vorgänge', () => { /* ok:true, deps ohne Waise */ });
test('mitgelieferte Pläne bestehen die Prüfung', () => {
  // klassentreffen-festival.json und der AMK-Plan (Pfad per ls ermitteln) → ok:true
});
```

- [ ] **Step 2: Rot-Nachweis.**
- [ ] **Step 3: Umsetzen.** Index-`catch` liefert `{ok:false, error}` mit derselben Speicher-voll-Meldung (bei anderem Fehler: «Speichern fehlgeschlagen: …»). Prüfung in `deserialize` NACH `migrate`; Zeiten über `toMin` (Number.isFinite), Ende ≥ Start bei Meilenstein, Ende > Start sonst — gleiche Regel wie `checkSpan` im Store (dort nachsehen, nicht abweichen). Meldung: `Vorgang «<Titel>»: <Grund>.`
- [ ] **Step 4: Grün** + `node tests/amk.test.mjs`, `node tests/klassentreffen.test.mjs` gefiltert.
- [ ] **Step 5: Commit** `fix(persistence): Index-Fehler melden, Import auf Zeiten und ids pruefen`

### Task 5: app.js — Versatz, Projektwechsel, gesperrter Speicher (#1, #9, #10)

**Files:** Modify `js/app.js` (`open()` ~186–206, `startAnsicht` ~73–90, Zeilen mit ungeschütztem `localStorage` ~261, 770, 883, 898, 905). Tests: `tools/verify-sync.mjs`, `tools/verify-edit.mjs` (je ein neuer `check(…)`).

- [ ] **Step 1: Failing checks**
  - `verify-sync.mjs`, neuer check «Sync-Update behält den Versatz»: Gerät A verbunden, Versatz +5 setzen (`#vz-plus` ×5 oder `#vz-n`), Gerät B ändert und lädt hoch, A gleicht ab → A zeigt den neuen Inhalt UND Versatz 5 (`#vz-n` Wert bzw. `gantt.versatz`).
  - `verify-sync.mjs` oder `verify-edit.mjs`, check «Projektwechsel verliert keine Eingabe»: Titel ändern, sofort (ohne 800 ms Wartezeit) anderes Projekt öffnen, zurück → Titel ist da.
  - `verify-edit.mjs`, check «Gesperrter Speicher»: `addInitScript` ersetzt `localStorage.getItem/setItem/removeItem` durch Werfer, AUSSER für den Start (`?plan=leer`-Pfad muss laufen) — Erwartung: keine `pageerror`, Ansicht-Umschalter wechselt die Ansicht. Wenn die App ohne Speicher gar nicht starten kann (Repo braucht ihn), stattdessen nur `setItem` werfen lassen und das im Bericht begründen.
- [ ] **Step 2: Rot-Nachweis** (nur diese beiden Skripte laufen lassen, gefiltert).
- [ ] **Step 3: Umsetzen.** `open()`: `const wechsel = store && store.state.project.id !== plan.project.id`. Bei `wechsel` UND `saveTimer`: Timer löschen, `repo.save(store.state)` synchron vor `store.replace`. `setVersatz(0)` nur bei `wechsel`. Undo-Leerung über `store.replace` bleibt unverändert. Alle ungeschützten `localStorage`-Zugriffe in try/catch (Lesen: Vorgabe zurückgeben; Schreiben: Kommentar «Privatmodus: nur diese Sitzung» wie Zeile ~1560).
- [ ] **Step 4: Grün:** beide Skripte gefiltert, plus `node tools/verify-live.mjs` gefiltert (Versatz-Logik).
- [ ] **Step 5: Commit** `fix(app): Sync behaelt Versatz, Projektwechsel sichert, Speicherzugriffe abgesichert`

### Task 6: Doku und Schlussprüfung (#7)

**Files:** Modify `docs/entscheidungen.md` (neuer Abschnitt «Bekannte Grenze: Zeitzone des Betrachters»), `CHANGELOG.md` (Abschnitt «Unveröffentlicht» bzw. vorhandene Konvention prüfen).

- [ ] **Step 1:** Abschnitt schreiben: `toMin` rechnet in der Zone des Browsers; Dauer einer Nacht über den Zeitwechsel weicht zwischen Betrachtern in verschiedenen Zonen um 1 h ab; Projekt-Zone wird nur für die Jetzt-Linie benutzt; Korrektur hieße alle Zeitrechnung auf die Projekt-Zone umzustellen — bewusst zurückgestellt (2026-11-18).
- [ ] **Step 2:** Volllauf aller neun Prüfungen (parallel möglich), gefiltert. Expected: alle grün.
- [ ] **Step 3:** Screenshots der verify-Läufe (Ordner `tools/shots`) für Gantt, Show, Tabelle stichprobenartig ansehen.
- [ ] **Step 4: Commit** `docs: Zeitzonen-Grenze dokumentiert, Changelog`
