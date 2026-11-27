# Teil 2: Online mit Anmeldung, Rollen, gleichzeitigem Arbeiten — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die App arbeitet gegen PocketBase: Anmeldung per Einladung, fünf Rollen serverseitig durchgesetzt, Änderungen anderer erscheinen live, Konflikte nur mit Rückfrage, offline nur Ansicht — fertig gebaut und geprüft gegen eine **lokale** PocketBase 0.40.6, bereit für Phase 2 beim Admin.

**Architecture:** Der Store bleibt einziger Weg der Änderung; neu ist eine DOM-freie Schicht `aenderungen.js` (Plan ⇄ Datensätze, Diff, Umkehrung, Anwenden), `rechte.js` (Vorabprüfung je Rolle) und ein patch-basiertes Undo im Store (nimmt nur eigene Schritte zurück). `server.js` lädt/sendet über die PocketBase-Batch-API mit `rev`-Prüfung und bringt fremde Änderungen per Realtime über `store.applyRemote` herein. Rechte prüft der Server unabhängig davon über API-Regeln + Hook.

**Tech Stack:** Vanilla JS, ES-Module, kein Build; PocketBase 0.40.6 (JS-Migrationen `pb_migrations`, JS-Hook `pb_hooks/main.pb.js`, Batch-API, Realtime/SSE), kein SDK; Tests `node tests/run.mjs`, Server-/Browserprüfungen `tools/verify-*.mjs` (Playwright/Firefox) gegen lokale PocketBase.

**Spec:** `docs/superpowers/specs/2026-11-23-online-mehrbenutzer-design.md` (gilt als freigegeben, Marco 2026-11-24), dazu `docs/rueckmeldung-online-phase1-2026-11-23.md` (Server-Stand).

## Entscheidungen dieses Plans (Claude, im Sinn der Spec; landen in `docs/entscheidungen.md`)

- **E-1 Branch `online`** von `main`. Bis zum Live-Gang bleibt `main` die lokale App (Spec 15). Der Branch ist die Server-Fassung komplett: GitHub-Sync und lokaler Modus entfallen dort.
- **E-2 Datensatzform einheitlich:** jede Plan-Collection hat `plan_id`, `eid` (heutige id des Eintrags), `daten` (JSON: das ganze heutige Objekt), `rev` (Zahl), `pos` (Zahl, Reihenfolge im Array). Nur was Regeln/Hook brauchen, steht zusätzlich als Spalte: `vorgaenge.gewerk`, `verknuepfungen.von`/`nach`. Abweichung von Spec 7 (`tid`/`gid`/… und Einzelspalten), weil so kein neues Task-Feld je eine Schemaänderung braucht (Projektregel «neue Felder müssen durch»).
- **E-3 `plaene.daten`** = `project` ohne `ressourcen` (die liegen in `ressourcen`, Spec 7). Eine Plan-Änderung (Name, Zeitraum, `punktTypen`, `abschnitte`) ist eine Änderung an einem Datensatz.
- **E-4 O-2 entfällt:** Untervorgänge liegen immer im Gewerk des Elternvorgangs (`addTask`, Regel store-daten). Die Hülle ist also immer eine Änderung im eigenen Gewerk und wird normal gesendet.
- **E-5 O-4:** Die verify-Skripte seeden über `tools/pb-lokal.mjs` (startet die PocketBase-Binary headless auf freiem Port mit leerem Datenordner, legt Konten und Plan per API an, beendet sie). Die App nimmt `?api=<url>` nur an, wenn `location.hostname` `localhost` oder `127.0.0.1` ist.
- **E-6 CORS** macht Traefik (Admin, Phase 1); lokal `serve --origins`. Kein CORS im Hook (Traefik hat ohnehin das letzte Wort).
- **E-7 Undo patch-basiert** für alle Fälle (nicht nur online): ein Undo-Eintrag ist die Änderungsliste des Befehls; Undo wendet ihre Umkehrung auf den aktuellen Stand an. Weicht ein betroffener Datensatz inzwischen ab (fremde Änderung), liefert `undo()` `{ok:false, konflikt:[…]}` und die App fragt per `askDialog`.
- **E-8 Einladung:** Datensatz `einladungen` mit `token` (32 Zeichen, vom Hook erzeugt), `ablauf` +14 Tage. Hook-Route `POST /api/bzp/einladung` (`{token, name, passwort}` ohne Konto, oder angemeldet nur `{token}`) legt Konto/Mitgliedschaft an und löscht die Einladung. Existiert das Konto beim Einladen schon, legt der Hook sofort die Mitgliedschaft an statt einer Einladung. Mail nur, wenn PocketBase SMTP hat (Live); sonst gibt die Antwort den Link zurück (Test).
- **E-9 Seiten:** `login.html` (Anmelden, Passwort vergessen, Einladung annehmen, Passwort neu — per Query `?einladung=`/`?reset=`). Mitglieder-Verwaltung als Dialog in der App, Superadmin-Verwaltung als Dialog in der App (kein `admin.html`).
- **E-10 Rollen-Info** für den Client: `rolleIn(plan, user, mitglieder)` → `{rolle:'superadmin'|'besitzer'|'produktionsleitung'|'bearbeiter'|'gewerkeleiter'|'betrachter', gewerke:[]}`.

## Global Constraints

