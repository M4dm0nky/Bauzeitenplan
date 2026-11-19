---
paths:
  - "js/sync.js"
  - "js/persistence.js"
  - "sw.js"
  - "tools/verify-sync.mjs"
---

# Sync und Offline

Local-first: Plan in `localStorage`; privates Repo `M4dm0nky/Bauzeitenplan-Daten` (`main`, `projekte/<project.id>.json` = `serialize(plan)`) gleicht nur ab. **Ohne Schlüssel verhält sich die App wie vorher.**

- **Schlüssel nur in `localStorage` `bzp_sync`** (`{token, repo}`), nie in Plan/Export/Repo (`tests/run.mjs` sperrt es). `remoteSha`/`dirty` im Index `bzp_projects`, nie im Plan.
- **`js/sync.js` DOM-frei**, `fetch` hereingereicht (`createSync`); `abgleich()` entscheidet, app.js führt aus. **GitHub-Abrufe mit `cache:'no-store'`; Base64 über `TextEncoder`**, nie `btoa`.
- **Ein Konflikt wird nie still aufgelöst:** `askDialog` mit drei Knöpfen, einer «Beide behalten (Kopie)» («… (anderes Gerät)»). Offenes Projekt neuer und lokal nicht `dirty` → ersetzen mit Toast. Gelöscht vs. `dirty` → behalten, neu hochladen.
- **Hochladen gebündelt:** frühestens 10 s nach dem Speichern, sofort bei `visibilitychange → hidden` und Projektwechsel; höchstens EIN Nachlauf.
- **Kein Netz/falscher Schlüssel bricht den Start nie** (`#sync-state` gelb/rot).
- **Prüfen:** `tools/verify-sync.mjs` (gefälschte API); `--echt` mit `BZP_TOKEN`.
