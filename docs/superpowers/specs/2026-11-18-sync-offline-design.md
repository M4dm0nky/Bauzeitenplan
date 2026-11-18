# Pläne überall verfügbar: GitHub-Sync + Offline

## Context
Ein auf Rechner A angelegtes Projekt fehlt auf Rechner B, weil Projekte nur im
`localStorage` des jeweiligen Browsers liegen. Ziel: **Jedes Projekt ist auf jedem
Gerät da, auf dem der Nutzer angemeldet ist.** Export/Import der JSON bleibt
(Weitergeben an andere), und die App läuft **offline**, auch beim Empfänger einer
JSON-Datei.

Entscheidungen des Nutzers:
- Offline = **Webseite läuft nach dem ersten Besuch ohne Netz**, weitergegeben wird die JSON (kein Einzeldatei-HTML).
- Pläne liegen in einem **zweiten, privaten Repo**, nicht im öffentlichen App-Repo.

## Ansatz: local-first, GitHub als Abgleich
`localStorage` bleibt der Arbeitsspeicher (schnell, offline). GitHub ist ein
zusätzlicher Abgleich: eine Datei je Projekt. Ohne GitHub-Schlüssel verhält sich die App
genau wie heute. Das betrifft auch Empfänger einer JSON.

### 1. Daten-Repo (einmalig)
- Privates Repo `M4dm0nky/Bauzeitenplan-Daten` per `gh repo create --private` anlegen. Wirkt nach außen, ist aber mit der Planfreigabe genehmigt.
- Ablage: `projekte/<project.id>.json`, Inhalt = `serialize(plan)`. Damit ist jede Datei zugleich eine gültige Export-Datei.
- **Nutzer-Aufgabe (vorher angesagt):** auf github.com einen *fine-grained token* nur für dieses Repo anlegen (Contents: Read & Write) und je Gerät einmal in der App eintragen. Der Schlüssel liegt nur im `localStorage` des Geräts, nie im Repo und nie im Export.