- Store ist der einzige Weg, den Plan zu ändern; Validierung VOR der Änderung; ein abgelehnter Befehl (auch durch Rechte oder offline) hinterlässt nichts: kein Undo-Eintrag, keine Ungesichert-Marke.
- DOM-frei und mit Tests: `aenderungen.js`, `rechte.js`, `store.js`, `server.js` (fetch und EventSource hereingereicht).
- Alle ids als **Text**, nie Relation; E-Mails `.toLowerCase()`.
- Kein Token/Passwort in Repo, Plan oder Export. Token nur in `localStorage` (`bzp_auth`). Superuser lokal nur in `tools/.pb/` (gitignored).
- Niemals `window.prompt`/`confirm`/`alert`: `askDialog`, `neuFragen`, eigene Dialoge.
- Rollen nur in der Oberfläche zu sperren reicht nie: jede Regel hat einen Servertest «verboten» direkt per API.
- Live-Monitor wird nie leer: Anmeldung abgelaufen oder Netz weg → lokale Kopie + Hinweis.
- Neue Datei → `HUELLE` in `sw.js` und (Baustein) `needed` in `tests/run.mjs`; neue HTML-Seite → `tools/version.mjs` und Versionsprüfung in `tests/run.mjs`.
- PocketBase-Eigenheiten: Filterregel ohne Treffer = 200 mit leerer Liste (maßgeblich `totalItems`); im Hook sieht ein Handler keine Top-Level-Funktionen (Hilfen per `require(`${__hooks}/hilfen.js`)`); `record.original()`.
- Symbole statt Textkürzel, Status nie nur über Farbe; dunkle Themes farbig.
- Gestartete PocketBase-/Browser-Prozesse beenden die Skripte selbst, auch bei Fehler (`try/finally`).

## Review Focus

1. **Gewerkeleiter verschiebt einen Vorgang in ein fremdes Gewerk** (alt eigenes, neu fremdes) → Server lehnt ab, Client lehnt vorher ab, nichts bleibt hängen. Test in Task 3 und Task 5.
2. **Zwei Leute ändern denselben Vorgang fast gleichzeitig** → der zweite bekommt den Dreiknopf-Dialog, nie stilles Überschreiben; verschiedene Vorgänge kollidieren nie. Test in Task 7 und Task 12.
3. **⌘Z nach einer fremden Änderung am selben Eintrag** → Rückfrage statt Überschreiben; ⌘Z nach fremder Änderung an ANDEREM Eintrag → nimmt nur die eigene zurück. Test in Task 4 und Task 12.
4. **Netz bricht mitten im Senden ab** → nichts geht still verloren: offener Stapel wird beim Wiederverbinden gesendet, bei `rev`-Abweichung Konfliktdialog. Test in Task 7 und Task 12.
5. **Live-Monitor mit abgelaufener Anmeldung/ohne Netz beim Start** → zeigt die lokale Kopie mit Hinweis, Jetzt-Linie tickt. Test in Task 10.

---

### Task 1: Branch, lokale PocketBase-Werkzeuge

**Files:**
- Create: `tools/pb-lokal.mjs`, `pocketbase/README.md`
- Modify: `.gitignore` (`tools/.pb/`, `pocketbase/*.local.json`), `.gitattributes` (Binaries `-diff`)

**Interfaces:**
- Produces: `startePb({ port?: number }) → Promise<{ url, stop(): Promise<void>, admin: {email, passwort}, su(method, path, body) }>` — lädt bei Bedarf `pocketbase_0.40.6_<darwin|linux|windows>_<arm64|amd64>.zip` von GitHub-Releases nach `tools/.pb/`, startet `serve --http 127.0.0.1:<port> --dir <tmp> --hooksDir pocketbase/pb_hooks --migrationsDir pocketbase/pb_migrations --origins http://localhost:<appPort>,http://127.0.0.1:<appPort>` (Origins aus Option `origins`), legt den Superuser per CLI `superuser upsert` an, wartet auf `/api/health` = 200 (Zeitlimit 20 s). `stop()` beendet den Prozess und löscht den Datenordner. `su()` ruft die API als Superuser.
- Produces: `kontoAnlegen(pb, {email, name, passwort, superadmin?, produktionsleitung?}) → Promise<{id, token}>`, `anmelden(pb.url, email, passwort) → Promise<{token, record}>`.

- [ ] **Step 1:** `git checkout -b online`.
- [ ] **Step 2:** `tools/pb-lokal.mjs` schreiben; Selbsttest am Ende der Datei bei direktem Aufruf (`node tools/pb-lokal.mjs`): starten, `/api/health` → 200, stoppen, Ausgabe `PB OK`.
- [ ] **Step 3:** `node tools/pb-lokal.mjs` → `PB OK`; danach `ps -ef | grep [p]ocketbase` leer.
- [ ] **Step 4:** Commit `chore: lokale PocketBase 0.40.6 für Prüfungen`.

### Task 2: Schema und API-Regeln (Migration)

**Files:**
- Create: `pocketbase/pb_migrations/1700000001_schema.js`, `tools/verify-pb-regeln.mjs`

**Interfaces:**
- Produces Collections (alle mit `created`/`updated` Autodate):
  - `users` (Auth, bestehende erweitern): `name` text, `superadmin` bool, `produktionsleitung` bool. `createRule = null` (Konten nur über Hook-Route), `updateRule = "id = @request.auth.id"` (Flags schützt der Hook, Task 3), `listRule/viewRule = "@request.auth.id != ''"`.
  - `plaene`: `plan_id` text unique, `besitzer` text, `daten` json, `rev` number.
  - `mitglieder`: `plan_id`, `user_id`, `rolle` select(`produktionsleitung`,`bearbeiter`,`gewerkeleiter`,`betrachter`), `gewerke` json; unique (`plan_id`,`user_id`).
  - `einladungen`: `plan_id`, `email`, `rolle`, `gewerke` json, `token` text unique, `ablauf` date.
  - `ressourcen`, `gewerke`, `vorgaenge`, `phasen`, `verknuepfungen`: `plan_id`, `eid`, `daten` json, `rev` number, `pos` number; unique (`plan_id`,`eid`); zusätzlich `vorgaenge.gewerk` text, `verknuepfungen.von`/`nach` text.
  - Settings: `batch.enabled = true`, `batch.maxRequests = 2000`, `batch.timeout = 30`, `batch.maxBodySize = 0`.
