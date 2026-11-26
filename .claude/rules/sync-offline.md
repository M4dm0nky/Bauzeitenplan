---
paths:
  - "js/server.js"
  - "js/konflikt.js"
  - "js/pb.js"
  - "js/persistence.js"
  - "sw.js"
---

# Server, Senden und Offline

Der Plan lebt auf PocketBase (`js/pb.js` Client, `js/server.js` Plan lesen/senden/Realtime). `localStorage` hält nur das Token (`bzp_auth`) und die **lokale Kopie** (`repo.save`, ohne Token) für `print.html`. Der GitHub-Sync ist entfernt (`js/sync.js` existiert nicht, kein `bzp_sync` in `js/`; `tests/run.mjs` sperrt beides).

- **Kein lokaler Modus:** ohne Anmeldung `login.html` (`?api=` weiterreichen). `pb.on('abgemeldet')` ist der einzige Weg dorthin (`zuLogin`); `abmelden()` meldet selbst, nicht doppelt auslösen. Ausnahme: der Live-Monitor (`bzp_live=1`) mit lokaler Kopie zeigt sie bei abgelaufener Anmeldung weiter (`zeigeKopie('abgemeldet')`), nie `login.html`. `login.js` leitet bei vorhandenem Token nie zurück (keine Schleife; `verify-mehrbenutzer.mjs` MONITOR_ABGELAUFEN). **Manuelles Abmelden löscht die lokalen Kopien** (geteilter Rechner), `401` lässt sie stehen.
- **Senden:** `store.subscribe((s, info))`: `quelle` lokal/undo/redo → `sende(info.aend)` → `server.senden`; remote/replace nie. Alles mit Netz oder Rückfrage läuft hintereinander durch `reihe`. Anzeige `#sync-state` (einziger Schreiber `paintSpeicher`): ✓ gesendet · ⟳ sendet… · ⚠ offen (n).
- **Konflikt (`loeseKonflikt`, Logik DOM-frei in `js/konflikt.js`):** geändert → «Ihre Fassung nehmen» / «Meine behalten»; gelöscht → «Wiederherstellen» / «Verwerfen»; `unbekannt` (Lesefehler) ist KEINE Löschung. Abbrechen lässt den Konflikt offen (`geparkt`, Klick auf den Speicherstand). Der Server kennt keinen Bearbeiter je Datensatz: der Dialog sagt «jemand anderem».
- **Undo-Konflikt:** `store.undo()` liefert `{ok:false, konflikt}` → «Trotzdem zurücknehmen?» → `undo({erzwingen:true})` (`macheUndo`).
- **Fremdänderungen** nur über `store.applyRemote` (gebündelt, 120 ms), kein Toast je Änderung. Nach `getrennt` + `verbunden`: ungesendetes senden, dann `laden()` und `applyRemote` (Undo-Verlauf bleibt). Token alle 6 h erneuern, danach `neuAbonnieren()`.
- **Nur Ansicht:** `setNurAnsicht(grund)` (app.js) ist der EINZIGE Schreiber von `body.nur-ansicht` und `#hd-offline` («📡 Offline – nur Ansicht» · «👁 Nur ansehen» · «🔑 Anmeldung abgelaufen – lokale Kopie»); Grund kommt aus `nurAnsichtGrund()` (Kopiemodus, `offline`, Rolle Betrachter). Der Store bleibt über `opt.gesperrt` gesperrt; `nur-ansicht` sperrt zusätzlich Ziehen (`gantt.js`), Felder in `#ins/#tb/#ein-seite/#bd` (`felderSperren`, MutationObserver in `mount()`), Kontextmenü, Neu/Import. Jetzt-Linie und Live-Ansicht laufen weiter (Uhr, nicht Server).
- **Offline erkannt** über Realtime `getrennt`, `code:'netz'` beim Senden oder `window` `offline`; Wiederverbinden (`versucheWieder`, alle 5 s und bei `online`): Token erneuern, `neuAbonnieren()`, Warteschlange senden (Konflikt → Dialog, betroffene Liste in `unterwegs`), `laden()`, Marke weg.
- **Start ohne Netz (Live-Monitor):** `boot()` öffnet bei `bzp_live=1` das aktive Projekt ohne Dialog; scheitert das am Netz, zeigt `zeigeKopie('offline')` die lokale Kopie (`repo.load`) und versucht es alle 15 s erneut (`kopieWieder`).
- **Neu/Vorlage/Import:** `planNeu` → `planAnlegen` (neue plan_id), nur mit `darfPlanAnlegen`. Löschen nur Besitzer/Superadmin.
- **Kein mitgelieferter Plan:** die App holt nie eine Plan-JSON (Sperre in `tests/run.mjs`).
- **Prüfen:** `node tools/verify-mehrbenutzer.mjs` (lokale PocketBase, zwei Browserkontexte).
