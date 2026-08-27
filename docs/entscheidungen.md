# Entscheidungen

Warum Dinge so sind, wie sie sind. Nur das, was sich aus dem Code nicht ablesen lässt.

## Grundsätzliches

| Frage | Entscheidung | Warum |
|---|---|---|
| Zeitachse | Vier Zoomstufen: Monate / Wochen / Tage / Stunden | Der Zeitraum spannt Monate, der Load-In läuft stundengenau. Ein Raster kann beides nicht. |
| Backend | **Keines.** Reine statische Auslieferung, localStorage + JSON-Export | Eine vorbereitete PocketBase-Schicht wurde in v0.8.0 aus `main` entfernt (siehe unten). Kommt der Bedarf zurück, wird es eine **eigene** Instanz, keine Kopplung an Crewplaner: übernommen werden Muster und Erfahrungen, nicht die Daten. |
| Gantt-Zeilen | Zwei Ebenen: Band (aufklappbar) → Vorgänge | Entspricht dem klassischen Bauzeitenplan. Das Band ist je nach Plan-Ebene ein Gewerk oder eine Bühne. |
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

Seit v0.1.1 zieht der **„Tage"-Knopf einen einzelnen Kalendertag über die volle
Breite auf** (`fitDay`, linksbündig auf 00:00) statt fixer px/min — die 0,25 oben ist
der historische Ausgangswert, nicht mehr das aktuelle Verhalten der Tagesstufe.

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

Später kamen zwei weitere Töne dazu — **Ocker (`--gw-8`) und Türkis (`--gw-9`)** —
für Pläne mit mehr als acht Gewerken (Palette heute: 10 Töne × 2 Schraffuren = 20
Plätze, `HUES=10`/`MAX_SLOTS=20`). Die beiden stehen **bewusst außerhalb** der
Farbsuche (auf Ansage handgesetzt in `base.css`). Sauber wäre, die Suche für zehn Töne
neu zu rechnen, falls der Bedarf bleibt.

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

## Zwei Ebenen statt zweier Anwendungen

Ein Bauzeitenplan und ein Showablauf sehen verschieden aus, haben aber dieselbe
**Form**: eine benannte, sortierbare, eingefärbte Spur mit Vorgängen darin. Deshalb
ist eine **Bühne technisch ein Gewerk mit `art:'buehne'`** und ein Zeiteintrag ein
normaler Vorgang darin (`js/ebene.js`). Der Preis der Alternative wäre ein zweiter
Store, ein zweites Undo und eine zweite Persistenz gewesen — für dasselbe Verhalten.

Altpläne kennen das Feld nicht und sind deshalb durchweg Gewerke; der Bauzeitenplan
sieht aus wie immer. **Ein Gewerk wird nie nachträglich zur Bühne**: alle Vorgänge
darin sprängen die Ebene mit.

Die **Farbplätze werden je Ebene vergeben**. Der Klassentreffen-Plan hat 20 Gewerke,
also genau `MAX_SLOTS`. Zusammengezählt wäre die Palette mit der ersten Bühne
erschöpft — dabei sind Gewerke und Bühnen nie zusammen zu sehen.

**Gebündelt wird nur im Bauzeitenplan.** Dort ist «Aufbau Bühne» an drei Tagen EINE
Tätigkeit (`seriesRows`); ohne die Bündelung hätte die Crew 113 Zeilen für 28 Dinge.
Im Showablauf ist die Reihenfolge der Zeilen dagegen der **Ablauf selbst** — Einlass,
Band, Umbau, Band —, und den liest man von oben nach unten. Gebündelt entstand daraus
eine Zeile «Changeover» mit sechs Balken, die zwischen den Acts hing.

**Der Verzug in der Live-Kopfzeile zählt nur, was noch aussteht oder läuft.**
`delaysAt` meldet auch längst vergangene, nie abgehakte Punkte; bei Doors (12:00–14:00,
Status «geplant») stand um 15:30 groß und rot «+4 Std» — an einem Abend, der exakt
nach Plan lief. Das ist keine Verspätung, sondern eine fehlende Rückmeldung. Die Regel
«Status wird nie automatisch gesetzt» bleibt unberührt: gefiltert wird die Anzeige,
nicht die Rechnung.

## Der Abschnitt: Setup und Show sind zwei Abläufe DERSELBEN Bühne

Am Showtag laufen zwei Dinge mit ganz verschiedenen Uhrzeiten und verschiedenen
Lesern: Load-in und Setup bis zum Showstart, danach die Running Order. In beides
in eine Achse von 08 bis 23 Uhr zu quetschen, wird keinem gerecht.

Der Abschnitt hängt am **Zeiteintrag** (`abschnitt: 'setup'|'show'`), nicht am
Band. Der erste Versuch (v0.9.1) hängte ihn an die Bühne — das erzwang zwei
Bänder «Hauptbühne Setup» und «Hauptbühne Show», und der Store verbietet doppelte
Bühnennamen, man hätte sie künstlich verschieden benennen müssen. Es gibt aber
EINE Bühne mit zwei Abläufen.

Deshalb filtert `sichtGewerke` **nicht** nach Abschnitt, `imAbschnitt` filtert die
Einträge: die Bühne bleibt in beiden Ansichten stehen, auch wenn sie dort noch
nichts hat — genau da legt man den ersten Setup-Eintrag an. Jede Ansicht rechnet
ihr Zeitfenster selbst (`programmFenster`), Setup zeigt den Morgen, Show den Abend.

