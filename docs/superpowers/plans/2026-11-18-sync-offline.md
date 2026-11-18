# GitHub-Sync + Offline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Projekte sind auf jedem Gerät mit eingetragenem GitHub-Schlüssel automatisch da (privates Daten-Repo), und die App läuft nach dem ersten Besuch auch offline. Export/Import bleiben unverändert.

**Architecture:** local-first. `localStorage` bleibt der Arbeitsspeicher. Das neue DOM-freie Modul `js/sync.js` spricht die GitHub-Contents-API (eine Datei je Projekt) und entscheidet über eine reine Funktion `abgleich()`, was hoch- oder heruntergeladen wird oder ein Konflikt ist. `app.js` verdrahtet nur. `sw.js` wird von „cacht nichts" auf „network-first mit Cache-Rückfall" umgestellt.

**Tech Stack:** Vanilla JS, ES-Module, kein Build. Tests: `node tests/*.test.mjs` über `tests/run.mjs`. Browserprüfung: Playwright (`playwright-core`, Firefox) wie in `tools/verify-edit.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-18-sync-offline-design.md`

## Global Constraints

- Ohne eingetragenen Schlüssel verhält sich die App **exakt wie heute**. Alle acht bestehenden `verify-*` laufen ohne Schlüssel und dürfen sich nicht ändern.
- Daten-Repo: `M4dm0nky/Bauzeitenplan-Daten` (privat), Branch `main`, Pfad `projekte/<project.id>.json`, Inhalt = `serialize(plan)`.
- Schlüssel liegt nur in `localStorage` unter `bzp_sync` (`{ token, repo }`), **nie** im Plan, im Export oder im Repo.
- Sync-Metadaten (`remoteSha`, `dirty`) liegen im Projekt-Index (`bzp_projects`), **nie** im Plan.
- Keine `window.prompt/confirm/alert`, jede Rückfrage geht über `askDialog` (app.js).
- `js/sync.js` und die Logik in `persistence.js` bleiben DOM-frei; `fetch` und `storage` werden hereingereicht.
- Konflikt wird **nie** still aufgelöst, sondern immer über einen Dialog mit drei Wahlmöglichkeiten.
- Upload gebündelt: frühestens **10 s** nach der letzten lokalen Speicherung, sofort bei `visibilitychange → hidden` und bei Projektwechsel.
- GitHub-Header: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`. Jeder Abruf mit `cache: 'no-store'`.
- Neue CSS-Bausteine in **allen fünf** Themes und in der `needed`-Liste (`tests/run.mjs`).
- Die Version wird nicht von Hand geändert. Die Nummer fragt Opus vor dem Stempeln bei Marco ab.
- Gestartete Server/Browser am Ende jeder Aufgabe beenden.

## Review Focus

1. **Veraltete Liste nach eigenem Upload:** GitHub-GETs sind 60 s cachebar. Ohne `cache:'no-store'` meldet `list()` kurz nach einem Push die alte `sha`, und es entsteht ein Scheinkonflikt. Testfall: nach `push` liefert die Fake-API die neue sha nur, wenn `cache:'no-store'` gesetzt war (Task 1).
2. **Umlaute/Emoji im Plan:** `btoa` auf einem JS-String wirft bei „Bühne" oder „👤". Testfall: Rundreise `"Bühne 👤 Ölfass"` durch `kodiere`/`dekodiere` (Task 1).
3. **Kein Netz / falscher Schlüssel beim Start:** Die App muss trotzdem mit lokalen Daten starten; der Status wird gelb (offline) bzw. rot (401). Es darf keine Ausnahme bis `boot()` durchschlagen. Testfall: `fetch` wirft TypeError bzw. liefert 401, und `sync.list()` ergibt `{ok:false, grund:'offline'|'schluessel'}` (Task 1). Browserfall in Task 6.
4. **Offenes Projekt wird von außen neuer:** Das gerade angezeigte Projekt ist nicht `dirty` und kommt neuer vom anderen Gerät. Es wird per `open()` ersetzt, mit Toast, ohne Dialog. Ist es `dirty`, kommt der Konfliktdialog (Task 2 Testfall, Task 4 Verdrahtung).
5. **Auf Gerät A gelöscht, auf Gerät B noch offen:** Nicht `dirty` heißt lokal entfernen. `dirty` heißt behalten und neu hochladen (Arbeit geht nie verloren). Testfall in Task 2.

---

### Task 1: GitHub-Client `js/sync.js`

**Files:**
- Create: `js/sync.js`
- Test: `tests/sync.test.mjs` (Stil wie `tests/persistence.test.mjs`: eigenes `test()`, `node:assert/strict`, Ausgabe `✓/✗`)

**Interfaces:**
- Produces:
  - `kodiere(text: string): string` (UTF-8 → Base64) und `dekodiere(b64: string): string` (verträgt Zeilenumbrüche im Base64, wie GitHub sie liefert)
  - `createSync({ fetch, token, repo, branch = 'main' })` → Objekt mit
    - `list(): Promise<{ok:true, dateien:[{id, sha}]} | {ok:false, grund, status?}>`: `GET /repos/{repo}/contents/projekte?ref={branch}`, 404 → `{ok:true, dateien:[]}`, `id` = Dateiname ohne `.json`
    - `pull(id): Promise<{ok:true, text, sha} | {ok:false, grund, status?}>`
    - `push(id, text, sha|null): Promise<{ok:true, sha} | {ok:false, grund, status?}>`: `PUT` mit `{message:'Plan '+id, content, branch, sha?}`, neue sha aus `json.content.sha`
    - `remove(id, sha): Promise<{ok:true} | {ok:false, grund, status?}>`: `DELETE` mit `{message, sha, branch}`
  - `grund`: `'offline'` (fetch wirft), `'schluessel'` (401/403), `'konflikt'` (409/422 bei push/remove), `'fehler'` (sonst)
  - `SYNC_REPO = 'M4dm0nky/Bauzeitenplan-Daten'`

- [ ] **Step 1: Failing tests schreiben.** Ein Fake-`fetch` simuliert die GitHub-API mit einer `Map` Pfad → `{text, sha}` und echten Antwortformen: Verzeichnis-GET = Array `[{name:'p1.json', path:'projekte/p1.json', sha:'…', type:'file'}]`, Datei-GET = `{content: base64 mit '\n' alle 60 Zeichen, sha, encoding:'base64'}`, PUT = `{content:{sha}}`, falsche/fehlende sha bei bestehender Datei → 409. Der Fake liefert die alte sha, wenn `init.cache !== 'no-store'`. Tests:
  - `kodiere/dekodiere: Rundreise "Bühne 👤 Ölfass"`
  - `list: leeres Repo (404) → dateien []`
  - `push neu ohne sha → ok, sha gesetzt; danach list enthält {id:'p1', sha}`
  - `push mit veralteter sha → {ok:false, grund:'konflikt'}, Inhalt unverändert`
  - `pull → text identisch zum gepushten`
  - `remove mit sha → danach list leer`
  - `fetch wirft TypeError → grund 'offline'`; `401 → grund 'schluessel'`
  - `jeder Aufruf sendet Bearer-Header und cache:'no-store'`
- [ ] **Step 2:** `node tests/sync.test.mjs` muss FAIL zeigen (Modul fehlt).
- [ ] **Step 3:** `js/sync.js` implementieren. Base64 über `TextEncoder` + chunkweises `String.fromCharCode` (keine Spread-Argumente über ganze Pläne, das wäre ein Stack-Limit), Dekodieren über `atob` + `TextDecoder`, vorher `\s` entfernen.
- [ ] **Step 4:** `node tests/sync.test.mjs` → alles ✓. Rot-Nachweis: `cache:'no-store'` kurz entfernen, der Header-Test schlägt an. Danach zurück.
- [ ] **Step 5: Commit** `feat(sync): GitHub-Contents-Client, DOM-frei`

### Task 2: Abgleich-Entscheidung `abgleich()`

**Files:**
- Modify: `js/sync.js`
- Test: `tests/sync.test.mjs`

**Interfaces:**
- Consumes: nichts außer Datenformen.
- Produces: `abgleich(lokal: [{id, remoteSha|null, dirty:boolean}], remote: [{id, sha}]): [{art, id, sha?}]` mit `art` ∈ `'hochladen'` (sha = bekannte remoteSha oder null), `'herunterladen'` (sha = remote), `'konflikt'` (sha = remote), `'lokal-loeschen'`. Gleiches ohne Aktion fehlt in der Liste.

Entscheidungstabelle (die Tests sind genau diese Zeilen):

| lokal | remote | Ergebnis |
|---|---|---|
| fehlt | da | herunterladen |
| da, remoteSha null | fehlt | hochladen (sha null) |
| da, remoteSha gesetzt, nicht dirty | fehlt | lokal-loeschen |
| da, remoteSha gesetzt, dirty | fehlt | hochladen (sha null) |
| sha gleich, nicht dirty | da | — |
| sha gleich, dirty | da | hochladen (sha) |
| sha verschieden, nicht dirty | da | herunterladen |
| sha verschieden, dirty | da | konflikt |
| remoteSha null, dirty/nicht | da (gleiche id) | konflikt |

- [ ] **Step 1:** Je Zeile ein Test `abgleich: <Zeile>`, Assertion auf das exakte Aktionsobjekt.
- [ ] **Step 2:** FAIL prüfen.
- [ ] **Step 3:** `abgleich` implementieren.
- [ ] **Step 4:** PASS. Rot-Nachweis: Zeile „sha verschieden, dirty" absichtlich auf `herunterladen` drehen, der Test muss anschlagen.
- [ ] **Step 5: Commit** `feat(sync): Abgleich-Entscheidung als reine Funktion`

### Task 3: Sync-Metadaten im Projekt-Index (`persistence.js`)

**Files:**
- Modify: `js/persistence.js` (`createRepo`, ab Z. 182)
- Test: `tests/persistence.test.mjs`

**Interfaces:**
- Produces (am Objekt aus `createRepo`):
  - `save(plan, { remoteSha } = {})`: ohne Option → Indexeintrag `dirty: true`, `remoteSha` bleibt erhalten. Mit `remoteSha` (String) → `dirty: false`, `remoteSha` gesetzt (für heruntergeladene Pläne).
  - `syncInfo(id): { remoteSha: string|null, dirty: boolean }`: Altdaten ohne Felder → `{ remoteSha: null, dirty: true }`
  - `markSynced(id, sha)`: `dirty:false`, `remoteSha:sha`, sonst nichts ändern
  - `syncListe(): [{id, remoteSha, dirty}]` (Eingabe für `abgleich`)
  - `list()`, `load`, `remove`, `getActive`, `setActive` bleiben unverändert in Verhalten und Rückgabe.

- [ ] **Step 1: Tests:**
  - `save ohne Option → dirty true, remoteSha bleibt`
  - `save mit remoteSha → dirty false`
  - `markSynced → dirty false, sha gesetzt, name/modified unverändert`
  - `Altindex ohne Felder → syncInfo {remoteSha:null, dirty:true}`
  - `serialize(plan) enthält weder remoteSha noch dirty` (Sperre: Metadaten nie im Export)
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** `node tests/run.mjs`, alles grün.
- [ ] **Step 5: Commit** `feat(persistence): Sync-Metadaten im Index`

### Task 4: Verdrahtung in der App + Reiter „Speicherort" + Statussymbol

**Files:**
- Modify: `js/app.js` (`save()` ~Z. 846, `boot()` Z. 160, Projektliste/Löschen ~Z. 947–1003, `main()` Z. 1289, Modulebene für Reiter-Handler)
- Modify: `index.html` (Reiter Z. 224 ff.: `<button data-ein="sync">Speicherort</button>` + `.ei-sec data-ein-tab="sync"`; neben `#save-state` Z. 177 ein `<span class="sync-state" id="sync-state" hidden>`)
- Modify: `styles/base.css` (Geometrie `.sync-state`), alle fünf `styles/themes/*.css` (`.sync-state[data-state=…]`)
- Modify: `tests/run.mjs` (`needed` += `'sync-state'`)

