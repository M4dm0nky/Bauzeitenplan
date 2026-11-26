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

- **Kein lokaler Modus:** ohne Anmeldung `login.html` (`?api=` weiterreichen). `pb.on('abgemeldet')` ist der einzige Weg dorthin (`zuLogin`); `abmelden()` meldet selbst, nicht doppelt auslösen. Ausnahme folgt: Live-Monitor (Task 10).
- **Senden:** `store.subscribe((s, info))`: `quelle` lokal/undo/redo → `sende(info.aend)` → `server.senden`; remote/replace nie. Alles mit Netz oder Rückfrage läuft hintereinander durch `reihe`. Anzeige `#sync-state` (einziger Schreiber `paintSpeicher`): ✓ gesendet · ⟳ sendet… · ⚠ offen (n).
- **Konflikt (`loeseKonflikt`, Logik DOM-frei in `js/konflikt.js`):** geändert → «Ihre Fassung nehmen» / «Meine behalten»; gelöscht → «Wiederherstellen» / «Verwerfen»; `unbekannt` (Lesefehler) ist KEINE Löschung. Abbrechen lässt den Konflikt offen (`geparkt`, Klick auf den Speicherstand). Der Server kennt keinen Bearbeiter je Datensatz: der Dialog sagt «jemand anderem».
- **Undo-Konflikt:** `store.undo()` liefert `{ok:false, konflikt}` → «Trotzdem zurücknehmen?» → `undo({erzwingen:true})` (`macheUndo`).
- **Fremdänderungen** nur über `store.applyRemote` (gebündelt, 120 ms), kein Toast je Änderung. Nach `getrennt` + `verbunden`: ungesendetes senden, dann `laden()` und `applyRemote` (Undo-Verlauf bleibt). Token alle 6 h erneuern, danach `neuAbonnieren()`.
- **Offline:** `gesperrt` liefert «Offline – nur Ansicht»; `versucheWieder` prüft alle 5 s. Die Offline-Ansicht baut Task 10 darauf.
- **Neu/Vorlage/Import:** `planNeu` → `planAnlegen` (neue plan_id), nur mit `darfPlanAnlegen`. Löschen nur Besitzer/Superadmin.
- **Kein mitgelieferter Plan:** die App holt nie eine Plan-JSON (Sperre in `tests/run.mjs`).
- **Prüfen:** `node tools/verify-mehrbenutzer.mjs` (lokale PocketBase, zwei Browserkontexte).
