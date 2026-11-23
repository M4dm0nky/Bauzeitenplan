# Einrichten als eigene Seite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Einrichten-Fenster (`#ein-dlg`, sechs Reiter mit Knöpfen) wird eine eigene Seite derselben App mit fünf direkt bearbeitbaren Bereichen, Status je Bereich, geführtem ersten Einrichten und änderbarem Projektzeitraum; Projektverwaltung zieht in ein Menü der Kopfzeile.

**Architecture:** Ein Modus der App, kein zweites HTML: `#ein-seite` liegt in `.col` neben Kopf/Arbeitsfläche/Fuß; beim Öffnen werden diese verborgen (nicht abgebaut), der Gantt-Ausschnitt bleibt. DOM-freie Status- und Hüllenrechnung in `js/einrichten-status.js`, Seite in `js/einrichten.js`, eingebettete Auswahllisten aus `table.js` herausgelöst nach `js/listen-editor.js`. Alle Änderungen über vorhandene Store-Befehle; `setProjectField` bekommt eine Feldliste mit Prüfung.

**Tech Stack:** Vanilla JS, ES-Module, kein Build-Step; Tests `node tests/run.mjs`; Browserprüfungen Playwright (`tools/verify-*.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-23-einrichten-seite-design.md`

## Global Constraints

- Kein `window.prompt`/`confirm`/`alert`; Rückfragen nur über `askDialog({title, message, buttons})` (app.js, in Module injiziert). Der grep aus CLAUDE.md bleibt leer.
- Store ist der einzige Schreibweg; ein `change` = ein Befehl = ein ⌘Z; nur `change`, nie zusätzlich `blur`; Handler lesen frisch aus `store.state`.
- Rechenlogik DOM-frei mit Test; neue Module in `HUELLE` (`sw.js`); neue CSS-Klassen der Seite in die `needed`-Liste (`tests/run.mjs`) und in alle fünf Themes (`styles/themes/*.css`), Tokens auf allen drei Scopes.
- Symbole statt Kürzel: 📋 Projekt · 📅 Zeitraum & Phasen · 🏗 Gewerke & Bühnen · 👷 Personal & Maschinen · 🏷 Arten & Abschnitte; Status ✓ (grün) · ⚠ (gelb) · ○ (gedämpft).
- Die App ändert den Zeitraum nie still; Zeitraum ändern verschiebt keine Vorgänge/Phasen.
- Lange Listen nie als `<select>` (Zeitzone: `<input list>` + `<datalist>`).
- Bereichsschlüssel bleiben die alten Reiternamen: `projekt` (1), `phasen` (2), `baender` (3), `res` (4), `arten` (5). `sync` gibt es auf der Seite nicht mehr → Speicherort-Dialog.
- Ids bleiben: `#rail-ein`, `#ein-zu` (jetzt «Zum Plan»/«Fertig»), `#new-proj`, `#proj-menu`, `#import`, `#export`, `#plan-verschieben`, `#add-gewerk`, `#sync-token`, `#sync-verbinden`, `#sync-trennen`, `#sync-info`, `#ei-ph-liste`, `#ei-ph-add`.
- Keine Handy-Anpassung (keine Anforderung).
- Subagenten: beenden alles, was sie starten (Server, Browser); Modell je Auftrag ausdrücklich (Sonnet für Umsetzung).
- Version wird in diesem Plan NICHT gestempelt (fragt Marco nach Abschluss).

## Review Focus

1. **Zurück zum Plan:** Zoom, Scroll (`#bz` `scrollLeft/scrollTop`) und gewählter Tag sind nach «Zum Plan» exakt wie vorher → Prüfung in Task 4.
2. **Tippen, während der Store sich ändert** (Sync-Abgleich, ⌘Z): die Seite baut nicht unter dem fokussierten Feld neu, holt beim `focusout` nach → Prüfung in Task 4.
3. **Ungültige Eingaben** (Ende vor Start, leerer Name, unbekannte Zeitzone): abgelehnt, Feld zeigt wieder den Store-Wert, Toast, kein Undo-Eintrag → Tests in Task 1 und Task 5.
4. **Altpläne und Rundlauf:** Plan ohne neue Felder öffnet mit Seitenleiste; `kontakte` überstehen Export → Import und Sync-Vergleich → Tests in Task 1.
5. **Projektwechsel / Neu bei offener Seite:** Seite schließt, kein Zustand des alten Projekts bleibt stehen; Live-Monitor-Start zeigt nie die Seite → Prüfung in Task 7.

---

### Task 1: Neue Projektfelder in Store und Persistence

**Files:**
- Modify: `js/persistence.js` (`migrate`, ab Z. 59)
- Modify: `js/store.js` (`setProjectField`, Z. 802)
- Test: `tests/persistence.test.mjs`, `tests/store.test.mjs`

**Interfaces:**
- Produces: `project.adresse: string`, `project.anfahrt: string`, `project.kunde: string`, `project.kontakte: Array<{id: string, name: string, rolle: string, tel: string}>`, `project.eingerichtet: boolean`.
- Produces: `setProjectField({field, value})` nimmt nur `name, venue, timezone, start, end, adresse, anfahrt, kunde, kontakte, eingerichtet`; sonst Fehler `'Dieses Feld lässt sich nicht ändern: ' + field`.

- [ ] **Step 1: Failing tests schreiben**

`persistence.test.mjs`:
- `migrate ergänzt fehlende Projektangaben`: Plan ohne die Felder → `adresse === ''`, `anfahrt === ''`, `kunde === ''`, `kontakte` deepEqual `[]`, `eingerichtet === true`.
- `migrate lässt vorhandene Projektangaben stehen`: `eingerichtet: false`, `kontakte: [{id:'k1',name:'Ann',rolle:'PL',tel:'0171'}]` bleiben unverändert; `kontakte: 'kaputt'` wird `[]`.
- `kontakte überstehen Export und Import`: `deserialize(serialize(plan))` → `project.kontakte` deepEqual Original.

`store.test.mjs`:
- `setProjectField lehnt unbekannte Felder ab`: `field: 'id'` → `ok === false`, `canUndo === false`.
- `setProjectField prüft kontakte`: kein Array → Fehler; Eintrag ohne `id` → Fehler; Felder werden zu getrimmten Strings; gültige Liste → ok, genau ein Undo-Schritt.
- `setProjectField prüft die Zeitzone`: `'Europe/Berlin'` ok, `'Mars/Olymp'` → Fehler `'Unbekannte Zeitzone: Mars/Olymp'`.
- `setProjectField eingerichtet nur boolesch`: `'ja'` → Fehler.
- `Zeitraum ändern verschiebt nichts`: `start/end` neu setzen → alle `tasks[].start/end` und `phases[]` unverändert.

- [ ] **Step 2:** `node tests/run.mjs 2>&1 | grep -E "✗|FAIL|nicht ok" | head` → die neuen Tests schlagen fehl.
- [ ] **Step 3:** `migrate` ergänzen (`??=` für die Strings und `eingerichtet ??= true`, `kontakte` nur behalten, wenn Array). `setProjectField`: Feldliste, Zeitzone per `new Intl.DateTimeFormat('de', {timeZone})` in try/catch, `kontakte` normalisieren (Array, jedes Element Objekt mit nichtleerer `id`; `name/rolle/tel` → `String(x ?? '').trim()`), `eingerichtet` `typeof === 'boolean'`. Vorhandene Start/Ende-Prüfung bleibt.
- [ ] **Step 4:** `node tests/run.mjs 2>&1 | tail -3` → alles grün.
- [ ] **Step 5: Commit** `feat: Projektangaben (Adresse, Anfahrt, Kunde, Kontakte, eingerichtet) im Store`

---

### Task 2: DOM-freie Statusrechnung

**Files:**
- Create: `js/einrichten-status.js`
- Create: `tests/einrichten-status.test.mjs` (eingehängt wie die übrigen `*.test.mjs` in `tests/run.mjs`)
- Modify: `sw.js` (`HUELLE`)

**Interfaces:**
- Consumes: `planSpanne(state) → {von, bis}` (Minuten) und `toDate` aus `js/timeaxis.js`; `toMin`.
- Produces:
  - `ausserhalb(state) → {phasen: number, vorgaenge: number}` — Phasen bzw. Vorgänge mit eigenem `start`/`end`, die vor `project.start` beginnen oder nach `project.end` enden. Terminlose zählen nicht, Sammelvorgänge zählen wie andere.
  - `zeitraumHuelle(state) → {start: string, end: string}` — `planSpanne` als lokale ISO-Strings `YYYY-MM-DDTHH:MM` (gleiche Form wie `project.start`).
  - `einrichtStatus(state) → {projekt, phasen, baender, res, arten}`, Werte `'ok' | 'warn' | 'leer'`:
    - `projekt`: `ok` wenn Name nicht leer, sonst `leer`.
    - `phasen`: `warn` wenn `ausserhalb` > 0; sonst `ok` wenn ≥ 1 Phase; sonst `leer`.
    - `baender`: `ok` ab einem Gewerk der Art `gewerk` (Bühnen allein zählen nicht), sonst `leer`.
    - `res`: `ok` ab einem Eintrag in `project.ressourcen`, sonst `leer`.
    - `arten`: `ok` ab einem Eintrag in `project.punktTypen` oder `project.abschnitte`, sonst `leer`.

- [ ] **Step 1: Failing tests** mit echten Datenformen (Fixture aus `tools/fixtures/` über `tools/plan-fixture.mjs` laden bzw. Festwiese-Situation nachbauen):
  - `Festwiese: Ende 12.08., Phase bis 30.08. → phasen warn, ausserhalb.phasen === 1`
  - `Hülle reicht bis zum Ende der letzten Phase` → `zeitraumHuelle(state).end === '2027-08-30T…'` (Wert aus der Fixture)
  - `terminloser Vorgang zählt nicht als außerhalb`
  - `Vorgang genau auf project.end zählt nicht als außerhalb` (Grenze)
  - `leerer Plan: projekt ok, phasen leer, baender leer, res leer, arten leer`
  - `nur Bühnen → baender leer`
- [ ] **Step 2:** Tests laufen lassen → rot.
- [ ] **Step 3:** Modul schreiben; in `HUELLE` eintragen.
- [ ] **Step 4:** `node tests/run.mjs 2>&1 | tail -3` → grün (inkl. HUELLE-Prüfung).
- [ ] **Step 5: Commit** `feat: einrichtStatus und Zeitraum-Hülle (DOM-frei)`

---

### Task 3: Auswahllisten aus table.js herauslösen

**Files:**
- Create: `js/listen-editor.js`
- Modify: `js/table.js` (`verwalten`, Z. 777–865)
- Modify: `sw.js` (`HUELLE`)

**Interfaces:**
- Produces: `mountAuswahlListe(container: HTMLElement, {store, send, liste: 'punktTypen'|'abschnitte'|'ressourcen', kind?: 'personal'|'maschine', leerText: string}) → {refresh(): void}`
  - Zeichnet die Zeilen (Name-Feld mit `change` → `setAuswahlLabel`, ↑ ↓ → `reorderAuswahl`, × → `removeAuswahl`, × gesperrt mit Titel bei `benutztVon > 0`) — exakt das heutige Verhalten aus `verwalten`, gleiche Klassen `tb-verw-z/-n/-b/-x/-kind/-leer`.
  - Mit `kind`: nur Einträge dieser Art. ↑/↓ tauscht mit dem nächsten Eintrag DERSELBEN Art; `reorderAuswahl` bekommt die volle id-Liste (alle Arten) mit genau diesen zwei ids getauscht.
- `table.verwalten` baut den schwebenden Kasten wie bisher (Kopf, «Fertig», `platziere`) und füllt ihn über `mountAuswahlListe`. `openVerwalten` bleibt exportiert.

- [ ] **Step 1:** In `tools/verify-edit.mjs` eine Prüfung «Personal-Liste getrennt sortieren»: zwei Personal-, eine Maschinenbezeichnung im Plan seeden (Reihenfolge P1, M1, P2), `mountAuswahlListe` per `page.evaluate`-Import mit `kind:'personal'` in ein Test-div hängen, bei P2 ↑ klicken → `project.ressourcen` nach `sort` = P2, M1, P1. Erwartet rot (Modul fehlt).
- [ ] **Step 2:** Modul schreiben, `verwalten` darauf umstellen, `HUELLE`.
- [ ] **Step 3:** `node tests/run.mjs | tail -3` und `node tools/verify-edit.mjs 2>&1 | grep -E "✗|FEHL|ok von" ` → grün; die vorhandenen Verwalten-Prüfungen (Arten, Abschnitte aus der Tabelle) unverändert grün.
- [ ] **Step 4: Commit** `refactor: Auswahllisten als einbettbarer Baustein (listen-editor.js)`

---

### Task 4: Seitengerüst, Navigation, Bereich 1 «Projekt»

**Files:**
- Create: `js/einrichten.js`
- Modify: `index.html` (Z. 214–293: `#ein-dlg` → `<section class="ein-seite" id="ein-seite" hidden>` in `.col`, nach `.work`/vor `.ft`; Kommentar umformulieren: eigene Seite als Modus, Ausschnitt bleibt, weil der Gantt nur verborgen wird)
- Modify: `js/app.js` (Z. 425–460 `setEinTab/openEinrichten/closeEinrichten`, `bedarf.onEinrichten`, `rail.einrichten`)
- Modify: `js/rail.js` (gedrückt-Zustand für `#rail-ein`)
- Modify: `styles/base.css`, alle fünf `styles/themes/*.css`, `tests/run.mjs` (`needed`), `sw.js`
- Modify: `tools/verify-edit.mjs`, `tools/verify-sync.mjs` (alle `#ein-dlg`-Abfragen → `#ein-seite`)

**Interfaces:**
- Consumes: `einrichtStatus` (Task 2), `mountAuswahlListe` (Task 3).
- Produces: `createEinrichten(root, {store, send, askDialog, toast, phasen, onZu}) → {open(bereich = 'projekt', {erst = false} = {}), close(), refresh(), get offen(): boolean}`
  - `send(cmd)` = app.js `apply` (Toast bei Fehler übernimmt app.js wie bisher).
  - `onZu()` meldet app.js das Schließen (app.js zeigt Plan, stellt Scroll wieder her, setzt `#rail-ein` zurück).
- app.js: `openEinrichten(bereich)` merkt `#bz` `scrollLeft/scrollTop`, setzt `.col` die Klasse `ist-ein` (CSS blendet `.hd, .showhead, .work, .ft` aus), ruft `einrichten.open`. Schließen kehrt beides um. `'sync'` als Bereich öffnet den Speicherort-Dialog (Task 6) statt der Seite.
- Markup der Seite: Kopf `h2` «⚙ Einrichten — <Name>» + `#ein-zu`; `nav.ein-nav` mit fünf `button[data-ein="…"]` (Symbol, Text, `span.ein-st` mit Klasse `ein-st-ok|-warn|-leer` und Zeichen ✓/⚠/○, `aria-pressed`); `div.ein-inhalt` mit fünf `section[data-ein-tab="…"]`.
- Neuaufbau nur über `refresh()` (Store-`subscribe`); steht der Fokus in einem Feld der Seite, wartet er bis `focusout` der Seite (wie die Tabelle).

Bereich 1 «📋 Projekt»: Felder Name, Ort (`venue`), Adresse (eine Zeile), Kunde / Veranstalter (eine Zeile), Anfahrt / Zufahrt / Ladezone (`textarea`), Zeitzone (`input list` + `datalist` aus `Intl.supportedValuesOf('timeZone')`) mit Hinweis «Zeiten im Plan bleiben, nur die Jetzt-Linie richtet sich danach». Jedes Feld: `change` → `setProjectField`; abgelehnt → Feld zurück auf Store-Wert. Ansprechpartner: Tabelle Name · Rolle · Telefon (`input type=tel`), «+ Ansprechpartner» hängt `{id: newId('k'), name:'', rolle:'', tel:''}` an, × löscht ohne Rückfrage (⌘Z holt zurück); jede Änderung schickt die ganze Liste als ein `setProjectField('kontakte')`. Bereiche 2–5 bekommen hier nur ihre leere `section` und einen Platzhalter-Hinweis; Inhalte in Task 5/6.

- [ ] **Step 1: Failing Browserprüfungen** in `tools/verify-edit.mjs`:
  - `Einrichten ist eine Seite`: `#rail-ein` klicken → `#ein-seite` sichtbar, `#bz` unsichtbar, `#rail-ein` `aria-pressed=true`; fünf `.ein-nav button[data-ein]`; Status-Zeichen in Bereich `projekt` = ✓.
  - `Zum Plan behält den Ausschnitt`: vorher Zoomstufe wechseln und `#bz` auf `scrollLeft=1234`/`scrollTop=300` scrollen, Tag merken (`#tag-wahl` Text) → Einrichten auf, Bereich wechseln, `#ein-zu` → Zoomstufe, `scrollLeft`, `scrollTop`, Tag gleich.
  - `Adresse ändern = ein Undo`: Adresse tippen, `change` per Enter/Tab in das nächste Feld der Seite (nicht `blur()`), ⌘Z → Feld leer, `store`-Wert leer.
  - `Kontakt anlegen, ändern, löschen`: + → Name «Ann», Rolle «PL», Tel «0171» → `project.kontakte` hat einen Eintrag mit diesen Werten; × → leer.
  - `leerer Name abgelehnt`: Name leeren → Feld zeigt wieder alten Namen, Toast sichtbar, `canUndo` unverändert.
  - `kein Neuaufbau unter dem Cursor`: Cursor in «Kunde», per `page.evaluate` einen `setProjectField('adresse')` auslösen → «Kunde»-Feld ist dasselbe Element und behält Fokus und Tippstand.
- [ ] **Step 2:** `node tools/verify-edit.mjs 2>&1 | grep -E "✗|FEHL" ` → die neuen Prüfungen rot.
- [ ] **Step 3:** Umsetzen (Markup, Modul, app.js, rail.js, CSS in base.css + Farben/Tokens in allen fünf Themes; `needed` += `'ein-seite', 'ein-nav', 'ein-st-ok', 'ein-st-warn', 'ein-st-leer'`). Alte `#ein-dlg`-Abfragen in den Prüfskripten auf `#ein-seite` umstellen; die Escape-Prüfung (`verify-edit.mjs:351`) bleibt sinngemäß: Escape schließt den Dialog über der Seite, nicht die Seite.
- [ ] **Step 4:** `node tests/run.mjs | tail -3`, `node tools/verify-edit.mjs`, `node tools/verify-browser.mjs` (gefiltert) → grün; Screenshot der Seite in zwei Themes ansehen.
- [ ] **Step 5: Commit** `feat: Einrichten als eigene Seite mit Status und Bereich Projekt`

---

### Task 5: Bereich 2 «Zeitraum & Phasen»

**Files:**
- Modify: `js/einrichten.js`, `index.html` (Phasenliste `#ei-ph-liste`, `#ei-ph-add`, `#plan-verschieben` in diesen Bereich), `js/app.js` (`phasen.mountListe` bleibt auf denselben ids), `styles/base.css`, Themes, `tests/run.mjs` (`needed` += `'ein-zl', 'ein-warn'`)
- Modify: `tools/verify-edit.mjs`, `tools/verify-sync.mjs` (`#plan-verschieben` jetzt unter `[data-ein="phasen"]`)

**Interfaces:**
- Consumes: `ausserhalb`, `zeitraumHuelle` (Task 2); `createPhasenEditor` (vorhanden, `refresh()` beim Öffnen des Bereichs).
- Produces: nichts Neues nach außen.

Inhalt: Projektbeginn/-ende als `input type=datetime-local` (`change` → `setProjectField('start'|'end')`, abgelehnt → zurück + Toast). Ist `ausserhalb` > 0: gelbe Leiste `.ein-warn` «⚠ N Phasen und M Vorgänge liegen außerhalb des Zeitraums» (Teile mit 0 weglassen) + Knopf «Zeitraum auf <TT.MM. HH:MM> – <TT.MM. HH:MM> setzen» → `send({type:'batch', cmds:[start, end]})` (ein ⌘Z). Mini-Zeitleiste `.ein-zl`: Breite = `planSpanne`, Phasen als Balken `bz-ph-<art>`-Farben (`--ph-<art>`), Projektzeitraum gestrichelter Rahmen. Darunter Phasenliste und «+ Phase», «Plan verschieben…» (`showShiftDialog` unverändert). Vorhandener Phasen-Hinweistext aus dem alten Reiter bleibt.

- [ ] **Step 1: Failing Prüfungen** (`verify-edit.mjs`, Festwiese-Situation per Fixture: Ende vor letzter Phase):
  - `Zeitraum-Warnung`: Bereich `phasen` → `.ein-warn` sichtbar, Text nennt «1 Phase»; Status-Zeichen ⚠.
  - `Hülle setzen = ein Undo`: Knopf klicken → `project.end` = Ende der letzten Phase, Warnung weg, Status ✓; ein ⌘Z → altes Ende UND alter Start, Warnung wieder da.
  - `Ende vor Start abgelehnt`: Ende auf einen Tag vor Start → Feld zeigt alten Wert, `canUndo` unverändert.
  - `Zeitraum ändern lässt Vorgänge stehen`: Ende +3 Tage → `tasks` deepEqual vorher.
  - Vorhandene Phasen- und Plan-verschieben-Prüfungen auf den neuen Ort umstellen.
- [ ] **Step 2:** rot nachweisen.
- [ ] **Step 3:** umsetzen.
- [ ] **Step 4:** `verify-edit.mjs`, `verify-sync.mjs`, `tests/run.mjs` → grün; Screenshot Bereich 2 ansehen.
- [ ] **Step 5: Commit** `feat: Zeitraum jederzeit änderbar, Warnung bei Teilen außerhalb`

---

### Task 6: Bereiche 3–5 und Projektmenü in der Kopfzeile

**Files:**
- Modify: `js/einrichten.js`, `js/app.js` (Gewerk-Löschen aus dem Rechtsklick-Menü Z. 1221–1230 als `loescheGewerk(id)` herausziehen und beiden geben; `addGewerk` um `art` erweitern; Projektverwaltung als Funktionen `neuesProjekt()`, `projekteWaehlen()`, `importieren()`, `exportieren()`, `oeffneSpeicherort()`), `js/menu.js` (Item-Feld `id` → `b.id`), `index.html` (Projektknopf `#proj-knopf` «📁 Projekt» in `.hd-right` vor `#drucken`; neuer Dialog `<div class="dlg" id="sync-dlg" hidden>` mit dem bisherigen Speicherort-Inhalt), CSS/Themes, `tests/run.mjs` (`needed` += `'ein-gw-farbe'`)
- Modify: `tools/verify-browser.mjs` (`SOLL = { bau: 16, show: 14 }`), `tools/verify-edit.mjs`, `tools/verify-sync.mjs`
- Create: `tools/ui-helfer.mjs` (gemeinsame Klickwege der Prüfskripte)

**Interfaces:**
- Consumes: `mountAuswahlListe` (Task 3), `gewerkVar(slot)`, `gewerkTexture(slot)` aus `js/palette.js`.
- Produces:
  - `openMenu` Items: optional `id: string`.
  - Projektmenü-Einträge mit ids: `#new-proj` «＋ Neu…», `#proj-menu` «📂 Projekte…», `#import` «⬆ Import…», `#export` «⬇ Export», `#sync-oeffnen` «☁ Speicherort…».
  - `tools/ui-helfer.mjs`: `einrichten(page, bereich)` (klickt `#rail-ein`, dann `[data-ein=bereich]`), `zumPlan(page)` (`#ein-zu`), `projektMenue(page, id)` (klickt `#proj-knopf`, dann `#<id>`).

Bereich 3 «🏗 Gewerke & Bühnen»: Liste Gewerke (Art `gewerk`, nach `sort`): Farbfeld `.ein-gw-farbe` (Hintergrund `gewerkVar(slot)`, Schraffur wenn `gewerkTexture(slot)`), Name-Feld (`change` → `setGewerkField name`), ↑ ↓ (`reorderGewerk dir ±1`, an den Enden gesperrt), × → `loescheGewerk(id)` (gleiche `askDialog`-Rückfrage wie heute). «+ Gewerk» = `#add-gewerk`. Bühnenliste gleich gebaut, nur sichtbar, wenn eine Bühne existiert; Knopf «+ Bühne» immer. Hinweis: Rechtsklick im Plan geht weiter.
Bereich 4 «👷 Personal & Maschinen»: zwei `mountAuswahlListe` (`ressourcen`, `kind` personal/maschine), darüber je «+ Personal»/«+ Maschine» (bisherige Handler von `#ei-res-personal`/`#ei-res-maschine`), Hinweis «Zugewiesen wird am Vorgang — im Panel oder in der Tabelle, Spalte «Ressourcen».»
Bereich 5 «🏷 Arten & Abschnitte»: zwei `mountAuswahlListe` (`punktTypen`, `abschnitte`), je «+ Art»/«+ Abschnitt» über `table.openNeuFragen` (wie die Tabelle).
Die alten Knöpfe `#ei-res-verwalten`, `#ei-typen-verwalten`, `#ei-abschnitte-verwalten` entfallen.

- [ ] **Step 1: Failing Prüfungen:**
  - `Gewerk umbenennen auf der Seite`: Name ändern → Gantt-Zeile zeigt neuen Namen nach «Zum Plan».
  - `Gewerk löschen fragt`: × → `askDialog` sichtbar, «Abbrechen» → Gewerk bleibt; erneut × → «Löschen» → weg; ⌘Z → wieder da.
  - `Bühnenliste nur mit Bühnen`: Festival-Fixture ohne Bühnen → keine Bühnenliste, «+ Bühne» da.
  - `Projektmenü`: `#proj-knopf` → Menü mit genau `#new-proj, #proj-menu, #import, #export, #sync-oeffnen`; `#sync-oeffnen` öffnet `#sync-dlg` mit `#sync-token`.
  - Knopfzahl `verify-browser.mjs` SOLL 16/14 (vorher mit 15/13 laufen lassen → rot, sobald der Knopf da ist).
- [ ] **Step 2:** rot nachweisen.
- [ ] **Step 3:** umsetzen; alle Klickwege in `verify-edit.mjs`/`verify-sync.mjs` (`#rail-ein` + `[data-ein="projekt"]` + `#proj-menu`, `[data-ein="sync"]`, `#new-proj`, `#export`) auf `tools/ui-helfer.mjs` umstellen. Danach muss `grep -nE "locator\('#(proj-menu|new-proj|export|import)'\)|data-ein=\"sync\"" tools/verify-*.mjs` leer sein: diese Klicks laufen nur noch über `projektMenue()`.
- [ ] **Step 4:** `verify-edit`, `verify-sync`, `verify-browser`, `tests/run.mjs` → grün; Screenshots der Bereiche 3–5 ansehen.
- [ ] **Step 5: Commit** `feat: Gewerke, Personal, Arten direkt auf der Einrichten-Seite; Projektmenü in der Kopfzeile`

---

### Task 7: Erstes Einrichten (geführt)

**Files:**
- Modify: `js/einrichten.js`, `js/app.js` (Neu-Dialog Z. ~1580: vor `open(...)` `plan.project.eingerichtet = false`; nach erfolgreichem `open` bei `eingerichtet === false` → `openEinrichten('projekt', {erst: true})`; `open()` schließt bei Projektwechsel die Seite), CSS/Themes (`needed` += `'ein-erst', 'ein-schritt'`)

**Interfaces:**
- Consumes: `createEinrichten().open(bereich, {erst})` (Task 4).
- Produces: `.ein-seite.ein-erst`: dieselbe `.ein-nav` als waagrechte Schrittleiste mit Nummern 1–5; unten `.ein-schritt` mit «← Zurück» (`#ein-zurueck`, in Schritt 1 gesperrt) und «Weiter →» (`#ein-weiter`, in Schritt 1 gesperrt, solange der Name leer ist); in Schritt 5 heißt `#ein-zu` «Fertig» und `#ein-weiter` ist ausgeblendet.
- Verlassen (`#ein-zu`, «Fertig» oder Schiene) bei `eingerichtet === false` → `send(setProjectField eingerichtet true)` (ein ⌘Z-Schritt; bewusst über den Store, weil er der einzige Schreibweg ist), dann Plan.

- [ ] **Step 1: Failing Prüfungen** (`verify-edit.mjs`):
  - `Neu führt durch die Schritte`: `projektMenue(page,'new-proj')` → Name, Ort, Von, Bis, Vorlage festival → `#ein-seite.ein-erst` sichtbar, Schritt 1 gedrückt; «Weiter» 4× → Schritt 5, `#ein-zu` Text «Fertig»; klicken → Plan sichtbar, `project.eingerichtet === true`; erneut `#rail-ein` → Seite ohne `.ein-erst`.
  - `Abbruch im Schritt 2 zählt als eingerichtet`: `#ein-zu` in Schritt 2 → Plan; nächstes Öffnen ohne `.ein-erst`.
  - `Bestandsplan öffnet mit Seitenleiste`: Klassentreffen-Fixture → `#rail-ein` → keine `.ein-erst`.
  - `Projektwechsel schließt die Seite`: Seite offen → `projektMenue(page,'proj-menu')` → anderes Projekt → `#ein-seite` verborgen, `#bz` sichtbar.
  - `Live-Monitor zeigt nie die Seite`: Start mit `bzp_live=1` + aktivem Projekt mit `eingerichtet:false` → `#ein-seite` verborgen.
- [ ] **Step 2:** rot nachweisen.
- [ ] **Step 3:** umsetzen.
- [ ] **Step 4:** `verify-edit`, `verify-live`, `tests/run.mjs` → grün; Screenshot Schritt 1 und Schritt 5 ansehen.
- [ ] **Step 5: Commit** `feat: geführtes erstes Einrichten nach «Neu»`

---

### Task 8: Projektangaben im Druckkopf

**Files:**
- Modify: `js/print.js` (`blatt` Z. 404–409, `roBlatt` Z. 300–306), `styles/print.css`
- Test: `tests/print.test.mjs`, `tools/verify-print.mjs`

**Interfaces:**
- Produces: `export function kopfAngaben(project) → string[]` in `js/print.js`: `[venue, adresse, ...kontakte]` ohne leere Teile; Kontakt als `'Name · Rolle · Tel'` ohne leere Teile; Kontakt ganz leer → entfällt. Kunde und Anfahrt nie.

- [ ] **Step 1: Failing tests** (`print.test.mjs`): 
  - `kopfAngaben ohne Angaben ist leer` → `[]`.
  - `kopfAngaben Reihenfolge` mit venue «Festwiese», adresse «Hauptstr. 1», kontakte [{name:'Ann',rolle:'PL',tel:'0171'},{name:'',rolle:'',tel:''},{name:'Bo',rolle:'',tel:'0160'}], kunde «X» → `['Festwiese','Hauptstr. 1','Ann · PL · 0171','Bo · 0160']`.
  - `verify-print.mjs`: Plan mit Adresse und einem Kontakt → beide Blattarten zeigen `.pr-head-a` mit «Hauptstr. 1» und «Ann · PL · 0171»; Kopf bleibt einzeilig hoch genug (vorhandene Zuschnittprüfungen grün).
- [ ] **Step 2:** rot nachweisen.
- [ ] **Step 3:** umsetzen (`span.pr-head-a` mit den Teilen, getrennt durch « · », zwischen Titel und Datum).
- [ ] **Step 4:** `tests/run.mjs`, `verify-print.mjs` → grün; ein A3-Screenshot ansehen.
- [ ] **Step 5: Commit** `feat: Ort, Adresse und Ansprechpartner im Druckkopf`

---

### Task 9: Doku und Gesamtabnahme

**Files:**
- Modify: `CLAUDE.md` (Aufbau-Tabelle: `einrichten.js`, `einrichten-status.js` DOM-frei, `listen-editor.js`; «Was der erste Start braucht» – `openEinrichten` jetzt Seite; Knopfzahl nicht hier), `.claude/rules/tabelle-einrichten.md` (Fenster → Seite, fünf Bereiche, Bereichsschlüssel, Projektmenü `#proj-knopf`, Speicherort-Dialog `#sync-dlg`, `ui-helfer.mjs`, Knopfzahl 16/14, `#plan-verschieben` in Bereich `phasen`), `.claude/rules/auswahllisten.md` (`mountAuswahlListe`), `.claude/rules/sync-offline.md` (Speicherort-Ort), `.claude/rules/druck.md` (`kopfAngaben`), `.claude/rules/store-daten.md` (neue Projektfelder, `migrate`), `docs/entscheidungen.md` (Fenster → eigene Seite als Modus, Begründung aus der Spec «Umsetzungsweise»), `README.md`, `CHANGELOG.md` (Abschnitt «Unveröffentlicht»).

- [ ] **Step 1:** `grep -rn "ein-dlg\|Einrichten-Fenster\|sechs Reiter\|ei-res-verwalten\|ei-typen-verwalten\|ei-abschnitte-verwalten\|15 Bauzeitenplan\|data-ein=\"sync\"" --include=*.md --include=*.mjs --include=*.js --include=*.html . | grep -v docs/superpowers` → jeder Treffer nachgezogen, danach leer.
- [ ] **Step 2:** `grep -rn "window\.prompt\|[^.]prompt(\|confirm(\|alert(" js/*.js` → leer (Kommentare ausgenommen).
- [ ] **Step 3:** Alle neun Prüfungen parallel (`run_in_background`), Ausgaben gefiltert auf Fehler/Summe: `node tests/run.mjs`, `verify-browser`, `verify-edit`, `verify-live`, `verify-amk`, `verify-klassentreffen`, `verify-print`, `verify-showablauf`, `verify-sync` → alle grün. Screenshots der Seite in allen fünf Themes ansehen.
- [ ] **Step 4:** Verwaiste Prozesse prüfen (`ps -ef | grep -E "http.server|playwright|firefox" | grep -v grep`).
- [ ] **Step 5: Commit** `docs: Einrichten als eigene Seite`
- [ ] **Step 6:** Marco nach Versionsnummer fragen (kein Stempeln, kein Push ohne Antwort).