- Regeln (Ausdrücke als Konstanten oben in der Migration):
  - `MITGLIED = "(@request.auth.superadmin = true || @collection.plaene.plan_id ?= plan_id && @collection.plaene.besitzer ?= @request.auth.id || @collection.mitglieder.plan_id ?= plan_id && @collection.mitglieder.user_id ?= @request.auth.id)"` — lesen (`list`/`view`) aller Plan-Collections. Für `plaene` selbst `plan_id`-Vergleich entsprechend.
  - Schreiben Plan-Collections: angemeldet + Mitglied mit Rolle ≠ betrachter oder Besitzer/Superadmin (Regel); Feinheiten (Gewerk, Status, Ressourcen-Ändern) im Hook.
  - `plaene.createRule`: `@request.auth.superadmin = true || @request.auth.produktionsleitung = true`.
  - `mitglieder`, `einladungen`: Superadmin, Besitzer, Mitglied `produktionsleitung` des Plans.

- [ ] **Step 1: Failing test** `tools/verify-pb-regeln.mjs` Abschnitt «SCHEMA»: PB starten, Konten anlegen (super, pl, bearb, gwl Licht, betr, fremd), PL legt Plan + je 1 Datensatz aller Collections per Batch an; `fremd` listet `vorgaenge` → `totalItems` 0; `betr` liest → >0, schreibt → 4xx; ohne Anmeldung → 0/4xx; `betr` legt `plaene` an → 4xx. Ausgabe je Prüfung `✓`/`✗`, Exit 1 bei `✗`.
- [ ] **Step 2:** `node tools/verify-pb-regeln.mjs` → scheitert (keine Collections).
- [ ] **Step 3:** Migration schreiben.
- [ ] **Step 4:** `node tools/verify-pb-regeln.mjs` → alle ✓.
- [ ] **Step 5:** Commit `feat: PocketBase-Schema und API-Regeln`.

### Task 3: Hook — rev, Besitzer, Gewerkeleiter, Bedarfsstatus, Konten, Einladung

**Files:**
- Create: `pocketbase/pb_hooks/main.pb.js`, `pocketbase/pb_hooks/hilfen.js`
- Modify: `tools/verify-pb-regeln.mjs`

**Interfaces:**
- `rev`: Update auf Plan-Collections verlangt im Body `rev` = gespeicherter `rev`, sonst **409** mit `{code:'rev', eid, rev:<aktuell>}`; der Hook setzt `rev+1`. Create setzt `rev = 1`. Delete verlangt `?rev=<n>` passend, sonst 409.
- `plaene` create: `besitzer = @request.auth.id`, egal was gesendet wurde.
- Rolle aus `hilfen.rolle(app, planId, authRecord)` → wie E-10.
- Gewerkeleiter: `vorgaenge` create/update/delete nur mit `gewerk` (alt UND neu) ∈ `gewerke` und `≠ 'projekt'`; `verknuepfungen` nur, wenn Vorgang `nach` im eigenen Gewerk; `ressourcen` nur create; `plaene`, `gewerke`, `phasen` gar nicht. → 403 mit Klartext («Nur Licht, Video darfst du ändern.»).
- Bedarfsstatus: je Zeile in `daten.res` alt gegen neu (Zuordnung über Index und `rid`); wird `status` auf `bestaetigt`/`abgelehnt` gesetzt oder `notiz`/`bestaetigtAm` verändert, ohne dass die Rolle superadmin/besitzer/produktionsleitung ist → 403. Rückfall auf angefragt (Feld fällt weg) darf jeder Schreibberechtigte.
- Konsistenz: `vorgaenge.gewerk` muss `'projekt'` oder ein `gewerke.eid` desselben Plans sein; `verknuepfungen.von/nach` müssen existieren (im Batch gelten bereits angelegte Datensätze derselben Transaktion). Sonst 400.
- `users` update: `superadmin`/`produktionsleitung` ändern nur Superadmin; `email` ändern niemand über die API.
- `einladungen` create: Token erzeugen, `email` klein; existiert Konto → Mitgliedschaft anlegen, Einladung nicht speichern, Antwort `{direkt:true}` (über `e.json(200, …)`); sonst `{link: <APP_URL>/login.html?einladung=<token>}` und Mail, wenn `$app.settings().smtp.enabled`.
- Route `POST /api/bzp/einladung`: s. E-8; Passwort ≥ 10 Zeichen; abgelaufen/unbekannt → 400.

- [ ] **Step 1: Failing tests** in `verify-pb-regeln.mjs`, Abschnitte «REV» (zweites Update mit altem rev → 409, Daten unverändert; Batch mit einem falschen rev → ganzer Batch zurückgerollt), «GEWERKELEITER» (eigener Vorgang ändern ok; nach Ton verschieben → 403; Ton-Vorgang ändern → 403; `projekt`-Vorgang → 403; Verknüpfung mit Nachfolger Licht ok, mit Nachfolger Ton → 403; Ressource anlegen ok, umbenennen → 403; Gewerk/Phase/Plan ändern → 403), «STATUS» (gwl setzt bestaetigt → 403; pl → ok; gwl ändert Anzahl einer bestätigten Zeile mit Status entfernt → ok), «KONTEN» (normaler Nutzer setzt `superadmin` an sich → 403; Superadmin setzt `produktionsleitung` → ok), «EINLADUNG» (pl lädt neue Adresse ein → Link; annehmen mit Name+Passwort → Konto ist Mitglied mit Rolle; Token zweimal → 400; pl lädt vorhandenes Konto ein → sofort Mitglied; bearb lädt ein → 403), «BESITZER» (gesendeter fremder `besitzer` wird überschrieben), «KONSISTENZ» (Vorgang auf unbekanntes Gewerk → 400).
- [ ] **Step 2:** Lauf → ✗.
- [ ] **Step 3:** Hook schreiben (Fehlerlogs: `_logs` in `auxiliary.db`, Hinweis in `pocketbase/README.md`).
- [ ] **Step 4:** Lauf → alle ✓. Rot-Nachweis: eine Gewerkeleiter-Prüfung im Hook auskommentieren → «GEWERKELEITER» ✗; zurücknehmen.
- [ ] **Step 5:** Commit `feat: Hook mit rev-Prüfung, Rollen, Bedarfsstatus, Einladung`.

