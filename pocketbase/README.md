# PocketBase (Online-Fassung)

Server-Teil des Bauzeitenplans (Branch `online`): PocketBase **0.40.6**.

- `pb_migrations/` — Schema und API-Regeln als JS-Migration (laufen beim Start automatisch): `1700000001_schema`, `…02_reset_mail`, `…03_ratelimits`, `…04_plan_loeschen`, `…05_mailvorlagen` (deutsche Konto-Mails, Link `login.html?verify=`, kein `/_/`).
- `pb_hooks/` — Server-Logik (rev, Rollen, Konten, Einladung, Konto-Mails ohne `//` im Link).
- `setup.mjs` — erstes Superadmin-Konto der App anlegen (macht Marco selbst, idempotent, `--trocken` schreibt nichts). Zugang aus `pocketbase/pb-admin.local.json` (gitignored) oder Umgebungsvariablen, nie im Repo.
- `schema.json` — lesbare Momentaufnahme der Collections nach allen Migrationen (`node tools/pb-schema-export.mjs`, `--pruefen` vergleicht). Maßgeblich bleiben die Migrationen; Rate Limits und Einstellungen sind darin nicht enthalten.
- Einspielen auf Test/Live (nur Admin): `docs/admin-auftrag-online-phase2.md`.

## Lokal prüfen

```bash
node tools/pb-lokal.mjs            # lädt die Binary nach tools/.pb/ (gitignored), startet, prüft /api/health, beendet → «PB OK»
node tools/verify-pb-regeln.mjs    # Schema und Regeln gegen eine frische lokale PocketBase (--nur SCHEMA)
node tools/verify-pb-regeln.mjs --gegen <url>   # Lesemodus gegen eine laufende Instanz (schreibt nie; PB_SU_TOKEN = Superuser-Token für Einstellungen)
```

`tools/pb-lokal.mjs` startet die Binary headless auf freiem Port mit leerem Datenordner (tmp),
legt einen Superuser mit Zufallspasswort an und räumt beim Beenden auf. Zugangsdaten stehen nie im Repo.

## Hook (`pb_hooks/main.pb.js`, Hilfen in `hilfen.js`)

Regeln (Migration) sind die erste Schranke und laufen VOR dem Hook; der Hook prüft das Feine:
`rev` (409 bei Konflikt, Create = 1, Delete verlangt `?rev=`), Besitzer, Gewerkeleiter, Bedarfsstatus,
Konsistenz (Gewerk/Verknüpfung), Konten (Flags/E-Mail), Einladung (`einladungen`-Create und
`POST /api/bzp/einladung`). Superuser-Zugriffe (Wartung) sind vom Hook ausgenommen.

**Fehler suchen:** Laufzeitfehler der Hooks stehen NICHT im Prozess-Log, sondern in der Tabelle `_logs`
der Datei `pb_data/auxiliary.db` (oder im Admin unter Logs). Lokal beim Prüfen: `--hooksWatch=false`
(sonst startet PocketBase bei jeder Dateiberührung, auch durch Dropbox, neu).