**Interfaces:**
- Consumes: `createSync`, `abgleich`, `kodiere`/`dekodiere` aus Task 1/2 (über `createSync` intern), `repo.syncInfo/markSynced/syncListe/save(plan,{remoteSha})` aus Task 3, `serialize`/`deserialize`, `askDialog`, `toast`, `open`.
- Produces in `app.js` (Modulebene, damit es ohne offenes Projekt geht):
  - `syncKonfig()` liest `bzp_sync` (try/catch) → `{token, repo}|null`
  - `abgleichen(): Promise<void>` führt `abgleich` aus. Für jede Aktion: herunterladen → `deserialize(text)` → `repo.save(plan,{remoteSha:sha})`. Ist es das offene Projekt, folgt `open(plan)` und Toast „Neuere Fassung vom anderen Gerät geladen". Hochladen → `push`, danach `markSynced`. Konflikt → `askDialog` mit Knöpfen `mein` / `fremd` / `beide` (Labels „Meine behalten", „Die vom anderen Gerät nehmen", „Beide behalten (Kopie)"). `beide` speichert die entfernte Fassung mit `deserialize(text,{newId:true})` und Namenszusatz „(anderes Gerät)", dann wird die eigene mit der remote-sha hochgeladen. Abbruch (`null`) → nichts tun, Status rot. Lokal-löschen → `repo.remove(id)`.
  - `setSyncState('ok'|'wartet'|'fehler', titel)` ist der **einzige** Schreiber von `#sync-state` (Symbol ☁ + `data-state` + `title`). Bei fehlender Konfig `hidden`.
  - Upload-Bündelung: `save()` ruft nach erfolgreichem `repo.save` `planeUpload()` (10 s Timer). `visibilitychange→hidden` und Projektwechsel in `open()` lösen sofort `abgleichen()` aus. `online`-Event → `abgleichen()`.
  - `boot()`: unverändert lokal starten, **danach** (nicht davor, nicht blockierend) `abgleichen()`.
  - Projekt löschen (~Z. 1002): Bei aktivem Sync und gesetzter `remoteSha` steht im `askDialog`-Text der Zusatz „Wird auch auf allen anderen Geräten gelöscht." Danach `sync.remove(id, sha)`. Offline → Löschen erst lokal, die Entfernung im Repo holt `abgleich` nicht nach. **Entscheidung:** Das wird im Toast gesagt („Offline gelöscht – auf anderen Geräten bleibt es, bis du es dort löschst"). Grund: eine Löschliste ist eine zweite Wahrheit, YAGNI.
  - Reiter „Speicherort": Passwortfeld für den Schlüssel, Knöpfe *Verbinden* (speichert `bzp_sync`, ruft `list()` als Probe: 401 → Meldung „Schlüssel ungültig", ok → `abgleichen()`) und *Trennen* (löscht `bzp_sync`, lokale Daten bleiben). Dazu eine Zeile Zustand: verbunden mit Repo, letzter Abgleich (Uhrzeit), offene Uploads = Zahl `dirty`. Außerdem ein Hinweistext, wie man den Schlüssel anlegt (fine-grained token, nur dieses Repo, Contents Read & Write).
