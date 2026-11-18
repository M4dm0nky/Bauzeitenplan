# Übergabe: Bauzeitenplan online mit Benutzerverwaltung — weiter auf dem Mac

Stand 2026-11-18, geschrieben auf dem Windows-Rechner. Wer diese Datei auf dem Mac
liest (Claude Code): erst ganz lesen, dann bei «Erste Schritte auf dem Mac» anfangen.

## Warum

Marco gibt Fremden den Link zur App. Sie sollen unter «Projekt» die gemeinsamen
Pläne sehen **und bearbeiten**, ohne irgendwo einen Token einzutragen. Der
GitHub-Sync aus v0.13.0 (Token je Browser) erfüllt das nicht. Deshalb: Online mit
Benutzerverwaltung (PocketBase), wie beim Crewplaner, aber getrennt davon.

## Feststehende Entscheidungen (von Marco)

- **PocketBase auf dem eigenen Hetzner-Server, als EIGENES Coolify-Projekt.**
  Nichts mit Crewplaner mischen: eigener Dienst, eigenes Volume, eigene
  Superuser, eigene Regeln, eigene Domain.
- **Die Webseite bleibt auf GitHub Pages** (`https://m4dm0nky.github.io/Bauzeitenplan/`).
  Folge: CORS in PocketBase/Traefik muss genau diese Origin erlauben (`https://m4dm0nky.github.io`).
- **Fremde dürfen bearbeiten** (nicht nur ansehen). Deshalb Konten und Rollen.
- Versionsnummern entscheidet Marco, vor dem Stempeln fragen (siehe CLAUDE.md).

## Stand des Codes

- `main` = v0.13.0, live. Enthält GitHub-Sync (Reiter «Speicherort») + Offline per
  Service Worker. Ohne Token verhält sich die App wie vorher. Der Sync wird nach dem
  Umzug auf PocketBase voraussichtlich wieder ausgebaut. Daten-Repo
  `M4dm0nky/Bauzeitenplan-Daten` (privat) ist leer bis auf die README.
- Branch **`pocketbase-vorbereitung`** (Stand ~v0.7, NICHT gemergt) enthält ein fertiges Gerüst:
  - `pocketbase/setup.mjs`: legt `projects`, `gewerke`, `tasks`, `deps`, `memberships`, `lead_scopes` an,
    Bezüge als **Text**, nie Relation. Env: `PB_URL`, `PB_ADMIN`, `PB_PW`.
    ⚠️ **Löscht vor dem Neuaufbau alle eigenen Collections und Testnutzer. Nie gegen eine Instanz mit echten Daten laufen lassen.**
  - `pocketbase/pb_schema.json`, `pocketbase/pb_hooks/main.pb.js` (verhindert, dass ein Lead Vorgänge in fremde Gewerke schiebt).
  - Rollen `admin`/Owner und `lead` (Gewerkeleiter: nur Zeiten, Status, Notizen in eigenen Gewerken). `js/roles.js` sperrt die UI in inspector.js und table.js, gantt.js hat noch KEINE Sperre.
  - `login.html`, `admin.html` + `js/admin.js` (Einladen, Rollen, Gewerk-Scopes), `js/auth.js`, `js/pb.js` (fetch-Wrapper ohne SDK), `js/session.js`, `js/persistence-pb.js`
    (gleiche Schnittstelle wie `persistence.js`, speichert je Record und schreibt nur Geändertes). Aktiv nur mit `?backend=pb`.
  - Bekannte Lücken: Die Registrierung setzt `verified=true` ohne Mailbestätigung, und wer sich zuerst mit einer eingeladenen Adresse registriert, übernimmt die Einladung. Kein Realtime, keine Migration lokaler Pläne, keine Einladungsmail.
    Es fehlt alles ab v0.8: Showablauf/Bühnen, Abschnitte, Arten, Ressourcen (`res`, `project.ressourcen`), Bereitstellung, Soundcheck (`fuer`).
  - Tests: `tests/roles.test.mjs`, `tests/pb-rules.test.mjs` (läuft nur gegen laufende PB), `tests/client-auth.test.mjs`.

## Vorbild Crewplaner (nur als Muster, nichts teilen)

Repo `~/…/github/Crewplaner`, siehe dort `CLAUDE.md`, `docs/database-schema.md`, `docs/security.md`, `docs/admin-runbook-*.md`.

- **Server:** Hetzner, SSH-Alias **`hetzner`** (liegt auf dem Mac, NICHT auf dem Windows-Rechner). Coolify mit Traefik. PB-Image `ghcr.io/coollabsio/pocketbase`, PocketBase v0.38.
- **Umgebungen:** Test-PB und Live-PB getrennt (`api-test.crewplanner…` / `api.crewplanner…`).
- **Regeln:** Den Soll-Stand hält ein Skript fest (`tools/check-pb-rules.mjs`, liest nur, schreibt mit `--fix`).
  **Falle:** Ein Coolify-Redeploy oder Schema-Reimport setzt die Regeln auf `auth != ""` zurück. Danach immer prüfen.
- **Hooks:** Datei `main.pb.js` im Volume, per SSH eingespielt: erst nach /tmp, Version und sha256 prüfen, Backup, kopieren, `docker restart`.
- **Traefik:** Override `/data/coolify/proxy/dynamic/pocketbase-fix.yaml` (Router-Priorität wegen des Coolify-«strip-api»-Bugs, plus CORS).
  CORS liegt zusätzlich als Positivliste im Hook. Für Bauzeitenplan eine EIGENE Datei anlegen, die Crewplaner-Datei nicht anfassen.