### Task 4: `aenderungen.js` und patch-basiertes Undo im Store

**Files:**
- Create: `js/aenderungen.js`, `tests/aenderungen.test.mjs`
- Modify: `js/store.js` (`createStore`), `tests/store.test.mjs`, `tests/run.mjs`, `sw.js`

**Interfaces:**
- Produces (`js/aenderungen.js`, ohne DOM):
  - `COLLS = ['plaene','ressourcen','gewerke','vorgaenge','phasen','verknuepfungen']`
  - `zerlegen(state) → { [coll]: Map<eid, objekt> }` (plaene: ein Eintrag mit `eid = project.id`, Objekt = project ohne `ressourcen`; ressourcen = `project.ressourcen || []`; vorgaenge = tasks; phasen = phases; verknuepfungen = deps; gewerke).
  - `zusammensetzen(teile, reihenfolge?) → state` (Umkehrung; Arrays in `pos`-Reihenfolge, sonst Einfügereihenfolge der Map).
  - `aenderungen(vorher, nachher) → { [coll]: { anlegen: obj[], aendern: {vorher, nachher}[], loeschen: obj[] } }` — Vergleich je eid per kanonischem JSON (Schlüssel sortiert).
  - `istLeer(a) → bool`, `umkehren(a) → a'`, `anwenden(state, a) → { ok:true, state } | { ok:false, konflikt: {coll, eid, art:'geaendert'|'geloescht'|'existiert'}[] }` (prüft, dass jeder betroffene Datensatz im Ausgangszustand dem `vorher` entspricht).
- Store (`createStore(initial, opt = {})`):
  - `opt.pruefe(vorher, nachher, aend) → null | string` läuft in `apply` nach `reflowParents`, vor dem Übernehmen; Text = Ablehnung (`{ok:false, error}`), nichts bleibt.
  - `opt.gesperrt() → null | string` vor jedem `apply`/`undo`/`redo` (offline/Betrachter) → `{ok:false, error}`.
  - Undo-Einträge = Änderungslisten; `undo({ erzwingen } = {}) → { ok:true } | { ok:false, konflikt } | false` (false = nichts zu tun, wie bisher). `erzwingen` überschreibt die Abweichung. `redo` symmetrisch.
  - `applyRemote(nextState)` ersetzt den Zustand ohne Undo-Eintrag, ohne `dirty`, ruft `notify`; Undo-/Redo-Stapel bleiben.
  - `subscribe(fn)` bekommt zusätzlich `(state, info)` mit `info = { quelle: 'lokal'|'undo'|'redo'|'remote'|'replace', aend }`.

- [ ] **Step 1: Failing tests** `tests/aenderungen.test.mjs`: Rundweg `zusammensetzen(zerlegen(p))` deepEqual `p` für `tools/fixtures/klassentreffen-festival.json` und den AMK-Fixture (über `deserialize`); Diff nach `moveTask` = genau 1 `vorgaenge.aendern`; nach `addRessource` = 1 `ressourcen.anlegen`, `plaene` unverändert; nach `removeGewerk` = Gewerk + Vorgänge + Verknüpfungen gelöscht; `anwenden(nachher, umkehren(a))` ergibt `vorher`; `anwenden` mit abweichendem Datensatz → `konflikt` mit `art:'geaendert'`. `tests/store.test.mjs`: `pruefe` lehnt ab → kein Undo, `dirty` false; `applyRemote` setzt nicht `dirty`, ⌘Z danach nimmt nur den eigenen Schritt zurück und die fremde Änderung an einem ANDEREN Vorgang bleibt; fremde Änderung am SELBEN Vorgang → `undo()` liefert `konflikt`, `undo({erzwingen:true})` stellt her; `gesperrt` lehnt `apply` und `undo` ab. Alle bestehenden Store-Tests bleiben grün.
- [ ] **Step 2:** `node tests/run.mjs` → neue Tests ✗.
- [ ] **Step 3:** `aenderungen.js` schreiben; Store-Undo umbauen.
- [ ] **Step 4:** `node tests/run.mjs` → grün; `node tools/verify-edit.mjs` (lokal, noch vor dem Servermodus) → grün (Undo-Abschnitte).
- [ ] **Step 5:** Commit `feat: Änderungslisten und Undo nur eigener Schritte`.

### Task 5: `rechte.js` (Vorabprüfung im Client)

**Files:**
- Create: `js/rechte.js`, `tests/rechte.test.mjs`; Modify: `tests/run.mjs`, `sw.js`

**Interfaces:**
- Consumes: `aenderungen()` (Task 4).
- Produces: `rechteFehler(rolle: {rolle, gewerke}, aend, vorher, gewerkName: (id)=>string) → null | string` — gleiche Regeln wie der Hook (Task 3), Texte: «Nur ansehen: du bist Betrachter.», «Nur Licht, Video darfst du ändern.», «Bedarf bestätigen darf nur die Produktionsleitung.», «Zeitraum, Phasen und Gewerke ändert die Produktionsleitung oder ein Bearbeiter.», «Bezeichnungen umbenennen oder löschen darf nur …». `darfBearbeiten(rolle) → bool`, `darfMitglieder(rolle) → bool`, `darfPlanAnlegen(user) → bool`.