### 2. Neues Modul `js/sync.js` (DOM-frei, testbar)
- `createSync({ fetch, token, repo, branch })` mit `list()`, `pull(id)`, `push(plan, sha)` und `remove(id, sha)` über die GitHub-Contents-API (`GET/PUT/DELETE /repos/{repo}/contents/projekte/{id}.json`, Base64 UTF-8-sicher).
- **Konflikterkennung über `sha`:** Jeder Push schickt die zuletzt bekannte `sha` mit. Bei HTTP 409/422 („jemand anders hat inzwischen gespeichert") wird nichts überschrieben.
- `fetch` wird hereingereicht. Das ist dasselbe Muster wie `createRepo(storage)`, und so bleibt das Modul ohne Netz testbar.

### 3. Anbindung in `js/persistence.js` / `js/app.js`
- Der Index in `createRepo` merkt sich je Projekt `remoteSha` und `dirty` (lokal geändert, noch nicht hochgeladen).
- **Speichern:** wie heute lokal nach 800 ms. Der Upload läuft **gebündelt** (z. B. 10 s nach der letzten Änderung, sofort bei `visibilitychange`/Projektwechsel), sonst entstünde alle 800 ms ein Commit.
- **Start/Online-Wechsel (`boot()`, `online`-Event):** `list()` holen. Projekte, die nur entfernt liegen, werden heruntergeladen. Ist die entfernte Fassung neuer und lokal nichts `dirty`, wird sie übernommen. `dirty`-Projekte werden hochgeladen.
- **Konflikt** (beide Seiten geändert): `askDialog` (kein natives Popup) mit den Knöpfen *Meine behalten*, *Die vom anderen Gerät nehmen* und *Beide behalten (Kopie)*. **Meine Entscheidung:** nie stillschweigend „der Neuere gewinnt", denn bei Offline-Arbeit auf zwei Geräten verlöre man sonst Arbeit ohne Hinweis.
- **Löschen:** Löschen eines Projekts löscht auch die Datei im Repo. Vorher kommt eine Rückfrage, die sagt „auf allen Geräten".
- Der Autostart (`openBundled`, `quelle.exported`) bleibt unverändert.
- Neue Felder laufen nicht über `addTask`. Sync-Metadaten liegen im Index, **nicht** im Plan, also auch nicht im Export.

### 4. Bedienung
- Im Einrichten-Fenster kommt ein neuer Reiter **„Speicherort"** (`data-ein="sync"`) dazu. Er enthält ein Feld für den Schlüssel, die Knöpfe *Verbinden* und *Trennen* sowie den Zustand: verbunden, letzter Abgleich, Zahl der offenen Uploads.
- In der Kopfzeile steht ein kleines Statussymbol mit Farbe (grün = abgeglichen, gelb = wartet/offline, rot = Fehler/Konflikt). Es ist nur sichtbar, wenn ein Schlüssel eingetragen ist. Ein neuer Baustein kommt in die `needed`-Liste in `tests/run.mjs`, mit allen fünf Themes.
- Export/Import bleiben unverändert. Ein importiertes Projekt wird bei aktivem Sync wie ein neues hochgeladen.

### 5. Offline (`sw.js`)
- Heute cacht `sw.js` bewusst nichts. Neu ist **network-first mit Cache als Rückfall**: Online wird wie bisher immer frisch geholt und dabei die Antwort in den Cache gelegt. Nur bei Netzfehler wird aus dem Cache bedient. Die Zusage „sperrt nie eine alte Version ein" gilt damit weiter, solange Netz da ist.
- Der Cache wird pro `SW_VERSION` benannt, alte Caches werden in `activate` gelöscht, der Kill-Switch bleibt.
- Beim Installieren wird die App-Hülle vorgeladen: `index.html`, `print.html`, alle `js/*`, `styles/*`, Fonts und die Autostart-JSON. Die Liste wird generiert bzw. von `tools/version.mjs` mitgepflegt, damit nichts vergessen wird. Ein Test prüft, dass jede ausgelieferte Datei in der Liste steht.
- `api.github.com` fasst der SW nicht an (fremde Origin, wie bisher).
- Die Kommentare in `sw.js` und die CLAUDE.md-Regel zum SW werden angepasst.

## Kritische Dateien
`js/sync.js` (neu) · `js/persistence.js` (`createRepo`, Index-Felder) · `js/app.js`
(`boot`, Speichern um Z. 849, Projektliste/Löschen um Z. 947–1003, Modulebene für den
Einrichten-Reiter) · `index.html` (Reiter Z. 224 ff.) · `sw.js` · `styles/themes/*` ·
`tools/build-prototypes.mjs` (nur falls gantt.js etwas Neues importiert, sonst nicht) ·
`tools/version.mjs` · `tests/run.mjs` · CLAUDE.md/CHANGELOG.

## Prüfung
- **Unit** `tests/sync.test.mjs`: ein Fake-`fetch` mit echten GitHub-Antwortformen (`sha`, `content` Base64, 409/422, 404). Geprüft werden Erstabgleich, nur-entfernt → Download, dirty → Upload, Konflikt → kein Überschreiben und Umlaute in Base64. Je ein Rot-Nachweis per absichtlich eingebautem Fehler (z. B. `sha` weglassen ⇒ Konflikttest schlägt an).
- **Browser** `tools/verify-sync.mjs` (neu, als 9. Werkzeug in CLAUDE.md): Playwright mit zwei Browser-Kontexten (= zwei Rechner) gegen einen per `route()` simulierten GitHub. Gerät A legt ein Projekt an, Gerät B sieht es. Beide ändern offline, danach erscheint der Konfliktdialog. Zusätzlich läuft `context.setOffline(true)` nach dem ersten Laden: die App startet neu und ist bedienbar. Screenshots werden angesehen.
- **Echter Durchlauf** gegen das private Repo mit dem Schlüssel des Nutzers: ein Projekt in Firefox anlegen und in einem zweiten Profil öffnen.
- Alle acht bestehenden `verify-*` und `tests/run.mjs` müssen grün sein. Die Prüfwerkzeuge laufen ohne Schlüssel, also ändert sich ihr Verhalten nicht.
- **Deploy:** Die Versionsnummer frage ich vorher bei Marco ab, dann `node tools/version.mjs`, Push und `verify-browser --base` live. Ein Tag wird erst nach Rückfrage gesetzt.

## Ablauf
Design-Doc nach `docs/superpowers/specs/2026-11-18-sync-offline-design.md`, dann
`superpowers:writing-plans`, Umsetzung per Subagenten (Sonnet) auf Feature-Branch
`sync-offline`.
