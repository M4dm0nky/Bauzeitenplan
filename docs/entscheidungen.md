# Entscheidungen

Warum Dinge so sind, wie sie sind. Nur das, was sich aus dem Code nicht ablesen lässt.

## Grundsätzliches

| Frage | Entscheidung | Warum |
|---|---|---|
| Zeitachse | Vier Zoomstufen: Monate / Wochen / Tage / Stunden | Der Zeitraum spannt Monate, der Load-In läuft stundengenau. Ein Raster kann beides nicht. |
| Backend | **Eigene** PocketBase-Instanz, keine Kopplung an Crewplaner | Ausdrücklich so gewollt. Übernommen werden die Muster und Erfahrungen, nicht die Daten. |
| Gantt-Zeilen | Zwei Ebenen: Gewerk (aufklappbar) → Vorgänge | Entspricht dem klassischen Bauzeitenplan. |
| Abhängigkeiten | Von Anfang an, alle vier Typen + kritischer Pfad | — |
| Build-Step | Keiner. Native ES-Module. | Konsistent zu Crewplaner und Personalplan. `tools/build-prototypes.mjs` ist **nur** für die Design-Artifacts (CSP verlangt dort alles inline). |

## Zoomstufen sind nach Sichtbarkeit bemessen, nicht nach runden Zahlen

Der erste Entwurf setzte „Tage" auf 720 px/Tag. Das zeigt **1,8 Tage** — faktisch
eine Stundenansicht. Die Presets in `js/timeaxis.js` sind jetzt danach gewählt, was
auf einem ~1300 px breiten Zeitfeld tatsächlich sichtbar ist:

| Stufe | px/min | sichtbar |
|---|---|---|
| Monate | 0.02 | ~45 Tage — das ganze Projekt |
| Wochen | 0.08 | ~11 Tage — Aufbau + Show |
| Tage | 0.25 | ~3,6 Tage — die Aufbauwoche |
| Stunden | 1.5 | ~14 Stunden — der Load-In-Tag |

`tests/timeaxis.test.mjs` prüft das als **sichtbare Zeitspanne**, nicht als px-Wert.
Wer die Presets ändert, muss durch diese Tests.

## Der kritische Pfad braucht einen echten Zielmeilenstein

Die naive Ankerregel — „Vorgänge ohne Nachfolger enden an ihrem geplanten Termin" —
macht **jede Kettenendstelle zwangsläufig kritisch**. Ergebnis war: 27 von 39
Vorgängen markiert, also nutzlos.

Lösung, zweiteilig:

1. Ein Zielmeilenstein (`doors`), auf den alle Gewerke münden. Der Abstand zum
   eigenen Ende ist der Puffer des Gewerks.
2. `critical = float <= minFloat`, wobei **verankerte Senken aus dem minFloat
   herausfallen**. Sonst zöge allein der Zielmeilenstein (Puffer 0 per Definition)
   den minFloat auf null und kein Vorgänger wäre je kritisch.

Ergebnis: eine saubere Kette Bühne → Rigging → Ton/Video/Pyro. Licht hat 22 h Puffer,
die Genehmigungen Wochen. Bei einem straff durchgeplanten Netz ist minFloat 0 und die
Regel entspricht der klassischen CPM.

Regressionstests dafür stehen in `tests/schedule.test.mjs`.

## Gewerk-Farben sind gerechnet

Acht Gewerke, acht Farben aus einer validierten Palette. Die **Zuordnung** stammt aus
einem Suchlauf über 720 Varianten (`docs/farbsuche.md`), der die Unterscheidbarkeit
**benachbarter Zeilen** bei Farbenblindheit maximiert — im Gantt stehen benachbarte
Gewerke direkt untereinander, deshalb zählen genau die Nachbarpaare.

Licht = Gelb und Pyro = Rot waren semantisch gesetzt. Der Rest fiel aus der Rechnung:
Bühne = Baustellen-Orange, Sanitär = Grün ergaben sich als bester Gleichstand und
tragen zusätzlich Bedeutung.

Erreicht wird das theoretische Maximum: worst-adjacent CVD ΔE 9,1 (hell) / 8,4 (dunkel),
Normalsicht ΔE 19,6 / 19,3. Alle harten Gates bestanden, in Hell und Dunkel.

**Nicht per Hand ändern.** Wer die Reihenfolge umstellt, macht die Prüfung wertlos.

### Reliefregel — bitte nicht wegoptimieren

Rigging (`#1baf7a`), Licht (`#eda100`) und Ton (`#e87ba4`) liegen auf hellem Grund
**unter 3:1 Kontrast**. Das ist zulässig, aber nur mit sekundärer Kodierung. Deshalb:

- **jeder Balken trägt eine sichtbare Beschriftung** (`gantt.js` → `bz-bar-t`),
- die Legende trägt Namen, nicht nur Farbpunkte,
- der kritische Pfad ist zusätzlich durch das `KRIT`-Kürzel markiert, nicht nur rot.

Wer die Balkenbeschriftung entfernt, bricht die Barrierefreiheit.

## Erfahrungen aus Crewplaner, die hier als Regel gelten

Teuer gelernt, hier vorab eingebaut:

- **`project_id` & Co. als Text, niemals als Relation.** Der Coolify-Reimport kippt
  Relations und bricht sämtliche Filter.
- **E-Mails immer `.toLowerCase()`** speichern und filtern — PocketBase-Filter sind
  case-sensitive.
- **API-Rules nach jedem Coolify-Redeploy prüfen** — sie fallen auf `auth != ""`
  zurück. Gehört auf die Deploy-Checkliste.
- **Kein Bundle-File.** ES-Module mit `?v=`-Cache-Bust.
- **UI-Verstecken ist keine Sicherheit.** Rollen müssen serverseitig über
  API-Rules erzwungen werden, `rbac.js` blendet nur aus.

## Zeitzonen

Alle Zeiten intern als **Minuten seit Epoche** (`toMin()`), gerechnet aus echten
Zeitstempeln — nie aus Ziffernarithmetik auf Datumsstrings. Sonst ist die Dauer über
den Sommerzeit-Sprung falsch, und dieser Bug schlägt genau einmal im Jahr zu.
Ein Test deckt den DST-Übergang ab.

## Was bewusst noch fehlt

Login, Backend, Bearbeiten, Rollen, Export. Das ist Phase 1 ff.
`js/data.js` enthält bis dahin einen realistischen Demo-Datensatz.