- [ ] **Step 1: Failing test** Tabelle aller fünf Rollen (+ besitzer) × {Vorgang eigenes Gewerk, fremdes Gewerk, Verschieben eigen→fremd, `projekt`-Vorgang, Verknüpfung Nachfolger eigen/fremd, Ressource anlegen/umbenennen, Gewerk/Phase/Plan ändern, Status bestätigen, Status-Rückfall} → erwartete Ja/Nein-Matrix aus Spec 5 (Matrix als Daten im Test). Rot-Nachweis: eine Zeile absichtlich falsch → Test rot.
- [ ] **Step 2–4:** ✗ → umsetzen → `node tests/run.mjs` grün.
- [ ] **Step 5:** Commit `feat: Rechte-Vorabprüfung je Rolle`.

### Task 6: `pb.js` (Client) mit Anmeldung und Token-Erneuerung

**Files:**
- Create: `js/pb.js`, `tests/pb.test.mjs`; Modify: `tests/run.mjs`, `sw.js`

**Interfaces:**
- Produces: `apiBasis(loc = location) → string` — `api-test.callboard.nyxlightwork.de` für `m4dm0nky.github.io` und `localhost`/`127.0.0.1`, `api.callboard.nyxlightwork.de` für `callboard.nyxlightwork.de`; `?api=` nur auf localhost/127.0.0.1.
- `createPb({ basis, fetch, speicher, EventSource }) → { auth, anmelden(email, pw), abmelden(), erneuern(), liste(coll, filter), eins(coll, id), batch(anfragen), post(path, body), abo(themen[], beiEreignis) → stop, istAngemeldet }` — Token/Record in `speicher` unter `bzp_auth`; `erneuern()` bei Start und alle 6 h (`auth-refresh`); 401 → `auth = null`, Ereignis `abgemeldet`. Fehler als `{ok:false, status, code, message}` statt Ausnahme. `liste` folgt allen Seiten (`perPage` 500). Realtime: EventSource `/api/realtime`, `PB_CONNECT` liefert `clientId`, dann `POST /api/realtime` mit `subscriptions` und Authorization; Wiederverbinden meldet `verbunden`/`getrennt`.

- [ ] **Step 1: Failing tests** mit gefälschtem `fetch`/`EventSource` (Datenformen aus echten PB-Antworten, in Task 1 einmal mitgeschnitten und als Konstante im Test): Hostname-Wahl (3 Hosts + `?api=` auf fremdem Host ignoriert); Anmelden speichert Token, `abmelden` löscht; 401 → `abgemeldet`; Liste über 2 Seiten; Batch-Fehler 409 → `{ok:false, status:409, code:'rev'}`.
- [ ] **Step 2–4:** ✗ → umsetzen → grün.
- [ ] **Step 5:** Commit `feat: PocketBase-Client ohne SDK`.

### Task 7: `server.js` — Plan laden, senden mit rev, Realtime, Warteschlange

**Files:**
- Create: `js/server.js`, `tests/server.test.mjs`; Modify: `tests/run.mjs`, `sw.js`, `tools/verify-pb-regeln.mjs`

**Interfaces:**
- Consumes: `zerlegen`/`zusammensetzen`/`aenderungen` (Task 4), `createPb` (Task 6).
- Produces: `createServerPlan({ pb, planId }) → {`
  - `laden() → { ok, state, rolle, mitglieder } | { ok:false, … }` (alle Collections mit `plan_id`, merkt `rev`/Record-id je eid),
  - `senden(aend) → { ok:true } | { ok:false, konflikt: {coll, eid, art, fremd: obj|null}[] } | { ok:false, offline:true }` — ein Batch; Warteschlange: was offline nicht ging, bleibt in `offen` und geht bei `wiederVerbunden()` raus,
  - `abonnieren(beiFremd: (teil:{coll, eid, objekt|null}) => void)` — eigene Echos (gleicher `rev`, den wir gerade geschrieben haben) werden verschluckt,
  - `planAnlegen(state) → {ok}` (Import/Vorlage/Neu: plaene + alles in einem Batch, neue `plan_id`),
  - `planLoeschen()`, `get offen()` `}`.
- `listePlaene(pb) → [{plan_id, name, venue, rolle}]` für den Projektdialog.

- [ ] **Step 1: Failing tests** (Unit, gefälschter pb): Senden baut Batch-Anfragen mit `rev`; 409 → `konflikt` mit fremdem Stand; Echo verschluckt; offline → `offen` gefüllt, `wiederVerbunden` sendet. Abschnitt «SERVERPLAN» in `verify-pb-regeln.mjs` gegen echte PB: Klassentreffen-Fixture anlegen → laden → deepEqual; zwei Clients, A ändert Vorgang X, B bekommt per Realtime genau X; A und B ändern X mit gleichem rev → einer ok, einer `konflikt`.
- [ ] **Step 2–4:** ✗ → umsetzen → grün.
- [ ] **Step 5:** Commit `feat: Serverplan mit rev-Prüfung und Realtime`.

### Task 8: `login.html` — Anmelden, Passwort vergessen, Einladung annehmen

**Files:**
- Create: `login.html`, `js/login.js`, `styles/login.css` (oder in `base.css`, wenn klein)
- Modify: `tools/version.mjs`, `tests/run.mjs` (Versionsprüfung, `needed`), `sw.js`

**Interfaces:**
- Consumes: `createPb`, `apiBasis` (Task 6).
- Verhalten: ohne Query: E-Mail + Passwort → bei Erfolg `index.html` (mit `?api=` weitergereicht). «Passwort vergessen» → `requestPasswordReset`, Antwort immer gleich («Wenn die Adresse bekannt ist, kommt eine Mail.»). `?einladung=<t>` → Name + Passwort (2×) → `POST /api/bzp/einladung` → angemeldet → `index.html`. `?reset=<t>` → neues Passwort → `confirmPasswordReset`. Fehler im eigenen Hinweisfeld, kein `alert`. Theme wie die App (gleiche Theme-Dateien, Hell/Dunkel).