- **Konten:** kein offenes Self-Signup. `users.createRule` verlangt, dass die E-Mail vorher eingeladen wurde; der Vergleich läuft kleingeschrieben im Hook.
  Konto entsteht beim ersten Login über den Einladungslink. Rollen im Feld `users.role`; `users.updateRule` darf nur superadmin, damit niemand seine eigene Rolle hochsetzt.
- **Mail:** Resend-HTTP-API aus dem Hook, Schlüssel nur als Coolify-Variable `RESEND_KEY`.
- **Geheimnisse:** PB-Superuser in einer lokalen, ignorierten JSON-Datei (Muster `PB_CRED`), nie im Repo. Server-Kennungen in `.claude.local.md` (gitignored).
- PB-Eigenheiten: Eine Filterregel liefert 200 mit leerer Liste statt 403, maßgeblich ist `totalItems`. `sort=-created` scheitert, wenn die Collection kein `created` hat.
  Im Hook gilt: Top-Level-Deklarationen sind in Handlern unsichtbar, und es heißt `original()`, nicht `originalCopy()`.

## Offene Fragen an Marco (vor dem Design klären, gebündelt)

Bei jeder steht ein Vorschlag. «wie vorgeschlagen» reicht als Antwort.

**A. Server**
3. PB-Adresse: Vorschlag `api.bauzeitenplan.nyxlightwork.de` (bzw. `api-test.bauzeitenplan…`).
4. Test- und Live-PB getrennt wie beim Crewplaner? Vorschlag: ja.
5. Zugriff für Claude: SSH-Alias `hetzner` auf dem Mac nutzen, oder lieber einen Coolify-API-Token
   (Coolify → Keys & Tokens → API Tokens; in eine lokale ignorierte Datei, nie in den Chat)?
6. Wer verwaltet das DNS von nyxlightwork.de, und wer legt den Eintrag an?

**B. Benutzer und Rollen**
7. Rollen, Vorschlag: Superadmin (Marco) · Benutzerverwalter (einladen, Rollen und Projektzugang
   vergeben, keine Superadmins) · Planer (eigene Projekte komplett) · Gewerkeleiter (nur Zeiten und Status in eigenen Gewerken) · Betrachter (lesen).
8. Sieht jeder Angemeldete nur die Projekte, zu denen er eingeladen ist? Vorschlag: ja.
9. Konten nur per Einladung (Mail mit Link, Passwort selbst setzen)? Vorschlag: ja.
10. Mail über Resend, eigener Absender (z. B. `noreply@bauzeitenplan.nyxlightwork.de`)? Ist die Domain bei Resend bestätigt?
11. «Passwort vergessen» per Mail? Vorschlag: ja.
12. Wer wird Benutzerverwalter (Name, E-Mail)? Die Adressen nur in einer lokalen, ignorierten Datei ablegen.
13. Zusätzlich ein Nur-Lese-Link ohne Login je Projekt (wie `view_token` im Crewplaner)? Vorschlag: ja, abschaltbar.

**C. Pläne**
14. Gleichzeitiges Bearbeiten: (a) Änderungen anderer erscheinen live (PB-Realtime), Vorschlag. (b) Prüfung erst beim Speichern, mit Konfliktdialog.
15. Offline weiterarbeiten und später abgleichen? Vorschlag: ja.
16. Welche Pläne ziehen mit um (Klassentreffen, AMK, lokale)? Bleibt die App ohne Login als lokales Werkzeug nutzbar?
17. Tägliches automatisches PB-Backup auf dem Server? Vorschlag: ja.

**D. Rahmen**
18. Datenschutzerklärung und Impressum: Sobald Fremde sich mit E-Mail anmelden, sind sie Pflicht. Gleiche Texte wie beim Crewplaner oder eigene? (Bauen ja, Rechtsprüfung nein.)
19. Termin: Bis wann müssen Fremde den Link nutzen können?

## Erste Schritte auf dem Mac

1. `cd` ins Repo, `git fetch && git checkout online-pocketbase && git pull`. Diese Datei liegt auf diesem Branch.
2. Superpowers wie immer: `superpowers:brainstorming` ist schon gestartet, die Fragen oben sind Schritt 3 davon.
   Nach Marcos Antworten: Ansätze und Design vorstellen, Spec nach `docs/superpowers/specs/`, dann `writing-plans`.
3. Zugang prüfen, NUR lesend, nichts ändern: `ssh hetzner 'docker ps --format "{{.Names}}"'`. Coolify-URL und
   Projektliste ansehen. Bestehende Crewplaner-Dienste nicht anfassen.
4. Erst nach freigegebenem Plan: Test-PB als eigenes Coolify-Projekt anlegen, Superuser in eine lokale,
   ignorierte Datei (z. B. `pocketbase/pb-admin.local.json`, Eintrag in `.gitignore` VOR dem ersten Anlegen).
   `setup.mjs` nur gegen die frische, leere Test-Instanz.
5. Live erst nach Marcos ausdrücklicher Freigabe.

## Hinweise zur Umgebung

- Die `tools/verify-*.mjs` finden Firefox und Chromium seit v0.13.0 über `tools/browsers.mjs` (Mac, Windows, Linux).
  Auf dem Mac gegebenenfalls `node node_modules/playwright-core/cli.js install firefox chromium`.
- Der Testserver der Werkzeuge vergleicht die Startseite trennzeichenunabhängig. Früher stürzte er unter Windows mit EISDIR ab.
- Gestartete Server und Browser am Ende wieder beenden (globale Regel).
