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

Der Plan lebt auf PocketBase. `localStorage` hält nur das Token (`bzp_auth`) und die **lokale Kopie** (`repo.save`, ohne Token): `print.html` liest sie, also **vorher die App öffnen**. Kein GitHub-Sync (`tests/run.mjs` sperrt `js/sync.js`, `bzp_sync`).

- **Kein lokaler Modus:** ohne Anmeldung `login.html` (`?api=`). `pb.on('abgemeldet')` ist der einzige Weg dorthin (`zuLogin`); `abmelden()` meldet selbst, nicht doppelt auslösen. Ausnahme: der Live-Monitor (`bzp_live=1`) mit lokaler Kopie zeigt sie bei abgelaufener Anmeldung weiter (`zeigeKopie('abgemeldet')`), nie `login.html`. **Manuelles Abmelden löscht nur Kopien von Server-Plänen** (Index-Marke `server:true`, gesetzt von `repo.save(…, {server:true})`; `listServer`/`listAlt`), `401` lässt sie stehen. **Alte lokale Pläne** (aus der Fassung ohne Server, ohne Marke) bleiben und erscheinen im Projektdialog (`#alt-plaene`): «Auf den Server übernehmen» = `deserialize` → `planNeu` (neue plan_id), erst nach Erfolg `repo.remove`; «Exportieren». Offline-Kopie und Monitor (`kopieId`) nehmen nur Server-Kopien. Ein zweiter Tab folgt (`storage` → `pb.speicherGeaendert`).
- **Senden:** `store.subscribe((s, info))`: `quelle` lokal/undo/redo → `sende(info.aend)` → `server.senden`; remote/replace nie. Alles mit Netz oder Rückfrage läuft hintereinander durch `reihe`. `#sync-state` (Schreiber `paintSpeicher`): ✓ gesendet · ⟳ sendet… · ⚠ offen (n).
- **Vorübergehend** (`istVoruebergehend`, server.js; Netz = `offline`): gilt für Senden, `laden()`, `sitzung()`. Die Änderung bleibt in `offen`, Backoff 1/2/4/max 5 s (`BACKOFF_MS`), nie `zuruecknehmen`, nie `setNurAnsicht('offline')`. Nach `LIMIT_VERSUCHE` = 4 gibt `leeren` frei (`{ok:false, limit:true}`, «offen (n)»), `planeLimitWieder` nach 15 s erneut, nach 10 Runden fragt `frageAnhaltend` (Weiter versuchen / Neu laden); ein Ladefehler (`ladeStand`) plant sich neu (`ladeBackoff` bis 30 s, Jitter). `batchDrosselt` 450 ms; `planAnlegen` 3-mal. Ein Plan = EIN Batch bis 2000 Anfragen (Migration `1700000003`).
- **Abgelaufene Anmeldung (401) mit ungesendeten Änderungen:** `zuLogin('401')` fragt per `askDialog` («Neu anmelden (Änderungen gehen verloren)» / «Kopie ansehen» → `zeigeKopie('abgemeldet')`), nie still verwerfen.
- **Marke «Offline» entprellt:** erscheint erst nach 3 s (`MARKE_MS`, bis dahin `visibility:hidden`);
- **Konflikt (`loeseKonflikt`, Logik DOM-frei in `js/konflikt.js`):** geändert → «Ihre Fassung nehmen» / «Meine behalten»; gelöscht → «Wiederherstellen» / «Verwerfen»; `unbekannt` (Lesefehler) ist KEINE Löschung. Abbrechen lässt den Konflikt offen (`geparkt`, Klick auf den Speicherstand). Reine Hüllenänderung an einem Sammelvorgang (anderes Kind geändert, `huellenKonflikte`) ist kein Konflikt: fremder Stand gilt, kein Dialog.
- **Undo-Konflikt:** `store.undo()` liefert `{ok:false, konflikt}` → «Trotzdem zurücknehmen?» → `undo({erzwingen:true})` (`macheUndo`). Ohne Leitungsrecht fehlt der Bedarfsstatus im Ziel der Umkehrung (`undoOhneStatus`), nur wo `statusGeaendert` (rechte.js) sie ablehnen würde; Toast nur dann.
- **Fremdänderungen** nur über `store.applyRemote` (gebündelt). Die **Basis-rev** einer eigenen Änderung steht beim Senden fest (`senden` reiht sofort ein); eine gehörte rev wird erst mit `srv.uebernommen` (aus `fremdAnwenden`) zur Basis, `laden(halten)` behält sie für offene Datensätze. Nach Wiederverbinden: senden, `laden()`, `applyRemote`. Token alle 6 h erneuern.
- **Nur Ansicht:** `setNurAnsicht(grund)` (app.js) ist der EINZIGE Schreiber von `body.nur-ansicht` und `#hd-offline` («📡 Offline – nur Ansicht» · «👁 Nur ansehen» · «🔑 Anmeldung abgelaufen – lokale Kopie»); Grund: `nurAnsichtGrund()`. Der Store bleibt über `opt.gesperrt` gesperrt; `nur-ansicht` sperrt zusätzlich Ziehen, Felder (`felderSperren`), Kontextmenü, Neu/Import.
- **Offline erkannt:** `code:'netz'` beim Senden oder `window` `offline` sofort; ein Realtime-`getrennt` erst nach 10 s Karenz (`GETRENNT_KARENZ_MS`; PocketBase trennt nach 300 s Ruhe). Wiederverbinden (`versucheWieder`, alle 5 s und bei `online`): Token erneuern, `neuAbonnieren()`, Warteschlange senden (Konflikt → Dialog), `laden()`, Marke weg.
- **Start ohne Netz (jeder Start):** bei `offline` oder vorübergehendem Fehler zeigt `boot()` `zeigeKopie('offline')` (`repo.load`), sofern es eine Kopie gibt, und versucht es alle 15 s (`kopieWieder`); ohne Kopie Projektdialog. Der Live-Monitor (`bzp_live=1`) öffnet das aktive Projekt ohne Dialog.
- **Neu/Vorlage/Import:** `planNeu` → `planAnlegen` (neue plan_id), nur mit `darfPlanAnlegen`. Löschen nur Besitzer/Superadmin (UI und Server: Migration `1700000004`).
- **Kein mitgelieferter Plan:** die App holt nie eine Plan-JSON (kein `BUNDLED`/`openBundled`, kein `fetch` einer `.json` in `js/`; Sperre in `tests/run.mjs`). Testdaten: `tools/fixtures/`, Prüfskripte legen sie über die lokale PocketBase an.
- **Mitglieder/Verwaltung** (`js/mitglieder.js`, Logik `mitglieder-logik.js`): `#mitglieder-oeffnen` nur bei `darfMitglieder(rolle)`, `#verwaltung-oeffnen` nur für `user.superadmin`. Änderungen direkt über `pb` (kein Store, kein Undo), der Dialog lädt danach neu; beim Schließen mit Änderung `nachladen()`, eigenes Entfernen öffnet den Projektdialog.
- **Auslieferung:** Test = GitHub Pages (`main`), Live = Coolify aus `live` mit `Dockerfile` (nginx, Allowlist-`COPY`; `tests/run.mjs` prüft Image gegen `HUELLE`, `nginx.conf` s. dort). Hostname wählt die API (`pb.js`). Server-Teil spielt nur der Admin ein (`docs/admin-auftrag-online-phase2.md`), danach `verify-pb-regeln.mjs --gegen <url>` (Lesemodus, schreibt nie). Superadmin: `pocketbase/setup.mjs`; `schema.json`: `node tools/pb-schema-export.mjs [--pruefen]`. **`verify-browser.mjs --base` prüft nur Anmeldeseite und Weiterleitung** (ohne Konto kein Plan).
