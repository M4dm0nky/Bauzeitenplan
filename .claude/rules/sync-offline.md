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
- **Ein Konflikt wird nie still aufgelöst:** `askDialog` mit drei Knöpfen, einer «Beide behalten (Kopie)» («… (anderes Gerät)»). Offenes Projekt neuer und lokal nicht `dirty` → ersetzen mit Toast. Gelöscht im Repo → Rückfrage; 404 der Liste ist kein leeres Repo.
- **Zwei Tabs, ein Browser:** app.js-Block «Anderer Tab» (`storage`-Listener, `fremderTab`). Anderer Stand + hier nichts Ungesichertes (`saveTimer`/`store.dirty`/`ungesichert`) → `open(plan)` mit Toast; sonst Dreiknopf-Dialog (`askDialog`, höchstens einer, Folgeereignisse = eine erneute Prüfung). «Die aus dem anderen Tab nehmen»/«Beide» laden den Stand NACH dem Dialog frisch (`repo.load`), nie den Schnappschuss vom Dialogbeginn. Im anderen Tab gelöscht → `verworfen`, Projektdialog. Nicht `ueberschreibenSicher` nehmen: dessen `dirty` heißt «nicht hochgeladen» und steht nach jedem fremden Speichern. Prüfung: `verify-sync.mjs` «ZWEI TABS».
- **Mitgelieferter Plan (`openBundled`, `bundledKey`):** `quelle.hash` (`planHash`/`unveraendert`, sync.js) merkt den Inhalt beim Laden der Datei bzw. bei «Meine behalten» (Hash des LOKALEN Plans). «Unverändert seit dem Laden» oder inhaltsgleich zur neuen Datei → neuer Stand ersetzt still (auch ohne `still`); ohne Hash (Altbestand) gilt nur die Inhaltsgleichheit. Sonst am Live-Monitor (`bzp_live=1`, auch `?plan=<key>`) nie ein Dialog, `{still:true}`: lokal behalten, kein Stempel, Toast; außerhalb Live der Dialog «Zwei Fassungen». Die Projektzeile im Startdialog geht für Projekte aus `BUNDLED` ebenfalls durch `openBundled`. Prüfung: `verify-live.mjs`, `verify-klassentreffen.mjs`.
- **Hochladen gebündelt:** frühestens 10 s nach dem Speichern, sofort bei `visibilitychange → hidden` und Projektwechsel; höchstens EIN Nachlauf.
- **Kein Netz/falscher Schlüssel bricht den Start nie** (`#sync-state` gelb/rot).
- **Prüfen:** `tools/verify-sync.mjs` (gefälschte API); `--echt` mit `BZP_TOKEN`.