- [ ] **Step 1:** Abschnitt «ANMELDUNG» in neuem `tools/verify-mehrbenutzer.mjs` (PB lokal, App über statischen Server wie die anderen verify-Skripte): falsches Passwort → Hinweis sichtbar, keine Weiterleitung; richtiges → Projektdialog; Einladungslink aus Hook-Antwort → Name/Passwort → im Plan mit Rolle. Screenshot `login.png` (dunkel).
- [ ] **Step 2–4:** ✗ → umsetzen → grün; Screenshot ansehen.
- [ ] **Step 5:** Commit `feat: Anmeldeseite mit Einladung und Passwort zurücksetzen`.

### Task 9: App auf Server umstellen (Start, Projektdialog, Speichern, Import, Sync raus)

**Files:**
- Modify: `js/app.js` (boot, open, sichern/scheduleSave, showProjectDialog, doImport, loescheProjekt, Sync-Block), `index.html`, `print.html` (Plan aus lokaler Kopie wie bisher), `js/persistence.js` (bleibt: lokale Kopie + Export/Import)
- Delete: `js/sync.js`, `tests/sync.test.mjs`, `tools/verify-sync.mjs`, Dialog `#sync-dlg`, Menüeintrag `#sync-oeffnen`
- Modify: `tests/run.mjs` (Sperren: Sync weg; neue Sperre «kein `bzp_sync`»), `sw.js`

**Interfaces:**
- Consumes: Tasks 4–7.
- Verhalten:
  - Start: nicht angemeldet → `login.html` (außer Live-Monitor mit lokaler Kopie, Task 10). Angemeldet → Projektdialog mit `listePlaene` (Name, Ort, Rolle als Symbol+Text); `?plan=leer` öffnet das aktive/erste wie bisher.
  - `open(planId)`: `createServerPlan.laden()` → `store.replace`; `createStore(plan, { pruefe: (v,n,a) => rechteFehler(rolle, a, v, …), gesperrt: () => offline ? 'Offline – nur Ansicht' : (rolle.rolle==='betrachter' ? 'Nur ansehen: du bist Betrachter.' : null) })`.
  - `subscribe((s, info))`: `quelle` lokal/undo/redo → `server.senden(info.aend)`; Konflikt → `askDialog` «‹Titel› wurde gerade von ‹Name› geändert» mit **Ihre Fassung nehmen** / **Meine behalten** / Abbrechen; gelöscht → **Wiederherstellen** / **Verwerfen**. «Meine behalten» sendet erneut mit dem neuen `rev`. Immer zusätzlich lokale Kopie über `repo.save` (offline-Ansicht).
  - Undo-Konflikt (Task 4) → `askDialog` «… wurde inzwischen von ‹Name› geändert. Trotzdem zurücknehmen?» → `undo({erzwingen:true})`.
  - Fremde Änderung → `store.applyRemote` (Projektion über `zusammensetzen`), kein Toast je Änderung.
  - Neu / Vorlage / Import → `planAnlegen` (nur wenn `darfPlanAnlegen`, sonst Knöpfe aus mit Grund). Import: neue `plan_id` (Spec 15).
  - Projekt löschen: nur Besitzer/Superadmin, `askDialog`.
  - Kopfzeile: Anmeldung (Name, Abmelden) im Projektmenü; Speicherstand-Anzeige zeigt «gesendet»/«sendet…»/«offen (n)».
- Export bleibt (JSON-Sicherung, ohne Token).

- [ ] **Step 1:** Abschnitte «ZWEI NUTZER» und «IMPORT» in `verify-mehrbenutzer.mjs`: zwei Browserkontexte, zwei Konten (pl, bearb) im selben Plan; A verschiebt Vorgang → B sieht neue Zeit ≤ 3 s, ohne Undo-Eintrag bei B; A und B ändern denselben Vorgang mit gestoppter Realtime bei B → B bekommt Konfliktdialog, «Ihre Fassung nehmen» zeigt As Wert; B ändert anderen Vorgang → kein Dialog; A ⌘Z nach Bs Änderung an anderem Vorgang → Bs Änderung bleibt; Import AMK als pl → Plan im Dialog beider. Plus `tests/run.mjs`-Sperre: `sync.js` existiert nicht, kein `bzp_sync` in `js/`.
- [ ] **Step 2–4:** ✗ → umsetzen → grün.
- [ ] **Step 5:** Commit `feat: App arbeitet gegen PocketBase, GitHub-Sync entfällt`.

### Task 10: Offline nur Ansicht, Live-Monitor ohne Anmeldung/ohne Netz

**Files:**
- Modify: `js/app.js`, `js/gantt.js` (Ziehen aus bei `nur-ansicht`), `js/table.js`, `js/inspector.js` (Felder `readOnly`/`disabled` bei `nur-ansicht`), `styles/base.css` (gelbe Kopfzeilenmarke `.hd-offline`, Klasse `.nur-ansicht`), Themes falls Token fehlen, `tests/run.mjs` (`needed`)

**Interfaces:**
- `setNurAnsicht(grund: null|'offline'|'betrachter'|'abgemeldet')` in app.js = einziger Schreiber von `body.classList` `nur-ansicht` und der Kopfzeilenmarke (Symbol + Text: «📡 Offline – nur Ansicht», «👁 Nur ansehen», «🔑 Anmeldung abgelaufen – lokale Kopie»).
- Offline erkannt über Realtime `getrennt` oder Netzfehler beim Senden; `online`/`verbunden` → `laden()` neu, abonnieren, offene Warteschlange senden (Konflikte → Dialog), Marke weg.
- Start ohne Netz oder mit abgelaufener Anmeldung bei Live-Monitor (`bzp_live=1`) → lokale Kopie öffnen, `nur-ansicht`, nie `login.html`, nie leere Seite.

