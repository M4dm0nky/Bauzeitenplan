# PocketBase (Online-Fassung)

Server-Teil des Bauzeitenplans (Branch `online`): PocketBase **0.40.6**.

- `pb_migrations/` — Schema und API-Regeln als JS-Migration (laufen beim Start automatisch).
- `pb_hooks/` — Server-Logik (rev, Rollen, Konten, Einladung).

## Lokal prüfen

```bash
node tools/pb-lokal.mjs            # lädt die Binary nach tools/.pb/ (gitignored), startet, prüft /api/health, beendet → «PB OK»
node tools/verify-pb-regeln.mjs    # Schema und Regeln gegen eine frische lokale PocketBase (--nur SCHEMA)
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
