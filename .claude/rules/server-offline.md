---
paths:
  - "js/server.js"
  - "js/konflikt.js"
  - "js/pb.js"
  - "js/persistence.js"
  - "sw.js"
  - "Dockerfile"
  - "nginx.conf"
  - "pocketbase/**"
---

# Server, Senden und Offline

Der Plan lebt auf PocketBase (`pb.js` Client, `server.js` lesen/senden/Realtime). `localStorage` hält nur das Token (`bzp_auth`) und die **lokale Kopie** (`repo.save`, ohne Token): `print.html` liest sie, also **vorher die App öffnen**. Der GitHub-Sync ist entfernt (kein `js/sync.js`, kein `bzp_sync` in `js/`; `tests/run.mjs` sperrt beides).

- **Kein lokaler Modus:** ohne Anmeldung `login.html` (`?api=` weiterreichen). `pb.on('abgemeldet')` ist der einzige Weg dorthin (`zuLogin`); `abmelden()` meldet selbst, nicht doppelt auslösen. Ausnahme: der Live-Monitor (`bzp_live=1`) mit lokaler Kopie zeigt sie bei abgelaufener Anmeldung weiter (`zeigeKopie('abgemeldet')`), nie `login.html`. `login.js` leitet bei vorhandenem Token nie zurück (keine Schleife). **Manuelles Abmelden löscht die lokalen Kopien** (geteilter Rechner), `401` lässt sie stehen.
- **Senden:** `store.subscribe((s, info))`: `quelle` lokal/undo/redo → `sende(info.aend)` → `server.senden`; remote/replace nie. Alles mit Netz oder Rückfrage läuft hintereinander durch `reihe`. Anzeige `#sync-state` (einziger Schreiber `paintSpeicher`): ✓ gesendet · ⟳ sendet… · ⚠ offen (n).
- **Rate Limits (429) sind vorübergehend** (`pb.js` `code:'limit'`, auch als inneres 429 eines Batches): `server.js` lässt die Änderung in `offen` und wiederholt mit Backoff 1/2/4/max 5 s (`BACKOFF_MS`), nie `zuruecknehmen`, nie `setNurAnsicht('offline')`. Nach `LIMIT_VERSUCHE` = 4 gibt `leeren` die Reihe frei (`{ok:false, limit:true}`, «offen (n)»), `app.js` `planeLimitWieder` versucht es nach 15 s erneut. Batch-Aufrufe laufen durch `batchDrosselt` (450 ms Abstand); `planAnlegen` versucht es 3-mal. Ein Plan = EIN Batch bis 2000 Anfragen, mehr wird abgelehnt statt geteilt. Die Migration `1700000003_ratelimits.js` hebt NUR `*:create` auf 2000 je 5 s (`docs/entscheidungen.md`).
- **Abgelaufene Anmeldung (401) mit ungesendeten Änderungen:** `zuLogin('401')` fragt per `askDialog` («Neu anmelden (Änderungen gehen verloren)» / «Kopie ansehen» → `zeigeKopie('abgemeldet')`), nie still verwerfen.
- **Marke «Offline» entprellt:** erscheint erst nach 3 s (`MARKE_MS`), bis dahin `visibility:hidden` (`data-an="0"`, Platz reserviert); Tokens `--nur-bg`/`--nur-t` je Theme (Kontrast in `tests/run.mjs`).
- **Boot-Fehler:** nur ein Netzfehler (`offline`) zeigt die lokale Kopie «Offline»; jeder andere Ladefehler geht in den Projektdialog bzw. die Fehlermeldung.
- **Konflikt (`loeseKonflikt`, Logik DOM-frei in `js/konflikt.js`):** geändert → «Ihre Fassung nehmen» / «Meine behalten»; gelöscht → «Wiederherstellen» / «Verwerfen»; `unbekannt` (Lesefehler) ist KEINE Löschung. Abbrechen lässt den Konflikt offen (`geparkt`, Klick auf den Speicherstand). Der Server kennt keinen Bearbeiter je Datensatz: der Dialog sagt «jemand anderem».
- **Undo-Konflikt:** `store.undo()` liefert `{ok:false, konflikt}` → «Trotzdem zurücknehmen?» → `undo({erzwingen:true})` (`macheUndo`).
- **Fremdänderungen** nur über `store.applyRemote` (gebündelt), kein Toast je Änderung. Nach Wiederverbinden: senden, `laden()`, `applyRemote` (Undo bleibt). Token alle 6 h erneuern (`neuAbonnieren()`).
- **Nur Ansicht:** `setNurAnsicht(grund)` (app.js) ist der EINZIGE Schreiber von `body.nur-ansicht` und `#hd-offline` («📡 Offline – nur Ansicht» · «👁 Nur ansehen» · «🔑 Anmeldung abgelaufen – lokale Kopie»); Grund kommt aus `nurAnsichtGrund()` (Kopiemodus, `offline`, Rolle Betrachter). Der Store bleibt über `opt.gesperrt` gesperrt; `nur-ansicht` sperrt zusätzlich Ziehen (`gantt.js`), Felder in `#ins/#tb/#ein-seite/#bd` (`felderSperren`), Kontextmenü, Neu/Import. Jetzt-Linie und Live-Ansicht laufen weiter (Uhr, nicht Server).
- **Offline erkannt** über Realtime `getrennt`, `code:'netz'` beim Senden oder `window` `offline`; Wiederverbinden (`versucheWieder`, alle 5 s und bei `online`): Token erneuern, `neuAbonnieren()`, Warteschlange senden (Konflikt → Dialog), `laden()`, Marke weg.
- **Start ohne Netz (Live-Monitor):** `boot()` öffnet bei `bzp_live=1` das aktive Projekt ohne Dialog; scheitert das am Netz, zeigt `zeigeKopie('offline')` die lokale Kopie (`repo.load`) und versucht es alle 15 s erneut (`kopieWieder`).
- **Neu/Vorlage/Import:** `planNeu` → `planAnlegen` (neue plan_id), nur mit `darfPlanAnlegen`. Löschen nur Besitzer/Superadmin.
- **Kein mitgelieferter Plan:** die App holt nie eine Plan-JSON (kein `BUNDLED`/`openBundled`, kein `fetch` einer `.json` in `js/`; Sperre in `tests/run.mjs`). Testdaten liegen in `tools/fixtures/`, die Prüfskripte legen sie über die lokale PocketBase an.
- **Mitglieder/Verwaltung** (`js/mitglieder.js`, Logik `mitglieder-logik.js`): `#mitglieder-oeffnen` nur bei `darfMitglieder(rolle)`, `#verwaltung-oeffnen` nur für `user.superadmin`. Änderungen gehen direkt über `pb` (kein Store, kein Undo), der Dialog lädt danach neu (Realtime kennt nur Plan-Collections); beim Schließen mit Änderung `nachladen()`, eigenes Entfernen öffnet den Projektdialog. Der Einladungslink wird nur angezeigt, nie gespeichert. Der Hook sperrt kein Entfernen; der Besitzer ist kein Mitglied, Besitzer ändern gibt es nicht in der UI.
- **Prüfen:** `node tools/verify-mehrbenutzer.mjs` (lokale PocketBase, zwei Browserkontexte).
- **Auslieferung:** Test = GitHub Pages (`main`), Live = Coolify aus `live` mit `Dockerfile` (nginx, Allowlist-`COPY`; `tests/run.mjs` prüft Image gegen `HUELLE`, `nginx.conf` s. dort). Hostname wählt die API (`pb.js`). Server-Teil spielt nur der Admin ein (`docs/admin-auftrag-online-phase2.md`), danach `verify-pb-regeln.mjs --gegen <url>` (Lesemodus, schreibt nie). Superadmin-Konto: `pocketbase/setup.mjs` (Zugang aus `pb-admin.local.json`, gitignored). `schema.json`: `node tools/pb-schema-export.mjs [--pruefen]`. **`verify-browser.mjs --base` prüft nur Anmeldeseite und Weiterleitung** (ohne Konto kein Plan).