- [ ] **Step 1:** `verify-mehrbenutzer.mjs` «OFFLINE»: `context.setOffline(true)` → Marke sichtbar, Ziehen eines Balkens ändert nichts, Feld im Panel schreibgeschützt, Jetzt-Linie bewegt sich nach gestellter Uhr; Änderung kurz vor Abbruch bleibt in Warteschlange und kommt nach `setOffline(false)` beim anderen Nutzer an. «MONITOR»: PB gestoppt, `bzp_live=1` + lokale Kopie → Plan sichtbar mit Marke. `verify-live.mjs` bleibt grün.
- [ ] **Step 2–4:** ✗ → umsetzen → grün; Screenshot `offline.png` ansehen.
- [ ] **Step 5:** Commit `feat: Offline nur Ansicht, Monitor zeigt lokale Kopie`.

### Task 10b: Rate Limits (nachgetragen 2026-11-26 nach Rückmeldung Robs)

Anlass: `docs/rueckmeldung-online-phase1-abschluss-2026-11-26.md`. Auf TEST und LIVE sind die PB-Standardregeln aktiv: `*:auth` 2/3 s, `*:create` 20/5 s, `/api/batch` 3/1 s, `/api/` 300/10 s, je Client-IP. Messung an lokaler PB 0.40.6 (2026-11-26):
- `*:create` zählt auch die Unteranfragen eines Batches. Ab der 21. kommt ein inneres 429, und der ganze Batch wird zurückgerollt. Damit scheitert `planAnlegen` schon bei AMK (52 Unteranfragen) und Klassentreffen (407).
- `/api/batch`: ab dem 4. Batch in 1 s kommt 429, ohne `Retry-After`. Nach etwa 0,75 s ist es wieder frei.
- `auth-refresh` zählt nicht gegen `*:auth`, nur die Anmeldung. Der Superuser ist ausgenommen.
- `{APP_URL}` mit Schrägstrich am Ende ergibt in der Reset-Mail `…//login.html`. TEST hat `https://m4dm0nky.github.io/Bauzeitenplan/`.

**Files:**
- Create: `pocketbase/pb_migrations/1700000003_ratelimits.js`
- Modify:
  - `pocketbase/pb_hooks/main.pb.js` (Reset-Mail-Link)
  - `js/pb.js`, `js/server.js`, `js/app.js`, `js/login.js`
  - `tools/pb-lokal.mjs` (Option `rateLimits: true`)
  - `tools/verify-pb-regeln.mjs` (Abschnitt «RATELIMIT»)
  - Tests, Themes/`tests/run.mjs` (Marke aus Task 10)

**Interfaces / Verhalten:**
- **Migration `1700000003_ratelimits.js`:**
  - Setzt die Regel `*:create` auf `maxRequests 2000`, `duration 5`. Das passt zu `MAX_BATCH`, ein ganzer Plan geht in einem Batch durch.
  - Die übrigen Regeln und `rateLimits.enabled` lässt sie unverändert. Fehlt die Regel, legt sie sie an.
  - Idempotent.
  - Wirkt auf dem Server erst mit dem Phase-2-Deploy; das steht im Admin-Auftrag.
- **429 ist vorübergehend, nie ein Ablehnungsgrund:**
  - `pb.js` liefert `code:'limit'` statt `'fehler'`, auch bei innerem 429 im Batch.
  - `server.js` behandelt `limit` wie `netz`: Die Änderung bleibt in `offen`, und der Wiederversuch kommt automatisch mit Backoff (1 s, 2 s, 4 s, höchstens 5 s), ohne `zuruecknehmen`.
  - `planAnlegen` versucht es bei `limit` bis zu 3-mal.
- **Drossel:** Höchstens 2 Batch-Aufrufe je Sekunde (Mindestabstand 450 ms, in `server.js`).
- **Login:** Bei 429 zeigt `login.js` «Zu viele Versuche – bitte kurz warten.»
- **Reset-Mail-Link:** Der Hook `onMailerRecordPasswordResetSend` ersetzt `//login.html` durch `/login.html`.
- **Nachträge aus dem Review von Task 10:**
  - Die Offline-Marke entprellt 3 s und nutzt `visibility` statt `hidden`.
  - Tokens für die Marke in allen Themes, drei Scopes, mit Kontrastprüfung in `tests/run.mjs`.
  - 401 mit offener Warteschlange: `askDialog` statt still verwerfen.
  - Ein Boot-Fehler, der kein Netzfehler ist, zeigt nicht «Offline».

- [ ] **Step 1:** Abschnitt «RATELIMIT» in `verify-pb-regeln.mjs` mit `startePb({rateLimits:true})`:
  - `planAnlegen` mit AMK und mit Klassentreffen gelingt.
  - 6 schnelle `senden` hintereinander kommen alle an, nichts geht verloren.
  - Unit-Tests: `limit` → bleibt in `offen` und wird wiederholt; Drosselabstand.
  - Reset-Link ohne `//`.
  - Rot-Nachweis: ohne die Migration scheitert `planAnlegen` mit AMK.
- [ ] **Step 2–4:** ✗ → umsetzen → grün.
- [ ] **Step 5:** Commit `feat: Rate Limits - 429 als vorübergehend, create-Regel für ganze Pläne`.

### Task 11: Mitglieder- und Superadmin-Verwaltung

