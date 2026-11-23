---
paths:
  - "js/resources.js"
  - "js/bedarf.js"
  - "js/store.js"
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
