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