**Files:**
- Create: `js/mitglieder.js` (Dialog, rendert nur), Modify: `js/app.js` (Projektmenü «Mitglieder…» `#mitglieder-oeffnen`, «Verwaltung…» `#verwaltung-oeffnen` nur Superadmin), `index.html`, `styles/base.css`, `tests/run.mjs` (`needed`), `sw.js`

**Interfaces:**
- Consumes: `createPb`, `darfMitglieder`.
- Mitglieder: Liste (Name, E-Mail, Rolle, Gewerke als Farbchips), Rolle/Gewerke ändern, entfernen (`askDialog`), «Einladen» (E-Mail, Rolle, Gewerke bei Gewerkeleiter; Antwort `direkt` → Toast «… ist jetzt Mitglied», sonst Link-Feld mit «Kopieren»). Offene Einladungen mit «Zurückziehen».
- Verwaltung (Superadmin): Konten mit Schalter Produktionsleitung, alle Pläne mit Besitzer.

- [ ] **Step 1:** `verify-mehrbenutzer.mjs` «MITGLIEDER»: pl lädt neue Adresse als Gewerkeleiter Licht ein → Link → im zweiten Kontext angenommen → dieser Nutzer verschiebt Licht-Vorgang ok, Ton-Vorgang → Toast «Nur Licht darfst du ändern.» und kein Undo-Eintrag; bearb sieht «Mitglieder…» nicht. «VERWALTUNG»: Superadmin schaltet Produktionsleitung an → Nutzer kann «Neu». Screenshot `mitglieder.png`.
- [ ] **Step 2–4:** ✗ → umsetzen → grün; Screenshot ansehen.
- [ ] **Step 5:** Commit `feat: Mitglieder einladen und verwalten, Superadmin-Verwaltung`.

### Task 12: Bestehende neun Prüfskripte auf lokale PocketBase

**Files:**
- Modify: `tools/plan-fixture.mjs` (`planLaden(ziel, datei)` → startet/benutzt eine PB je Skript, legt Konto «pruefer» (Produktionsleitung) und Plan an, setzt per InitScript `bzp_auth` + `?api=`), `tools/verify-*.mjs` (nur Aufruf/`stop()` in `finally`, URL mit `api`), `tools/ui-helfer.mjs`, `tools/shot-einrichten.mjs`, `print.html`/`js/print.js` falls sie den Plan anders holen
- Modify: `tools/verify-klassentreffen.mjs`/`verify-amk.mjs` (Import über den Server-Weg)

**Interfaces:**
- `planLaden(ziel, datei) → Promise<{ id, pb, stop }>`; Skripte rufen `stop()` im `finally`.

- [ ] **Step 1:** Alle neun bisherigen Skripte (ohne `verify-sync`, das entfällt) + `verify-pb-regeln` + `verify-mehrbenutzer` laufen lassen; Fehler aufnehmen.
- [ ] **Step 2:** Anpassen bis alle elf grün; Screenshots ansehen.
- [ ] **Step 3:** `ps -ef | grep -E "[p]ocketbase|[f]irefox"` leer.
- [ ] **Step 4:** Commit `test: Prüfskripte seeden über lokale PocketBase`.

### Task 13: Auslieferung — Docker/nginx, Admin-Auftrag Phase 2, Doku

**Files:**
- Create: `Dockerfile`, `nginx.conf` (nur ausgelieferte Dateien: `index.html`, `print.html`, `login.html`, `js/`, `styles/`, `sw.js`, `manifest*`, Icons — keine `docs/`, `tools/`, `tests/`, `pocketbase/`), `.dockerignore`, `docs/admin-auftrag-online-phase2.md` (Superuser anlegen, Hook + Migration einspielen per SSH: nach /tmp, sha256, Backup, kopieren, `docker restart`; Settings App-URL je Instanz für Einladungs-/Resetlinks; Rate limiting; Regeln danach mit `tools/verify-pb-regeln.mjs --gegen <url>`-Lesemodus prüfen; Coolify-App für `callboard.nyxlightwork.de` aus Branch `live`; erstes Superadmin-Konto für Marco per `pocketbase/setup.mjs`), `pocketbase/setup.mjs` (legt nur Marcos Superadmin-Konto an, idempotent, Zugang aus `pocketbase/pb-admin.local.json`), `pocketbase/schema.json` (Export der Collections aus der lokalen PB)
- Modify: `README.md`, `CHANGELOG.md` (Abschnitt «Unveröffentlicht»), `CLAUDE.md` (Aufbau-Tabelle, verify-Liste: `verify-sync` raus, `verify-pb-regeln` + `verify-mehrbenutzer` rein = elf; Sync-Regeln ersetzen), `.claude/rules/sync-offline.md` (→ Server/Offline), `docs/entscheidungen.md` (E-1…E-10), Spec-Status «freigegeben»

- [ ] **Step 1:** `docker build` lokal (falls Docker da; sonst `nginx -t` mit der Konfiguration, oder klar sagen, dass ungeprüft) und Dateiliste im Image prüfen: keine `docs/`/`tools/`/`tests/`.
- [ ] **Step 2:** Doku per grep nachziehen (`sync`, `Speicherort`, `verify-sync`, `neun`, `bzp_sync`, `GitHub-Sync`).
- [ ] **Step 3:** Voller Lauf: `node tests/run.mjs` + alle elf verify-Skripte grün; Prozesskontrolle.
- [ ] **Step 4:** Commit `docs: Online-Fassung, Admin-Auftrag Phase 2, Auslieferung`. Push des Branches `online` (Feature-Branch, keine Live-Wirkung).

**Halt danach (Außenwirkung):** Merge nach `main` (= GitHub Pages wird Testseite gegen `api-test`, Sync weg für Marcos Geräte), Version stempeln, Admin-Auftrag Phase 2 übergeben, Push `main:live`. Das braucht Marcos Freigabe und den Superuser vom Admin.
