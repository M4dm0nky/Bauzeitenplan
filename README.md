# Bauzeitenplan

**Live: https://callboard.nyxlightwork.de** · **Test: https://m4dm0nky.github.io/Bauzeitenplan/** · [Changelog](CHANGELOG.md)

Digitaler Gantt-Ablaufplan für die Veranstaltungsbranche. Jedes Gewerk — Licht, Ton,
Video, Pyro, Catering, Sanitär, Bühne, Rigging — pflegt seine eigenen Vorgänge, alle
sehen denselben Stand.

Der Zeitstrahl trägt beide Realitäten der Branche: die Vorbereitung spannt Monate,
der Load-In läuft stundengenau.

## Stand

**Benutzbar.** Projekte anlegen (Vorlagen), befüllen, bearbeiten — online, mit
Anmeldung, gemeinsam mit anderen (siehe «Online und Mehrbenutzer»). Gantt mit vier
Zoomstufen, Abhängigkeiten (FS/SS/FF/SF mit Lag), Meilensteine, Puffer/Engpass,
Undo/Redo, JSON-Export und -Import.

## Online und Mehrbenutzer

Die App läuft gegen eine eigene **PocketBase** (0.40.6): Die Pläne liegen auf dem
Server, nicht mehr im Browser. Wer hinein will, meldet sich an (`login.html`:
Anmelden, «Passwort vergessen», Einladung annehmen). Änderungen anderer erscheinen
live (Realtime), jede Änderung geht sofort zum Server; der Knopf rechts in der
Kopfzeile zeigt den **Speicherstand** (✓ gesendet · ⟳ sendet… · ⚠ offen). Hat
jemand dasselbe inzwischen geändert, fragt die App («von jemand anderem geändert»),
statt still zu überschreiben.

**Rollen je Plan:** *Superadmin* (alles, verwaltet Konten) · *Besitzer* und
*Produktionsleitung* (alles im Plan, Mitglieder einladen, Bedarf bestätigen) ·
*Bearbeiter* (alles bearbeiten) · *Gewerkeleiter* (nur Vorgänge der eigenen
Gewerke) · *Betrachter* (nur ansehen). Die Rechte erzwingt der Server; die App
blendet nur vorab aus. Im Projektmenü: «Mitglieder…» (einladen per E-Mail oder
Link, Rolle und Gewerke ändern, entfernen) und «Verwaltung…» (Superadmin: wer
darf Pläne anlegen, alle Pläne).

**Offline ist nur Ansicht.** Ohne Netz sperrt die App das Bearbeiten («📡 Offline –
nur Ansicht») und verbindet sich wieder von selbst; ein kurzer Abbruch der
Live-Verbindung (der Server trennt nach 5 Minuten Ruhe) zählt erst nach 10 s als
offline. Auch ein Start ohne Netz (oder bei gestörtem Server) zeigt die lokale
Kopie, sofern es eine gibt. Der **Live-Monitor** (Live-Modus mit aktivem Projekt)
öffnet ohne Dialog und zeigt bei abgelaufener Anmeldung die lokale Kopie weiter.
Meldest du dich selbst ab, löscht die App die lokalen Kopien, auch in einem zweiten
Tab desselben Browsers. Ein Fehler des Servers (5xx, 429, kein JSON) nimmt
Änderungen nie zurück: sie bleiben offen und gehen später raus. Löschen darf einen
Plan nur der Besitzer oder der Superadmin. **`print.html` liest diese lokale Kopie** — vor dem Drucken also
die App einmal öffnen.

**Test und Live:** Der Hostname wählt die Instanz — `callboard.nyxlightwork.de`
nutzt die Live-API, alles andere (GitHub Pages, `localhost`) die Test-API; auf
`localhost` überschreibt `?api=<url>`. Auf Test sind keine Mails eingerichtet
(«Passwort vergessen» geht dort nicht, Einladungen gehen per Link).