- Farben: `ok` grün, `wartet` gelb, `fehler` rot, aus den vorhandenen Statustokens des jeweiligen Themes. Keine neuen Gewerkfarben.

- [ ] **Step 1:** Statische Sperre in `tests/run.mjs`: `'sync-state'` in `needed`; zusätzlich ein Check, dass `bzp_sync` in `js/persistence.js` **nicht** vorkommt (Schlüssel nie in der Plan-Schicht). FAIL prüfen.
- [ ] **Step 2:** index.html, base.css, fünf Themes, app.js wie oben.
- [ ] **Step 3:** `node tests/run.mjs` grün, `grep -rn "window\.prompt\|[^.]prompt(\|confirm(\|alert(" js/*.js` leer.
- [ ] **Step 4:** Alle acht bestehenden `verify-*` grün (ohne Schlüssel unverändert).
- [ ] **Step 5: Commit** `feat(sync): Abgleich in der App, Reiter Speicherort, Statussymbol`

### Task 5: Offline per Service Worker

**Files:**
- Modify: `sw.js`
- Modify: `tests/run.mjs` (neuer Check)
- Modify: `CLAUDE.md` (Deploy-Abschnitt: Zusage des SW neu formulieren)

**Interfaces:**
- Produces in `sw.js`: `const CACHE = 'bzp-' + SW_VERSION;` und `const HUELLE = [ … ]` (relative Pfade: `./`, `index.html`, `print.html`, jede Datei aus `js/`, `styles/base.css`, `styles/print.css`, `styles/themes/*.css`, `assets/**`, `klassentreffen-festival.json`, `amk-singleshow.json`).
- `install`: `caches.open(CACHE).addAll(HUELLE)` (mit `?v=` nicht nötig, Treffer per `ignoreSearch`), dann `skipWaiting`.
- `activate`: alle Caches `≠ CACHE` löschen, `clients.claim()`.
- `fetch` (nur eigene Origin, nur GET): `fetch(req,{cache:'no-cache'})`. Bei Erfolg wird `res.clone()` per `cache.put` abgelegt und `res` geliefert. Bei Fehler gilt `caches.match(req,{ignoreSearch:true})`, bei Navigation ersatzweise `index.html`. Bisher waren nur js/css/html/Navigation betroffen, jetzt **zusätzlich** `.json`, `.woff2`, `.svg` der eigenen Origin, damit Fonts und Autostart offline da sind.
- Kill-Switch-Kommentar bleibt. Der Kopfkommentar „CACHET NICHTS" wird ersetzt durch: „network-first: online immer frisch, Cache nur bei Netzfehler. Sperrt deshalb nie eine alte Version ein, solange Netz da ist."