**Die Oberfläche kennt drei Ansichten, das Modell zwei Ebenen plus Abschnitt.**
Bauzeitenplan · Setup · Show stehen in EINER Leiste, genau eine ist gedrückt.
Vorher waren es zwei Umschalter im selben Stil nebeneinander, mit je einem
dunklen Knopf — das las sich als eine Leiste mit zwei gleichzeitig angewählten
Knöpfen, und niemand fand, wie man zwischen Setup und Show wechselt. **Zwei gleich
aussehende Segmentgruppen nebeneinander SIND eine Gruppe, egal was der Code
meint.** «Alle» gibt es dafür nicht mehr; der Durchlass lebt in `imAbschnitt`
weiter, eine vierte Stufe wäre ohne Umbau nachrüstbar.

## Ein Soundcheck ist ein Zeiteintrag, kein Feld

Als Feld am Act (`soundcheck`, bis v0.9.3) war er ein Startzeitpunkt ohne Dauer
und ohne Ende. Er tauchte damit in keiner Zeitachse auf — ob sich zwei
Soundchecks überschneiden, sah niemand, und genau das ist die Frage, die man am
Nachmittag beantworten muss.

Jetzt ist er ein normaler Eintrag im Setup-Abschnitt mit `fuer: <taskId>` — Text-id,
nie Relation, wie `parent`. Damit hat er Balken, Dauer, Farbe, Notiz und
Anforderungen geschenkt. Bedient wird er aus dem Panel des Acts; das ist der
bequeme Weg dorthin, kein zweiter Speicherort. `removeTask` kaskadiert über
`fuer`, sonst bliebe eine Waise mit toter Zuordnung zurück.

## Farbe: gewählt AUS der Palette, nie neu definiert

Ein Zeiteintrag darf eine eigene Farbe tragen (`slot` am Vorgang, `null` = erbt
von der Bühne); ein Gewerk nicht. Der Unterschied hat einen Grund: im
Bauzeitenplan stehen 20 Gewerke untereinander, und genau dafür ist die Farbsuche
gemacht. Auf einer Bühne stehen selten mehr als zwei, drei Bänder.

Gewählt wird immer aus der validierten Palette — zehn Töne × Schraffur, weil ein
Farbplatz genau dieses Paar IST (`slotAus`/`hueVon`). Deshalb reichen zehn Punkte
und ein Häkchen für zwanzig Kombinationen.

**Neben jedem Farbton steht seine Schriftfarbe (`--gw-t-*`), und die ist ebenfalls
gerechnet.** Gefüllte Balken tragen ihre Beschriftung auf der Farbe. Weiß erreicht
auf Gelb nur 2,17:1; gewählt ist je Ton die Tinte, die in hell UND dunkel über 3:1
bleibt — dunkel auf sieben Tönen, weiß auf Violett, Grün und Ocker. Eine statische
Prüfung rechnet das bei jedem Testlauf nach.

## Zeitfelder im Showablauf tragen kein Datum

Der Tag steht im Umschalter; zwei Spalten à 205 px für dieselbe Information
drängten die Anforderungen aus dem Bild. Zwei Fallen, die das Datum verdeckt hatte
— beide als reine Funktionen in `conflicts.js`:

- **`mitUhrzeit` behält den Datumsteil.** Ein Eintrag vom Vortag ist über den
  Tagesfilter auch am Folgetag sichtbar; schriebe das Feld den GEZEIGTEN Tag,
  spränge er beim ersten Antippen einen Tag weit.
- **`endeNachStart`: Ende vor Start meint den Folgetag.** «22:00 bis 03:00» ist
  die selbstverständliche Schreibweise. Der Folgetag kommt über den Kalender,
  nicht über +1440 Minuten — der 25.10.2026 hat 25 Stunden.

Im Bauzeitenplan bleiben die Felder datiert: er läuft über vierzehn Tage.

## PocketBase liegt auf Eis

Eine fertige Login- und Rollenschicht lag von v0.3.0 bis v0.7.1 **bewusst uncommittet**
im Arbeitsbaum. Sie griff nur mit `?backend=pb` und tat auf der veröffentlichten Seite
nichts — lud ihre Module aber bei jedem Aufruf mit und machte jeden Feature-Commit zu
einer Isolationsprozedur (sichern, auf HEAD zurücksetzen, Feature neu auftragen,
zurückkopieren).

In v0.8.0 wurde sie aus `main` entfernt. Die Seite ist eine reine
GitHub-Pages-Auslieferung ohne Nutzerverwaltung; ein Backend, das niemand benutzt,
ist kein Vorsprung, sondern Ballast. Der vollständige Stand — `pb.js`, `auth.js`,
`session.js`, `roles.js`, `persistence-pb.js`, `login.html`, `admin.html`, das
PocketBase-Schema samt Hooks und `setup.mjs`, die zugehörigen Tests und die
Integrationspunkte — liegt im Branch **`pocketbase-vorbereitung`**. Er wird nicht
deployt und nicht gemergt. Wer Online + Rollen wieder aufnimmt, macht dort weiter;
die Crewplaner-Lehren weiter oben in dieser Datei gelten dann wieder.

## Was bewusst noch fehlt

Drag & Drop der Balken im Gantt sowie Ansichten & Export (öffentlicher Link, PDF/ICS).
Darstellung, Bearbeiten, Live-Modus, Untervorgänge, Prüf-Liste, Verknüpfungs-Suche,
Tagesblätter und der Showablauf mit Setup, Farben und Soundchecks stehen
(Stand v0.9.5). Startdaten kommen aus den
Vorlagen (`js/templates.js`) bzw. importierten JSON-Plänen — einen
`js/data.js`-Demo-Datensatz gibt es nicht mehr.