**Dazugekommen (bis v0.12.1):** **Die Schiene links** — Bauzeitenplan und
Showablauf sind zwei getrennte Modi mit je eigener Leiste, eigener Tabelle und
eigenem Tageswähler, «Einrichten» als eigene Seite · **Personal & Maschinen** je
Vorgang — eigene Bezeichnungen, Anzahl und Zeitfenster, dazu
**Bereitstellungen** (ein Pool ohne Vorgangs-Funktion) und die Reiter
**Personalbedarf**/**Maschinenbedarf** · Gewerke per Drag & Drop umsortieren · Gantt und
Tabelle in gleicher Reihenfolge (nach Startzeit) · **Untervorgänge** (einklappbar,
Elternvorgang als Hülle) · **Handy/Tablet-tauglich** · **Prüf-Liste** für
Konflikte (sehen, zeigen, lösen oder abhaken) · **Verknüpfungs-Suche**
statt endlosem Dropdown · Hell/Dunkel-Umschalter im Kopf · **Tagesblätter zum
Drucken** · **Showablauf-Ebene** (siehe unten) · **Verknüpfen per Ziehen** im Gantt ·
**Live-Versatz** («wir hängen 5 Minuten hinterher») · **eigene Arten für
Zeiteinträge** · **eigene Abschnitte** (Load-in, Aftershow …) · **Arten und
Abschnitte verwalten** (umbenennen, sortieren, löschen) · CallBoard-Marke.

## Zwei Ebenen: Bauzeitenplan und Showablauf

Derselbe Plan, zwei Blickrichtungen. Oben im Kopf schaltest du um:

**Bauzeitenplan** — die ganze Veranstaltung über **Gewerke**: Vorbereitung,
Aufbau, Show, Abbau. Vorgänge gleichen Namens werden zu einer Zeile mit mehreren
Balken gebündelt; 353 Vorgänge ergeben 153 Zeilen.

**Showablauf** — der Tagesablauf auf den **Bühnen**: Bands, Redner, Umbauten.
Hier wird **nicht** gebündelt: jeder Zeiteintrag trägt seine eigene Zeile,
chronologisch von oben nach unten, mit der Startzeit vor dem Namen. Die
Seitenspalte ist damit allein schon der Ablaufplan.

```
12:00  DOORS
14:00  CREUTZFELD & JAKOB
14:30  Changeover
14:40  OLLI BANJO
```

Bühnen legst du an wie ein Gewerk (`+ Bühne`), benennst und sortierst sie genauso.
Den Showtag wählst du in der Schiene links, Häkchen in der Leiste blenden
einzelne Bühnen aus.

**Setup und Show sind zwei Ansichten derselben Bühne.** Am Showtag gibt es zwei
Abläufe mit ganz verschiedenen Uhrzeiten: Load-in und Setup bis zum Showstart,
danach die Running Order. Jeder **Zeiteintrag** gehört einem der beiden
Abschnitte, und oben in der Leiste steht **Setup · Show** — genau einer ist
gewählt. Jeder rechnet seine eigene Zeitachse. Die Bühne steht in beiden
Show-Ansichten, sie heißt einmal und ist dieselbe.

Angelegt wird in der **Tabelle**: im Bühnenkopf sitzt ein `+ Zeiteintrag`. Der
neue Eintrag landet im gezeigten Abschnitt und am gezeigten Tag und schließt
zeitlich an den letzten an. In der **Tabelle** kommen vier Spalten dazu, genau dort wo du den Zeitstrahl
anlegst: Abschnitt (Setup/Show), Typ, Kontakt und die Freitexte
**Anforderungen** und **Benötigtes Material**. Start und Ende zeigen dort nur die
Uhrzeit — der Tag steht ja oben.

**Eigene Abschnitte auch.** Dieselbe Mechanik in der Spalte *Abschnitt*: unten
im Auswahlfeld steht **«Neu»**, und schon hast du Load-in, Soundcheck oder
Aftershow. Der Umschalter oben bleibt bei Setup · Show — ein
eigener Abschnitt ist ein Etikett am Eintrag und wird in der **Show-Ansicht**
gezeigt. Stellst du einen Setup-Eintrag darauf um, sagt die App dir das, damit
die Zeile nicht kommentarlos aus dem Bild verschwindet.

**Verwalten:** Unter «Neu» steht **«Verwalten…»** — dort benennst du deine Arten
und Abschnitte um, sortierst sie mit ↑↓ und löschst sie. Gelöscht wird nur, was
niemand benutzt; sonst sagt der Knopf, wie viele Zeiteinträge daran hängen.
Sobald du einmal von Hand sortierst, gilt deine Reihenfolge — auch bei den
Abschnitten, deren Uhrzeit-Automatik damit aus ist. Umbenennen ändert nur den
Namen: die Zuordnung der Zeilen bleibt.

**Eigene Arten legst du selbst an.** Neben Act, Changeover, Doors und Show-Ende
steht im Typ-Auswahlfeld unten **«Neu»** — Name eintippen, fertig, die
Art ist angelegt und für diese Zeile gewählt. Ein Häkchen bestimmt, ob sie auf
dem A3-Blatt **zurücktritt** wie ein Changeover (niedrigere Zeile: auf dem Blatt
zählt, wer spielt). Deine Arten gehören zum Plan und reisen im JSON-Export mit —
wer die Datei bekommt, sieht «Line-Check» und nicht bloß eine Kennung.

**Soundchecks** legst du im Panel eines Acts an: ein Klick, und es entsteht ein
eigener Zeiteintrag im Setup-Abschnitt mit Beginn, Dauer und Ende (wie überall mit
grünem ✓ bestätigen). Als **Balken** — nur
so siehst du, ob sich zwei Soundchecks überschneiden. Löschst du den Act, geht
sein Soundcheck mit.

**Farben je Zeiteintrag:** Klick auf einen Balken öffnet das Panel rechts, dort
gibt es zehn Farbtöne und einen Schalter für **Schraffur** — aus Rot wird so
Rot-mit-Schraffur, insgesamt zwanzig unterscheidbare Kombinationen. «Wie Bühne»
nimmt eine eigene Farbe wieder zurück. Die Balken sind im Showablauf **gefüllt**;
die Schrift darauf ist je Farbton so gewählt, dass sie in Hell und Dunkel über
3:1 Kontrast bleibt (auf Gelb steht sie dunkel, auf Violett weiß).

Für den Monitor am FOH gibt es eine **Live-Kopfzeile**: was JETZT läuft, was ALS
NÄCHSTES kommt, der Verzug und die Uhr. Ein Changeover wird als Umbau angesagt,
nicht als Act.

## Personal & Maschinen

Zu jedem Vorgang — im Bauzeitenplan wie im Showablauf — trägst du ein, wer und
was gebraucht wird: Klick auf einen Balken öffnet das Panel, dort **+ Personal**
oder **+ Maschine**. Eine Bezeichnung wählst du aus einer Liste oder legst sie
mit **«+ Neu…»** selbst an — «Stagehand», «Gabelstapler», «Rigger» — sie bleibt
danach dauerhaft im Plan, wie die eigenen Eintragsarten. Dazu eine Anzahl und,
wenn nötig, ein eigenes Zeitfenster: läuft der Bühnenbau 10–20 Uhr und die
Helfer nur bis 18 Uhr, sagt der Balken «2 Std ohne Personal». In der **Tabelle**
steht dieselbe Bedienung hinten in der Spalte *Ressourcen*.

**Bereitstellung:** ein Häkchen macht aus einem Vorgang einen Pool statt eines
Bedarfs — «10 Stagehands, 08:00–22:00», ohne eigene Funktion im Ablauf. Dagegen
rechnen die beiden Reiter **Personalbedarf** und **Maschinenbedarf** (neben
Gantt und Tabelle): je Bezeichnung, je Stunde oder Tag, bereitgestellt · belegt
· frei. Stehen zehn Stagehands am Nachmittag bereit und braucht SIDO um 20 Uhr
sechs davon, zeigt der Reiter genau dort «+4» — der Rest deines Pools.

**Running-Order-Blatt:** Unter *Drucken → Running Order* kommt ein A3 quer je Tag
und Bühne — als Liste (`Zeit · Programmpunkt · Anforderungen · Material`). Leere
Felder drucken als **Linien zum Ausfüllen mit dem Stift**. Dort wählst du auch
den **Abschnitt**: ein Setup-Blatt für die Crew am Vormittag, ein Show-Blatt für
den Abend, oder beides auf einem. Kopf und Fuß nennen ihn, damit ein abgelegtes
Blatt sich selbst erklärt.

**Pläne liegen auf dem Server; Import/Export (JSON-Datei) bleibt für Sicherung und Austausch.** Beim Start fragt nach der Anmeldung der Projektdialog (deine Pläne, Neu, Import); nur ein Live-Monitor mit aktivem Projekt öffnet ohne Dialog. Die App holt nie von selbst eine Plan-Datei. `?plan=leer` ist der Schalter der Prüfwerkzeuge.

**Drucken: ein A3 quer je Tag.** Der Knopf **Drucken** im Kopf öffnet
`print.html` — die Tagesblätter für die Wand im Produktionsbüro. Dort wählst du
Zeitraum und **Gewerke** (Catering weg, Security weg …) und siehst die Blätter am
Bildschirm so, wie sie aus dem Drucker kommen.

Das Wegklicken ist mehr als Aufräumen: es bestimmt den **Maßstab**. An einem
normalen Aufbautag zwingt allein die Objektbewachung (00:01–23:59) das Blatt auf
24 Stunden; ohne sie schrumpft das Zeitfenster auf 08:00–18:00 und die Balken
werden dreimal so breit. Das Fenster gilt für alle Blätter gemeinsam, damit sie
vergleichbar bleiben — von Hand übersteuerbar.

Im Druckdialog **A3 · Querformat** wählen und **Hintergrundgrafiken einschalten**,
sonst drucken die Balken weiß.

**Deine Daten liegen auf dem Server.** Anmeldung, Rollen und Rechte ersetzen die
frühere Browser-Ablage; der **JSON-Export** bleibt als eigene Sicherung (Projektmenü →
Export). Neu, Import und Löschen gehen nur mit dem passenden Recht (Plan anlegen:
Produktionsleitung oder Superadmin; löschen: Besitzer oder Superadmin).

**Live-Modus** für den Aufbau: Zeitlinie läuft mit, Ansicht folgt, laufende
Vorgänge leuchten, Verzug wird benannt («sollte seit 20m laufen»). Der Status
wird dabei **nie** automatisch gesetzt — sonst sähe der Plan immer nach Plan aus
und das Signal «wir hängen» wäre weg.

**Der Versatz: die Ansage vom Pult.** Der gerechnete Verzug setzt voraus, dass
jemand die Häkchen pflegt — im Betrieb tut das niemand. Neben dem Live-Knopf
steht deshalb ein Stepper `− [ 5 ] +`: **plus ist Delay**, minus Vorlauf, je ein
Klick eine Minute. Daneben die Aussage im Klartext, «5 Min Delay» in Rot,
«3 Min vor Plan» in Grün.

**Der Ablauf rutscht, die Uhr bleibt stehen.** Balken, Beschriftungen und Pfeile
wandern nach rechts; Achse, Ticks und Jetzt-Linie stehen auf der echten Zeit. So
liest du an der Achse ab, wann SIDO **wirklich** auf die Bühne geht, statt es im
Kopf zu addieren — und in der Seitenspalte steht dieselbe verschobene Uhrzeit.
Der gerechnete Verzug zieht deine Ansage ab: aus «+10 Min» wird bei 5 Minuten
Ansage «+5 Min».

Der Versatz gehört dem Abend, nicht dem Plan: Er bleibt in diesem Browser, wandert
**nicht** in den Export und gilt nur für den Tag, an dem du ihn gesetzt hast —
sonst stünde der Plan am nächsten Morgen kommentarlos daneben.

**Als Nächstes:** Balken und Dauern im Gantt ziehen (Verknüpfungen gehen schon),
danach Ansichten & Export (öffentlicher Link, PDF/ICS).

**PocketBase** war bis v0.25 vorbereitet, aber auf Eis (Branch `pocketbase-vorbereitung`,
bleibt als Vorlage liegen). Die Online-Fassung wurde neu gebaut (Branch `online`);
Hintergründe: `docs/entscheidungen.md` → «Online und Mehrbenutzer».

## Starten

Ein Server ist nötig — ohne ihn blockiert der Browser die ES-Module per CORS.

```bash
python3 -m http.server 8080
# → http://localhost:8080   (spricht die Test-API; ein Konto dort braucht eine Einladung)
```

Kein Build, keine Abhängigkeiten zur Laufzeit. Zum Entwickeln startet
`node tools/pb-lokal.mjs` eine eigene lokale PocketBase (Binary nach `tools/.pb/`,
leere Daten, Konto per Zufallspasswort), `pocketbase/README.md` erklärt den Server-Teil.

### Die Schiene links

Am linken Rand steht eine schmale Schiene mit **zwei Modi**: Bauzeitenplan und
Showablauf. Genau einer ist aktiv, und du siehst nur, was in ihm etwas bedeutet
— im Bauzeitenplan keine Bühnen-Häkchen, im Showablauf keine Zoomstufen und
kein „Alle zuklappen". Der andere Modus ist immer einen Klick weit.

Den **Tag** wählst du über den Kalender-Knopf ganz links in der Leiste. Er
bietet nur Tage an, an denen im Plan auch etwas steht — mit der Kalenderwoche
daneben und einem Punkt am Tag, auf dem du gerade bist. Im Bauzeitenplan
springt die Achse dorthin, im Showablauf wechselt der Showtag.

Ganz unten das Zahnrad: **Einrichten** ist eine eigene Seite mit fünf Bereichen —
Projekt (Name, Ort, Adresse, Anfahrt, Kunde, Ansprechpartner, Zeitzone),
Zeitraum & Phasen, Gewerke & Bühnen, **Personal & Maschinen**, **Arten & Abschnitte**. Jeder
Bereich zeigt seinen Stand (✓ fertig, ⚠ Warnung, ○ offen). Passt ein Teil nicht
mehr in den Zeitraum, warnt die Seite, und ein Knopf übernimmt die Hülle. Nach
«Neu» führt dich die Seite einmal Schritt für Schritt durch (Zurück/Weiter,
«Fertig»). Der Plan bleibt dahinter stehen; „Zum Plan" gibt dir genau den
Ausschnitt zurück, bei dem du warst. Projekt anlegen/wechseln, Import/Export,
Mitglieder und Abmelden findest du im Menü «📁 Projekt» in der Kopfzeile. Ort, Adresse und
Ansprechpartner stehen auch im Kopf der Tagesblätter. Die schnellen Wege bleiben
daneben bestehen — eine Bezeichnung legst du weiter mit „+ Neu…" im Auswahlfeld
an, mitten im Tippen; Einrichten ist der Weg zum Aufräumen danach.

**Plan verschieben:** Einrichten → Zeitraum & Phasen → «Plan verschieben…». Der ganze Plan
(Vorgänge, Phasen, Rahmen) rutscht um Tage und Stunden:Minuten (`1:30`, `-0:30` oder reine Minuten wie `90`),
negative Werte ziehen vor. Die Tage zählen über den Kalender, die Uhrzeit bleibt, auch über die Zeitumstellung.
Eine Vorschau zeigt den neuen Aufbaubeginn; Grenzen sind 36 500 Tage und 10 080 Minuten.
Ein `⌘Z` nimmt das Verschieben zurück.

Daneben die Arbeitsleiste, jetzt kurz: im Showablauf Tag · Setup/Show ·
Plan/Tabelle/Bedarf · Bühnen · Undo · Prüfen · Live mit Versatz, im
Bauzeitenplan Tag · Plan/Tabelle/Bedarf plus die Zeitwerkzeuge (Zoomstufe,
Heute, Zuklappen).

### Bedienung

| | |
|---|---|
| `⌘`/`Ctrl` + Mausrad | zoomt am Cursor — der Zeitpunkt unter der Maus bleibt stehen |
| `⇧` + Mausrad | scrollt seitwärts |
| `←` `→` | blättern · `H` springt zu heute |
| `⌘Z` / `⇧⌘Z` | rückgängig / wiederholen (im Textfeld gehört `⌘Z` dem Feld; den Plan über ↺ zurücksetzen) |
| Minimap unten | Fenster ziehen, um über Monate zu navigieren |

**Tabelle** (der schnelle Weg rein): `Enter` legt eine Zeile darunter an,
`Tab` springt weiter, `⌫` auf leerem Namen löscht. Dauer als Kurzform —
`4h`, `1,5h`, `90m`, `2t`, `1t 4h`. Das Ende rechnet sich; das Ende zu ändern
rechnet die Dauer zurück.

**Im Gantt:** Klick auf Balken oder Zeile → Panel rechts mit allen Feldern und
den Verknüpfungen. **Rechtsklick** öffnet das Menü (umbenennen, duplizieren,
sortieren, löschen). **Doppelklick** auf einen Namen benennt an Ort und Stelle um.

**Verknüpfen per Ziehen:** Fahr über einen Balken — an seinem Ende erscheint ein
Griff. Von dort auf den Nachfolger ziehen, fertig. Ein Gummiband zeigt die
Richtung, zulässige Ziele sind hervorgehoben und **unzulässige gesperrt**: Was
einen Ring ergäbe, sagt schon vor dem Loslassen nein. Am Rand scrollt die Ansicht
mit, `Esc` bricht ab. Es entsteht immer Ende→Start; den Typ stellst du danach im
Panel um. **Pfeile sind anklickbar** — ein Klick wählt die Verknüpfung aus, `Entf`
entfernt sie, `⌘Z` holt sie zurück.

**Geschätzte Dauern** haben eine gestrichelte rechte Kante — das Ende steht
nicht fest. Im Panel gibt es dazu ein Häkchen «Dauer geschätzt» zum Abhaken,
sobald die echte Zahl da ist.

**Konflikte & Puffer:** Verletzt ein Vorgang eine Abhängigkeit (etwa durch Überlappung),
wird er rot markiert und sagt im Klartext, woran es liegt. Der **Konflikt-Knopf** öffnet
eine **Prüf-Liste**: je Eintrag **Zeigen** (springt hin), **Lösen** (nur diesen auf den
frühestmöglichen Termin) oder **Ist ok** (abhaken). Mouseover und Seitenpanel nennen
den **Puffer** und den **Engpass** (knappste Verknüpfung, z. B. «15 h Luft bis Steelday 2»). „Alle auflösen" bleibt als
Abkürzung. Nichts verschiebt sich hinter deinem Rücken; ein `⌘Z` nimmt jede
Auflösung komplett zurück.

**Untervorgänge:** In der Tabelle legt „+↳" einen einklappbaren Untervorgang an; der
Elternvorgang wird zur **Hülle** (Start/Ende ergeben sich aus den Kindern) und
erscheint im Gantt als Sammelbalken. **Verknüpfen** läuft über ein **Suchfeld** —
tippen filtert die (nach Gewerk gruppierte, chronologische) Trefferliste, statt durch
alle Vorgänge zu scrollen.

## Prüfen

```bash
node tests/run.mjs            # Unit-Tests + statische Prüfungen, ohne Browser
node tools/verify-browser.mjs # Darstellung: App in allen fünf Themes im Browser
node tools/verify-edit.mjs    # Bearbeiten: anlegen, tippen, Undo, Konflikte, Panel, Menü
node tools/verify-live.mjs    # Live-Modus mit gestellter Uhr (page.clock)
node tools/verify-amk.mjs     # AMK-Plan importieren und prüfen
node tools/verify-print.mjs   # Tagesblätter: Zuschnitt, Filter, Maßstab, PDF
node tools/verify-klassentreffen.mjs  # V07-Plan importieren + Negativprüfung «kein mitgelieferter Plan»
node tools/verify-showablauf.mjs      # Showablauf: Ebene, Bühnen, Live-Kopfzeile, Blatt
node tools/verify-pb-regeln.mjs       # Server: Schema, API-Regeln, Hook, Rate Limits (frische lokale PocketBase je Abschnitt)
node tools/verify-mehrbenutzer.mjs    # Anmeldung, Rollen, Realtime, Offline, Mitglieder (zwei Browser; allein laufen lassen)
node tools/make-amk.mjs       # tools/fixtures/amk-singleshow.json (Testdaten) aus den PDF-Daten neu bauen

# gegen die veröffentlichte Seite statt lokal (prüft nur Anmeldeseite und Weiterleitung):
node tools/verify-browser.mjs --base https://callboard.nyxlightwork.de/
# gegen eine laufende PocketBase, nur lesend (Health, Collections, Hook-Route; PB_SU_TOKEN für Einstellungen):
node tools/verify-pb-regeln.mjs --gegen https://api-test.callboard.nyxlightwork.de
```

Alle zehn Skripte plus `tests/run.mjs` müssen grün sein, bevor etwas fertig ist. Die
Browser-Skripte legen ihre Pläne über eine lokale PocketBase an (`tools/pb-lokal.mjs`);
das braucht einmalig Internet für die Binary.

`verify-browser.mjs` braucht einmalig einen Browser: `npx playwright install firefox`.
Er prüft Verhalten (Sticky-Spalten, Zoomstufen, Pfeilgeometrie, Beschriftungen,
Jetzt-Linie, Service Worker) und legt Screenshots unter `tools/shots/` ab.

**Screenshots ansehen, nicht nur Häkchen zählen.** Ein Dutzend echter Fehler hat in
diesem Projekt die automatischen Prüfungen passiert und wurde erst im Bild sichtbar
— zuletzt ein Zoom-Umschalter auf «Monate» über einer Stundenachse und ein
Soundcheck, den die Vorgabe eine Stunde vor den Act setzte statt an den Nachmittag.

## Deploy

```bash
node tools/version.mjs 0.2.0   # eine Nummer, alle Stellen
# CHANGELOG.md füllen
node tests/run.mjs             # prüft, dass nichts auseinanderläuft
git push origin main           # Test: GitHub Pages (~1 Minute), Quelle main / root
git push origin live           # Live: Coolify baut das Dockerfile (nginx), callboard.nyxlightwork.de
```

**Test** (GitHub Pages, API `api-test`) und **Live** (Coolify aus Branch `live`, API
`api`) sind getrennt; der Server-Teil (Migrationen, Hooks, Einstellungen) wird nur vom
Admin eingespielt — Ablauf in [`docs/admin-auftrag-online-phase2.md`](docs/admin-auftrag-online-phase2.md).
Das Image (`Dockerfile`, `nginx.conf`) enthält nur die ausgelieferten Dateien. Danach prüfen:

```bash
node tools/verify-browser.mjs --base https://callboard.nyxlightwork.de/
node tools/verify-pb-regeln.mjs --gegen https://api.callboard.nyxlightwork.de
```

### Warum es einen Service Worker gibt

`index.html` lädt `js/app.js?v=N`, aber `app.js` importiert `./gantt.js` **ohne**
Versionsangabe — und GitHub Pages sendet `cache-control: max-age=600`. Ohne
Gegenmaßnahme kämen Änderungen an den Untermodulen bis zu zehn Minuten lang nicht an,
beim Entwickeln erst nach manuellem Cache-Leeren.

`sw.js` erzwingt deshalb für eigene JS/CSS/HTML eine Revalidierung und **cacht selbst
nichts** — er kann also nie eine alte Version einsperren. Fremde Origins fasst er
nicht an. Ein Kill-Switch steht in der Datei.

Das `?v=` in `index.html` setzt `tools/version.mjs` mit — von Hand hochzählen
ist nicht nötig. Beides zusammen, weil der Service Worker erst ab dem zweiten
Aufruf greift: `?v=` trägt den allerersten Aufruf nach einem Deploy, der Worker
alles danach.

## Aufbau

```
index.html              Die App
login.html              Anmeldung, Passwort, Einladung
print.html              Tagesblätter zum Drucken (liest die lokale Kopie)
js/
  app.js                Einstieg: Projektverwaltung, Speichern, Ansichten
  store.js              Zustand + Befehle + Undo/Redo — DOM-frei
  gantt.js              Render-Engine (DOM, Zoom, Pfeile, Tooltip, Minimap)
  table.js              Tabellen-Editor
  schedule.js           Terminrechnung: CPM, Topo-Sort, Puffer + Engpass — DOM-frei
  conflicts.js          Konflikte, Dauer-Kurzform, Uhrzeit-Eingabe — DOM-frei
  timeaxis.js           Zeit ↔ Pixel, Zoomstufen, Ticks, Kalenderwochen — DOM-frei
  templates.js          Vier Vorlagen (Festival, Tour, Corporate, Messe) + leerer Plan
  persistence.js        localStorage (Token, lokale Kopie), Export/Import, Migration — DOM-frei
  pb.js, server.js      PocketBase-Client (Anmeldung, Token) · Plan lesen/senden mit rev, Realtime, Warteschlange — DOM-frei
  aenderungen.js        Änderungsliste je Store-Befehl (anlegen/ändern/löschen je Collection) — DOM-frei
  rechte.js, konflikt.js  Rechte-Vorabprüfung nach Rolle · Konfliktauflösung beim Senden — DOM-frei
  mitglieder.js         Dialoge «Mitglieder…» und «Verwaltung…» (Logik: mitglieder-logik.js, DOM-frei)
  login.js              login.html: Anmelden, Passwort vergessen, Einladung annehmen
  palette.js            Gewerk-Farben: 10 Töne × 2 Schraffuren = 20 Plätze
  ebene.js              Ansichten: Bänder, Abschnitt, Showtage, Zeitfenster — DOM-frei
  resources.js          Personal & Maschinen: Bezeichnungen, Deckung, Bedarfsraster — DOM-frei
  live.js               Verzug + laufende Vorgänge — DOM-frei
  inspector.js          Seitenpanel (mit Verknüpfungs-Suche)
  menu.js               Kontextmenü — trägt auch die Tageswahl
  rail.js               Die Schiene links: der Modus, drei Einträge
  bedarf.js             Bedarfsansicht: Personal- oder Maschinenbedarf, mit «Offene Bedarfe» (⏳ bestätigen/ablehnen)
  print.js              Tagesblätter (A3 quer) — eigene Seite, print.html
styles/
  base.css              Nur Geometrie + Verhalten. Dazu die Gewerk-Farben.
  print.css             Blattgeometrie in mm, @page A3 quer
  themes/*.css          Fünf Gestaltungsebenen; callboard ist aktiv
tests/                  Unit-Tests + statische Prüfungen
pocketbase/             Server-Teil: Migrationen, Hooks, setup.mjs, schema.json
Dockerfile, nginx.conf  Live-Image (Coolify, Branch live)
tools/
  verify-browser.mjs    Verhaltensprüfung im echten Browser
  pb-lokal.mjs          lokale PocketBase für die Prüfskripte
docs/                   Entscheidungen, Themes, Farbsuche
```

Alles Rechnende ist bewusst frei von DOM-Bezügen und damit direkt testbar —
Fehler im Backward-Pass oder im Undo-Stapel sind visuell unsichtbar und
produzieren trotzdem falsche Termine.

## Bevor du etwas änderst

Lies **[docs/entscheidungen.md](docs/entscheidungen.md)**. Kurzfassung der Fallen:

- **Gewerk-Farben nicht per Hand ändern.** Reihenfolge und Zuordnung sind gerechnet
  (720 Varianten durchprobiert), nicht ausgesucht.
- **Balkenbeschriftung nicht entfernen.** Drei Farben liegen unter 3:1 Kontrast;
  die Beschriftung ist die vorgeschriebene sekundäre Kodierung.
- **Zoomstufen werden in sichtbarer Zeitspanne gemessen**, nicht in Pixeln. Die
  Tests setzen das durch.
- **Zeiten immer aus echten Zeitstempeln rechnen**, nie aus Datumsstrings — sonst
  ist die Dauer über den Sommerzeit-Sprung falsch.

## Themes

Fünf fertige Ebenen, aktiv ist `callboard` (NYX-Navy-CI: Navy/Paper, eigene
Schriften). **Hell/Dunkel** schaltet ein Knopf im Kopf (☾/☀, gemerkt in
`bzp_mode`). Der Wechsel der Theme-**Familie** ist verdrahtet, aber noch nicht als
Knopf gebaut — siehe **[docs/themes.md](docs/themes.md)**.

## Fahrplan

| | |
|---|---|
| ✅ | Darstellung: Gantt, vier Zoomstufen, Abhängigkeiten, Puffer/Engpass |
| ✅ | Befüllen & Bearbeiten: Vorlagen, Tabelle, Konflikte, Undo, Speichern |
| ✅ | Live-Modus: Zeitlinie läuft, Verzug, laufende Vorgänge · Panel · Rechtsklick-Menü |
| ✅ | Gewerke per Drag & Drop · gleiche Reihenfolge Gantt = Tabelle (nach Start) |
| ✅ | Untervorgänge (Eltern = Hülle, einklappbar) · Handy/Tablet-tauglich |
| ✅ | Prüf-Liste (Konflikte sehen/zeigen/abhaken) · Verknüpfungs-Suche |
| ✅ | Tagesblätter zum Drucken (ein A3 quer je Tag) |
| ✅ | Showablauf: Bühnen, Anforderungen/Material, Live-Kopfzeile, Running-Order-Blatt |
| ✅ | Setup und Show als eigene Ansichten · Soundchecks als Zeiteinträge mit Balken |
| ✅ | Farbe je Zeiteintrag (zehn Töne × Schraffur), Schrift auf der Farbe gerechnet |
| ✅ | Verknüpfen per Ziehen · Pfeile anklickbar (Typ, Versatz, `Entf`) |
| ✅ | Live-Versatz: «wir hängen 5 Minuten hinterher», der Ablauf rutscht, die Uhr nicht |
| ✅ | Eigene Arten für Zeiteinträge, je Art die Blattzeile wählbar |
| ✅ | Eigene Abschnitte (Load-in, Soundcheck, Aftershow …) |
| ✅ | Arten und Abschnitte verwalten: umbenennen, sortieren, löschen |
| ✅ | Personal & Maschinen je Vorgang, Bereitstellungen, Bedarfsraster nach Tag/Stunde, Bedarfsstatus ⏳ ✓ ✕ und Übersicht «Offene Bedarfe» |
| ✅ | Zwei getrennte Modi: die Schiene links, je Modus nur seine eigenen Knöpfe |
| ✅ | «Einrichten» als eigene Seite (fünf Bereiche, geführter Erststart) · Tageswahl nur über Tage, die es gibt |
| → | Drag & Drop der Balken im Gantt: Balken ziehen, Dauer ziehen |
| | Ansichten & Export: öffentlicher Link, PDF/ICS |
| ✅ | Online: PocketBase, Anmeldung, Rollen, Realtime, Mitglieder, Offline nur Ansicht (Branch `online`, Live nach Freigabe) |

**Zu den Vorlagen:** «Festival» ist abgenommener Praxisstand. Tour, Corporate und
Messe sind entworfene Gerüste — richtige Gewerke und Meilensteine, aber keine
erfundenen Detailvorgänge. Korrigier sie beim ersten echten Einsatz.

**Beispielplan Klassentreffen:** `tools/fixtures/klassentreffen-festival.json` (Testdaten für die Prüfskripte) bildet den
**Bauzeitenplan V07 (Stand 25.08.2026)** ab — 20 Gewerke, 353 Vorgänge über
14 Tage, quellentreu bis auf 19 Zeilen, die im Original ohne Uhrzeit gedruckt
sind (gestrichelte Kante, Grund in der Notiz). Neu gebaut wird er mit
`node tools/make-klassentreffen.mjs` nach `tools/fixtures/`; die Quelle steht Zeile für Zeile in
diesem Werkzeug. **Keine Verknüpfungen** — V07 ist ein terminierter Kalender,
und erfundene Abhängigkeiten erzeugten rote Konflikte ohne Wirklichkeitsbezug.

Dazu die **Running Order** beider Showtage (Stand 05.08.2026, 32 Zeiteinträge
auf der Hauptbühne) für die Showablauf-Ebene. Anforderungen und Material bleiben
dort leer — die trägt man von Hand ein, dafür ist die Ansicht da.