- [ ] **Step 1:** Check in `tests/run.mjs`: `jede ausgelieferte Datei steht in HUELLE`. Er liest `sw.js`, extrahiert das Array und vergleicht es mit dem Dateisystem (`js/*.js`, `styles/**/*.css`, `assets/**`, `*.html`, die zwei JSONs). Beides muss in beide Richtungen stimmen, also keine fehlende und keine tote Datei. FAIL prüfen.
- [ ] **Step 2:** `sw.js` umbauen.
- [ ] **Step 3:** `node tests/run.mjs` grün. Rot-Nachweis: `js/rail.js` aus HUELLE nehmen, der Check muss es melden.
- [ ] **Step 4: Commit** `feat(sw): offline nach erstem Besuch, network-first mit Cache-Rückfall`

### Task 6: Browserprüfung `tools/verify-sync.mjs`

**Files:**
- Create: `tools/verify-sync.mjs` (Gerüst wie `tools/verify-edit.mjs`: eigener `python3 -m http.server` auf freiem Port, Firefox aus dem Playwright-Cache, am Ende Server **und** Browser beenden)
- Modify: `CLAUDE.md` (neunte Zeile in der Werkzeugliste, „Alle neun")

**Interfaces:**
- Consumes: alles aus Task 1–5. Ein GitHub-Fake per `context.route('https://api.github.com/**', …)` mit derselben Antwortform wie in Task 1 (geteilte Map über beide Kontexte = „das Repo").

Prüfungen, jede mit Treffer und Nicht-Treffer:
- [ ] **Step 1: Zwei Geräte.** Kontext A und B tragen den Schlüssel über den Reiter „Speicherort" ein (`?plan=leer`). A legt das Projekt „Sync-Probe" an. Nach dem Abgleich (Projektwechsel oder 10 s, im Test über `visibilitychange` auslösen) steht die Datei im Fake. B lädt neu, und „Sync-Probe" steht in der Projektliste. Ein zweites, nur lokal auf B angelegtes Projekt „Nur-B" erscheint danach im Fake, aber auf A erst nach dessen nächstem Abgleich. Damit ist auch die Richtung geprüft.
- [ ] **Step 2: Konflikt.** A und B ändern „Sync-Probe" verschieden (Projektname bzw. ein Vorgangstitel) bei `setOffline(true)`. A geht online und lädt hoch. B geht online und bekommt den Dialog mit genau drei Knöpfen. Bei „Beide behalten" stehen danach zwei Projekte, eines mit Zusatz „(anderes Gerät)". Screenshot des Dialogs.
- [ ] **Step 3: Falscher Schlüssel.** Der Fake liefert 401, `#sync-state` steht auf `fehler`, und die App ist trotzdem bedienbar (Vorgang anlegen klappt).
- [ ] **Step 4: Offline-Start.** Erster Aufruf online, warten bis `navigator.serviceWorker.controller` gesetzt ist, dann `setOffline(true)` und `reload()`. Die App rendert den Gantt (≥ 1 `.bz-bar`), Schrift Geist ist geladen (`document.fonts.check('12px Geist')`). Gegenprobe: ein frischer Kontext ganz ohne Erstbesuch, offline geladen, zeigt **keine** App. Beweist, dass der Treffer vom Cache kommt.
- [ ] **Step 5:** `node tools/verify-sync.mjs` grün, Screenshots in `tools/shots/` **angesehen** (Statussymbol in Kopfzeile, Reiter Speicherort, Konfliktdialog), Prozesse beendet (`ps -ef | grep -E "http.server|firefox"`).
- [ ] **Step 6: Commit** `test: verify-sync – zwei Geräte, Konflikt, falscher Schlüssel, Offline-Start`

### Task 7: Daten-Repo, echter Durchlauf, Doku (Opus selbst)

- [ ] **Step 1:** `~/.local/bin/gh repo create M4dm0nky/Bauzeitenplan-Daten --private --description "Planstände Bauzeitenplan"` und eine `README.md` mit einer Zeile anlegen (sonst kein `main`).
- [ ] **Step 2: Nutzeraufgabe ansagen:** github.com → Settings → Developer settings → Fine-grained tokens → *Generate new token*, Repository access: *Only select repositories* → `Bauzeitenplan-Daten`, Permissions: *Contents: Read and write*, Ablauf nach Wahl. Token **nicht** in den Chat, sondern im Reiter „Speicherort" eintragen. Für den echten Durchlauf gibt Marco ihn einmal lokal in den Testlauf, ohne ihn zu speichern.
- [ ] **Step 3:** Echter Durchlauf gegen das private Repo: zwei Firefox-Profile (`verify-sync.mjs --echt`, Token über Umgebungsvariable `BZP_TOKEN`, ohne Route-Fake), Projekt anlegen, im zweiten Profil sichtbar, danach Testprojekt wieder löschen. `gh api repos/M4dm0nky/Bauzeitenplan-Daten/contents/projekte` zeigt vorher die Datei und nachher keine.
- [ ] **Step 4:** CLAUDE.md: neuer Abschnitt „Sync und Offline" mit den Regeln aus Global Constraints (local-first, Metadaten nie im Plan, Konflikt nie still, SW network-first), Aufbau-Tabelle um `js/sync.js` ergänzen, Fahrplan-Häkchen. `CHANGELOG.md`-Eintrag folgt mit dem Versionsstempel.
- [ ] **Step 5:** Schlussprüfung: `tests/run.mjs` + alle neun `verify-*` parallel, Screenshots ansehen. **Versionsnummer bei Marco erfragen**, dann `node tools/version.mjs <neu>`, Commit, Merge nach `main` erst nach seiner Freigabe (Push = Live-Deploy, lädt offene Tabs neu), danach `verify-browser --base https://m4dm0nky.github.io/Bauzeitenplan/`. Tag erst nach Rückfrage.
