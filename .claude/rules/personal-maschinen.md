---
paths:
  - "js/resources.js"
  - "js/bedarf.js"
  - "js/store.js"
  - "js/res-picker.js"
  - "js/res-katalog.js"
  - "js/inspector.js"
  - "js/table.js"
  - "js/listen-editor.js"
  - "tools/verify-edit.mjs"
---

# Personal und Maschinen

- **Zuweisung = `{rid, n, von, bis}`** in `t.res`; `null` = ganzer Vorgang, gesetzt innerhalb der Vorgangsdauer (`setTaskRes`). Bezeichnungen in `project.ressourcen` (`kind: 'personal'|'maschine'`, im Export), Verwaltung über `addRessource` + die drei Auswahlbefehle.
- **Eingebaute Bezeichnungen** in Kategorien: `js/res-katalog.js` (`RES_KATEGORIEN`, `RES_EINGEBAUT`, ids stabil, ein Test pinnt sie); `ressourcen()`/`resGruppen()`/`resLabel()`/`resKind()` führen sie mit den eigenen (`project.ressourcen`, Feld `kat`) zusammen. `migrate` legt gleichnamige eigene (gleiche Art) in die eingebaute um. `res` MUSS durch `addTask`.
- **Bereitstellung = normaler Vorgang** mit `bereitstellung: true` (POOL, `res` = Angebot). `addDep` lehnt ihn als Quelle UND Ziel ab; `findConflicts`/Puffer-Rechnung nehmen ihn aus; `setTaskField` verweigert `bereitstellung: true`, solange Verknüpfungen bestehen.
- **Deckungslücke nur, wenn der Vorgang eine Zuweisung dieser Art hat** (`deckung(t, kind, state)` sonst `null`), je KIND; kein Konflikt, nicht in der Prüf-Liste (Balken `bz-bereit`; im Panel als Klartext, keine Alarmfarbe).
- **`crew` ist die MIGRIERTE Ressource «Crew»:** `persistence.js` wandelt `crew: N` einmalig in `res: [{rid:'crew', n:N, von:null, bis:null}]` (idempotent, `tests/persistence.test.mjs`). Vorlagen laufen NICHT durch `migrate()`; `planFromTemplate` übersetzt selbst.
- **Personal-/Maschinenbedarf sind DARSTELLUNGEN** (`data-view="personal"|"maschine"`): `bedarf.setEbene(...)` läuft überall mit, wo `gantt.setEbene`/`table.setEbene` laufen. Raster: Tage (Bauzeitenplan), Stunden (Showablauf). Gerechnet nur in `bedarfsRaster()`; Scheibe je Minute über `scheibeIndex` (binär). Tage über `rasterGrenzen(…, 'tag')` (Kalendertage, gleiche Uhrzeit, 23/25 h bei Zeitumstellung); Stunden numerisch.
- **Personal und Maschinen in DERSELBEN Verwalten-Liste** (`tb-verw-kind`, 👤/⚙); Anlegen getrennt («+ Personal»/«+ Maschine»).
- **Zuweisen = Such-Auswahl `openResPicker` (`js/res-picker.js`)**, nie ein `<select>`: Panel und Tabellenkasten, «+ Personal»/«+ Maschine» öffnen sie (kein «ersten Eintrag nehmen»). «+ Neu…» → `neuFragen` mit `resNeuOpt(kind)` (Name + Kategorie, `opt.auswahl`). Verwalten-Liste zeigt eingebaute schreibgeschützt (`tb-verw-fest`), eigene mit Kategorie.
- **Bedarfsstatus je Zuweisung:** `status` (`RES_STATUS` in store.js: angefragt = Feld fehlt · bestaetigt · abgelehnt), `notiz` (<= 200 Zeichen), `bestaetigtAm` (ISO vom Aufrufer, Store uhrfrei). Schreiben über `setResStatus` / `setResStatusMehrere` (alles oder nichts, ein Undo). Rückfall auf angefragt an EINER Stelle (`statusZurueck`): echte Zeitänderung (`toMin`-Vergleich; moveTask, start/end, shiftPlan, Sammelhülle), geänderte Zeile (rid/n/von/bis), Kopie. Bereitstellung hat keinen Status.
- **Status in der Oberfläche:** Symbol + Farbe, nie nur Farbe (`resStatusMarke` in `res-picker.js`, Klassen `res-st res-st-<status>`, Farben aus `--ein-ok`/`--ein-warn`/`--crit` in jedem Theme; `resStatusInfo` DOM-frei in resources.js). Panel (`resRow`): Symbol + ✓/✕-Knöpfe; Tabellenkasten nur Symbol. **«Offene Bedarfe»** (`bd-offen`, oben in der Bedarfsansicht; Rechnung `offeneBedarfe(state)`, DOM-frei: nur angefragt, ohne Bereitstellung/ohneTermin, je Gewerk und Tag des Zeilenbeginns) bestätigt je Zeile oder per «Alle bestätigen» (`setResStatusMehrere`, ein Undo); Ablehnen fragt den Grund über `neuFragen` (`ablehnenOpt`). `bedarfsRaster` liefert je Zelle `bestaetigt`. **Leerer Bedarf = kein Bedarf dieser Art im Plan zugewiesen** (nicht «keine Bezeichnung», der Katalog ist nie leer).
