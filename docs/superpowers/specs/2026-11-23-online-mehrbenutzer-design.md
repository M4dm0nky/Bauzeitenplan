# Bauzeitenplan online — mehrere Benutzer, Rollen, gleichzeitiges Arbeiten

**Stand:** 2026-11-23 · **Status:** Entwurf zur Freigabe durch Marco
**Server-Grundlage:** `docs/admin-auftrag-online-phase1.md` (beim Admin)

## 1. Absicht und Warum

Externe Leute (Gewerke, Produktionsleitungen, Bearbeiter) sollen an Plänen
mitarbeiten — **ohne** dass man ihnen erklären muss, ein GitHub-Token einzutragen.
Der heutige GitHub-Sync gleicht nur Marcos eigene Geräte ab; ein Token im Plan
oder Link wäre öffentlich lesbar und gäbe jedem Schreibrechte aufs Daten-Repo.

Darum: **Anmeldung mit eigenem Zugang**, Pläne auf einem eigenen Server
(PocketBase auf Coolify, wie beim Crewplaner — als **komplett getrenntes Projekt**,
nichts wird mit dem Crewplaner geteilt). Mehrere Leute können **gleichzeitig** am
selben Plan arbeiten und sehen die Änderungen der anderen sofort.

## 2. Ziele

1. Anmeldung per E-Mail + Passwort; Zugang nur per Einladung.
2. Fünf Rollen (Abschnitt 5), **serverseitig durchgesetzt**.
3. Gleichzeitiges Arbeiten: Änderungen erscheinen bei allen anderen live; Konflikt
   nur, wenn zwei Leute **denselben** Eintrag gleichzeitig ändern — dann Rückfrage,
   nie stilles Überschreiben.
4. Offline: Plan **ansehen** geht weiter (auch Live-Monitor + Jetzt-Linie),
   **bearbeiten nicht**.
5. Bestehende Pläne (JSON-Export) lassen sich in den Server übernehmen.
5a. Gewerkeleiter fragen Bedarf an Helfern/Maschinen an; die Produktionsleitung
    bestätigt oder lehnt ab (Abschnitt 9a).
6. Test und Live getrennt: GitHub Pages → Test-PocketBase, `callboard.nyxlightwork.de`
   → Live-PocketBase, Wahl automatisch nach Hostname.

## 3. Nicht-Ziele (jetzt nicht)

- Offline **bearbeiten** und später hochladen (bewusst abgewählt).
- Gemeinsamer Versatz/Delay über Geräte hinweg (bleibt wie heute je Gerät).
- Änderungsverlauf / «wer hat was geändert» als eigene Ansicht.
- Selbstregistrierung.
- Touch-/Handy-Bedienung als Anforderung (gilt weiterhin nicht).

## 4. Anti-Ziele (wäre ein Fehlschlag, auch wenn es technisch läuft)

- Rollen nur in der Oberfläche versteckt, Server nimmt trotzdem alles an.
- Eine Person überschreibt still die Arbeit einer anderen.
- ⌘Z nimmt die Änderung eines **anderen** Benutzers zurück.
- Der Live-Monitor an der Wand wird schwarz/leer, weil das WLAN wegbricht.
- Irgendetwas wird mit dem Crewplaner geteilt (Instanz, Collections, Schlüssel, Mail).
- Ein Token oder Passwort im Repo, im Plan oder im Export.

## 5. Rollen (von Marco festgelegt)

| Rolle | Geltung | Darf |
|---|---|---|
| **Superadmin** | global | alles über alle Pläne; Produktionsleitungen ernennen/entziehen |
| **Produktionsleitung** | global (darf anlegen) + eigene Pläne | Pläne anlegen; in eigenen Plänen alles, inkl. Mitglieder einladen/entfernen und Rollen vergeben |
| **Bearbeiter** | je Plan | alles **in** dem Plan (Vorgänge, Phasen, Gewerke, Zeitraum, Listen), keine Mitglieder verwalten |
| **Gewerkeleiter** | je Plan + Gewerk(e) | in seinem Gewerk alles; den Rest nur sehen |
| **Betrachter** | je Plan | nur sehen |

**Entscheidungen von Claude (von Marco korrigierbar):**
- Die Rolle gilt **je Plan**: dieselbe Person kann in Plan A Gewerkeleiter Licht und
  in Plan B Betrachter sein. Grund: Externe arbeiten je Veranstaltung in anderer Funktion.
- Ein Gewerkeleiter kann **mehrere Gewerke** haben (Licht + Video). Bühnen
  (Gewerk mit `art:'buehne'`, Showablauf) zählen dabei als Gewerk.
- «In seinem Gewerk alles» heißt: Vorgänge mit `gewerk ∈ seine Gewerke` anlegen,
  ändern, verschieben, löschen, duplizieren; **Bedarf an Helfern und Maschinen**
  an diesen Vorgängen anlegen und ändern (Abschnitt 9a). Sein eigenes Personal
  bringt er selbst mit; es kommt im Plan nicht vor (Marco).
  Er darf **neue Bezeichnungen** für Helfer/Maschinen anlegen, aber keine
  umbenennen, umsortieren oder löschen (Marco). **Nicht:** Zeitraum, Phasen,
  Gewerke-Liste (anlegen, umbenennen, Farbe, Reihenfolge), Auswahllisten
  `punktTypen`/`abschnitte`, Plan verschieben (`shiftPlan`), Vorgänge mit
  `gewerk:'projekt'`, Bedarf bestätigen.
- Verknüpfungen: ein Gewerkeleiter darf eine Verknüpfung anlegen/ändern/löschen,
  wenn der **Nachfolger** in seinem Gewerk liegt (er bestimmt, worauf er wartet,
  nicht, worauf andere warten).
- Die Produktionsleitung, die einen Plan anlegt, ist dessen **Besitzer**. Weitere
  Produktionsleitungen kann sie als Mitglied mit Rolle «Produktionsleitung» in den
  Plan holen (gleiche Rechte im Plan).
- Ohne Anmeldung sieht niemand etwas.

## 6. Ansätze

**A — Plan in Einzelteile auf dem Server (gewählt von Marco).** Jeder Vorgang, jede
Phase, jedes Gewerk, jede Verknüpfung ist ein eigener PocketBase-Datensatz. Rechte
prüfen die API-Regeln je Datensatz; Änderungen kommen per PocketBase-Realtime zu
allen. Mehr Umbau (neue Speicherschicht, Undo nur eigene Schritte), aber sichere,
einfache Rechte und kleine Datenmengen.

**B — Plan als ein Block mit automatischem Zusammenführen (verworfen).** Weniger
App-Umbau, aber die Rollenprüfung müsste serverseitig den ganzen Plan diffen
(fehleranfällig), und jeder Klick schickte den ganzen Plan (Klassentreffen ≈ 230 KB).

**C — Nur einer bearbeitet gleichzeitig (verworfen).** Widerspricht «gleichzeitig».

## 7. Datenmodell (Server)

Alle ids als **Text**, nie als Relation (Crewplaner-Lehre). E-Mails `.toLowerCase()`.

| Collection | Inhalt | Schlüsselfelder |
|---|---|---|
| `users` (Auth) | Konten | `email`, `name`, `superadmin` (bool), `produktionsleitung` (bool) |
| `plaene` | ein Datensatz je Plan | `plan_id` (= `project.id`), `besitzer` (user-id), `project` (JSON: `name, venue, start, end, timezone, punktTypen, abschnitte`), `rev` |
| `ressourcen` | Bezeichnungen Helfer/Maschinen (heute `project.ressourcen`) | `plan_id`, `rid`, `name`, `kind` (`personal`\|`maschine`), `sort`, `rev` |
| `mitglieder` | Rolle je Person und Plan | `plan_id`, `user_id`, `rolle` (`produktionsleitung`\|`bearbeiter`\|`gewerkeleiter`\|`betrachter`), `gewerke` (JSON-Liste von Gewerk-ids) |
| `gewerke` | Bänder/Bühnen | `plan_id`, `gid` (heutige id), Felder wie heute (`name, art, slot, sort`), `rev` |
| `vorgaenge` | Vorgänge | `plan_id`, `tid`, alle heutigen Task-Felder, `rev` |
| `phasen` | Phasen | `plan_id`, `pid`, Felder wie heute, `rev` |
| `verknuepfungen` | Abhängigkeiten | `plan_id`, `did`, `from`, `to`, Felder wie heute, `rev` |
| `einladungen` | offene Einladungen | `plan_id`, `email`, `rolle`, `gewerke`, `token`, `ablauf` |

Die heutigen Felder sind die aus `serialize()`: `project` (9 Felder), `gewerke`,
`tasks`, `deps`, `phases`. **Jedes Feld, das `addTask` kennt, muss als Spalte (oder
im JSON-Feld) ankommen** — sonst fällt es still weg (Projektregel).

`rev` ist ein Zähler je Datensatz für die Konfliktprüfung (Abschnitt 9).

### API-Regeln (Grundzug)

- **Lesen** (`list/view`) aller Plan-Collections: Superadmin ODER Mitglied des Plans
  (beliebige Rolle) ODER Besitzer.
- **Schreiben `vorgaenge`:** Superadmin, Besitzer, Mitglied mit Rolle
  `produktionsleitung`/`bearbeiter`, ODER `gewerkeleiter` mit `gewerk` (alt **und**
  neu) in seinen `gewerke` und `gewerk != 'projekt'`.
- **Schreiben `verknuepfungen`:** wie oben; Gewerkeleiter nur, wenn der Nachfolger
  (`to`) in seinem Gewerk liegt.
- **Schreiben `plaene`, `gewerke`, `phasen`:** Superadmin, Besitzer,
  `produktionsleitung`, `bearbeiter`.
- **`ressourcen`:** anlegen zusätzlich `gewerkeleiter`; ändern/löschen nur
  Superadmin, Besitzer, `produktionsleitung`, `bearbeiter`.
- **Bedarfsstatus** (Abschnitt 9a) setzen auf `bestaetigt`/`abgelehnt`: nur
  Superadmin, Besitzer, `produktionsleitung` — der Hook vergleicht dazu je
  Bedarfszeile in `vorgaenge.res` alt gegen neu.
- **`mitglieder`, `einladungen`:** Superadmin, Besitzer, `produktionsleitung` des Plans.
- **`plaene` anlegen:** Superadmin oder `users.produktionsleitung = true`.
- **`users.superadmin`/`produktionsleitung` setzen:** nur Superadmin (Hook/Regel).

Was eine reine Regel nicht abbildet (z. B. «Nachfolger liegt in meinem Gewerk»),
prüft ein **Hook** (`pb_hooks/main.pb.js`). Der Hook führt auch die
**CORS-Positivliste** (Test: `https://m4dm0nky.github.io`, `http://localhost:8080`;
Live: `https://callboard.nyxlightwork.de`).

## 8. App-Aufbau

Der **Store bleibt der einzige Weg, den Plan zu ändern**; der Store bleibt DOM-frei.
Neu kommt eine Schicht **zwischen** Store und Server:

1. **Änderungen ausrechnen:** Nach jedem Befehl vergleicht ein DOM-freies Modul
   (`js/aenderungen.js`) den Zustand vor/nach dem Befehl je Collection nach id und
   liefert `{ anlegen, aendern, loeschen }` je Collection. Damit muss nicht jeder der
   ~30 Store-Befehle einzeln eine Server-Abbildung bekommen.
2. **Rechte vorab prüfen:** Dasselbe Modul (oder `js/rechte.js`, DOM-frei) prüft die
   Änderungsliste gegen die eigene Rolle **bevor** der Store sie annimmt. Abgelehnt →
   nichts passiert (kein Undo-Eintrag, keine Ungesichert-Marke), Hinweis
   «Nur Licht darfst du ändern». Der Server prüft unabhängig davon noch einmal.
3. **Senden:** `js/persistence-pb.js` schickt die Änderungen gebündelt (PocketBase
   Batch-API) mit `rev`-Prüfung.
4. **Empfangen:** Realtime-Abo auf alle Plan-Collections mit `plan_id`. Fremde
   Änderungen fließen über einen eigenen Store-Weg (`applyRemote`) ein: **kein**
   Undo-Eintrag, keine Ungesichert-Marke, Darstellung aktualisiert sich.
5. **Abgeleitete Werte** (Sammelvorgangs-Hülle `reflowParents`, Puffer, Engpass)
   rechnet jeder Client selbst; sie werden **nicht** als Änderung eines fremden
   Vorgangs gesendet. (Siehe offener Punkt O-2.)
6. **Undo nur eigene Schritte:** Undo sendet die **Umkehrung der eigenen
   Änderungsliste** statt einen ganzen Schnappschuss zurückzuspielen. Hat inzwischen
   jemand anders denselben Eintrag geändert (`rev` weiter), fragt die App per
   `askDialog`, statt zu überschreiben.

Bestehende Module: `persistence.js` (localStorage, Export/Import) bleibt für die
Offline-Kopie und den JSON-Export. Der Branch `pocketbase-vorbereitung` (Stand
v0.7.1: `pb.js`, `auth.js`, `session.js`, `roles.js`, `login.html`, `admin.html`,
`setup.mjs`) dient als **Vorlage**, nicht als Merge-Basis — die App ist seither
bei 0.24.1.

## 9. Gleichzeitiges Arbeiten und Konflikte

- Jeder Datensatz hat `rev`. Senden heißt «ändere, **wenn** `rev` noch X ist»
  (Hook prüft, erhöht `rev`).
- Passt `rev` nicht → jemand anders war schneller. Die App holt den aktuellen Stand
  dieses Eintrags und fragt per `askDialog`:
  «Licht-Aufbau wurde gerade von Anna geändert» → **Ihre Fassung nehmen** /
  **Meine behalten** / Abbrechen. Nie still.
- Gelöscht während ich ändere → Rückfrage «… wurde von Anna gelöscht» →
  Wiederherstellen / Verwerfen.
- Änderungen an **verschiedenen** Einträgen kollidieren nie.

## 9a. Bedarf anfragen und bestätigen (neu, von Marco gewünscht)

Heute ist Bedarf eine Zuweisung am Vorgang: `t.res = [{rid, n, von, bis}]`
(z. B. 4× Helfer 08–14 Uhr). Neu bekommt jede Bedarfszeile einen **Status**:

| Status | wer setzt | Bedeutung |
|---|---|---|
| `angefragt` | automatisch beim Anlegen/Ändern | Gewerk braucht das, noch nicht gebucht |
| `bestaetigt` | Produktionsleitung / Superadmin | gebucht, kommt |
| `abgelehnt` | Produktionsleitung / Superadmin | kommt nicht; optional mit kurzer Notiz |

- Neues Feld je Bedarfszeile: `status` (fehlt = `angefragt`, auch für importierte
  Altpläne), optional `notiz`, `bestaetigtVon`, `bestaetigtAm`. Das Feld muss
  durch `addTask`/`setTaskRes`, Export/Import und `migrate` (idempotent).
- **Ändert jemand Anzahl oder Zeit** einer bestätigten Zeile, fällt sie zurück auf
  `angefragt` (sonst wäre «bestätigt» eine Lüge).
- **Produktionsleitung:** Übersicht «Offene Bedarfe» (alle `angefragt` des Plans,
  nach Gewerk und Tag), je Zeile Bestätigen / Ablehnen; gesammelt bestätigen
  möglich. Die vorhandene Bedarfsansicht (`bedarf.js`) zeigt bestätigt/offen
  unterscheidbar (Farbe **und** Symbol, nicht nur Farbe).
- **Gewerkeleiter:** sieht an seinen Vorgängen den Status jeder Zeile (Symbol:
  ⏳ angefragt, ✓ bestätigt, ✕ abgelehnt); kann ihn nicht selbst setzen.
- **Entscheidung Claude:** Bearbeiter bestätigen **nicht** — Marco nannte dafür die
  Produktionsleitung. Bearbeiter können Bedarf anlegen/ändern wie heute.
- Bereitstellungs-Vorgänge (`bereitstellung: true`, Angebot) bleiben wie sie sind;
  der Status betrifft nur Bedarf an normalen Vorgängen.
- Keine Mail-Benachrichtigung in dieser Runde (späterer Ausbau).

## 9b. Eingebaute Helfer und Maschinen, in Kategorien (von Marco festgelegt)

Ersetzt die bisherige Regel «keine eingebauten Bezeichnungen»
(`.claude/rules/personal-maschinen.md`, `docs/entscheidungen.md` nachziehen).

- **Fest eingebaut:** in jedem Plan vorhanden, nicht löschbar, nicht umbenennbar.
  Sie stehen im **Code** (eine Liste wie `PUNKT_TYPEN`, mit festen ids wie
  `m-stapler-bis35`), nicht in den Plandaten; die Collection `ressourcen` hält nur
  **eigene** Einträge. Ein Export bleibt aus sich heraus lesbar, weil die
  eingebauten Namen in jeder App-Version gleich sind (Test hält die ids stabil).
- **Kategorien:** Jede Bezeichnung hat eine Kategorie. Die Auswahl zeigt sie
  **gruppiert** (Kopfzeile je Kategorie, darunter die Einträge; Suche über alles),
  nicht als lange flache Liste. Eigene Einträge wählen beim Anlegen eine Kategorie
  (vorhandene oder «Eigene»).

| Kategorie | Einträge |
|---|---|
| ⚙ Stapler | Gabelstapler bis 3,5 t · Gabelstapler über 3,5 t · Geländestapler bis 3,5 t · Geländestapler über 3,5 t |
| ⚙ Teleskoplader | Teleskoplader starr 7 m · starr 14 m · starr 17 m · Rotor (16–26 m) |
| ⚙ Scherenbühne Halle (Elektro) | 8 m · 10 m · 12 m · 14 m |
| ⚙ Gelände-Scherenbühne (Diesel, Allrad) | 10 m · 12 m · 15 m · 18 m |
| ⚙ Gelenkteleskopbühne | 16 m · 20 m · 26 m |
| ⚙ Sonstige Bühnen | Raupenarbeitsbühne · LKW-Arbeitsbühne |
| ⚙ Sonstiges | Mobilkran · Radlader · Hubwagen |
| 👤 Helfer | Stagehand · Rigger (Höhe) · Ground-Rigger · Staplerfahrer · Elektrofachkraft · Runner |

Höhen = Arbeitshöhe (wie bei Vermietern angegeben). Die alte migrierte Ressource
«Crew» (`rid:'crew'`) bleibt in Altplänen als eigener Eintrag bestehen.

## 10. Offline

- Die App hält je Plan eine **lokale Kopie** (localStorage, wie heute).
- Kein Netz / Server nicht erreichbar → Kopfzeile gelb «Offline – nur Ansicht»;
  alle Bearbeiten-Wege gesperrt (Store lehnt Befehle ab, Ziehen aus, Felder
  schreibgeschützt). Ansicht, Druck, Live-Monitor, Jetzt-Linie laufen weiter.
- Netz wieder da → aktuellen Stand holen, Realtime neu abonnieren, Bearbeiten frei.
- Was im Moment des Abbruchs noch nicht gesendet war: wird beim Wiederverbinden
  gesendet, wenn `rev` passt; sonst Konfliktdialog (Abschnitt 9). Nichts geht still
  verloren.
- Der Service Worker bleibt (network-first); die App-Hülle ist offline startbar,
  der Start zeigt dann die lokale Kopie des zuletzt geöffneten Plans.

## 11. Anmeldung, Einladung, Verwaltung

- **Anmeldeseite** (`login.html` o. ä.): E-Mail + Passwort, «Passwort vergessen»
  (Mail nur auf Live).
- **Einladen** (Produktionsleitung/Superadmin, im Plan unter «Mitglieder»): E-Mail,
  Rolle, ggf. Gewerke → Einladungsmail mit Link. Existiert das Konto schon, wird
  die Person direkt Mitglied. Auf **Test** geht keine Mail raus; der Einladungslink
  wird stattdessen im Dialog angezeigt zum Kopieren.
- **Mitglieder-Verwaltung:** Liste mit Rolle/Gewerke ändern, entfernen.
- **Superadmin-Verwaltung:** Konten, Produktionsleitung an/aus, alle Pläne.
- **Projektdialog** zeigt die Pläne, in denen ich Mitglied bin, mit meiner Rolle.
- **Kein** `confirm`/`alert`/`prompt` — alles über `askDialog` bzw. die eigenen Dialoge.

## 12. Übernahme bestehender Pläne und GitHub-Sync

- **JSON-Import** legt einen neuen Server-Plan an (Besitzer = wer importiert;
  nur Produktionsleitung/Superadmin). Gleiche Prüfung wie heute (`inhaltFehler`).
- **Entscheidung von Claude:** Der GitHub-Sync (`js/sync.js`, Dialog «Speicherort…»)
  **entfällt**, sobald die Server-Fassung live ist — zwei Speicherwege nebeneinander
  wären doppelte Pflege und doppelte Konfliktlogik. Vorher überträgt Marco seine
  Pläne per Import. Der JSON-**Export** bleibt als Sicherung.
- Ein Modus «ohne Anmeldung, nur lokal» entfällt auf beiden Seiten (Test und Live).

## 13. Umgebungen und Auslieferung

| | Test | Live |
|---|---|---|
| Frontend | `m4dm0nky.github.io/Bauzeitenplan` (Branch `main`) | `callboard.nyxlightwork.de` (Branch `live`, Coolify, Auto-Deploy) |
| PocketBase | `api-test.callboard.nyxlightwork.de` | `api.callboard.nyxlightwork.de` |

- Wahl der API **nach Hostname** in einer Stelle (`js/pb.js`).
- Dockerfile + nginx nach Crewplaner-Muster, **nur** ausgelieferte Dateien
  (keine `docs/`, `tools/`, `tests/` — Crewplaner-Audit K-1).
- `tools/version.mjs` und die Versionsprüfung kennen jede neue HTML-Seite
  (`login.html`, ggf. `admin.html`); `HUELLE` in `sw.js` gepflegt.
- Go-Live = `git push origin main:live` nach Marcos Freigabe.
- Schema als JSON-Export im Repo (`pocketbase/schema.json`), Hook in
  `pocketbase/pb_hooks/main.pb.js`; eingespielt vom Admin über einen
  Phase-2-Auftrag (`docs/admin-auftrag-online-phase2.md`).
- Bis der Admin fertig ist: Entwicklung und Tests gegen eine **lokale**
  PocketBase (Binary, headless), gestartet/beendet von den Prüfskripten.

## 14. Prüfung

- Unit-Tests (DOM-frei): Änderungsliste (`aenderungen.js`), Rechte (`rechte.js`) mit
  allen fünf Rollen × Collection × Aktion, Undo-Umkehrung, `rev`-Konflikt.
- **Regeltest gegen echte lokale PocketBase:** je Rolle erlaubte UND verbotene
  Schreibzugriffe direkt per API (nicht über die UI) — z. B. Gewerkeleiter Licht
  ändert Ton-Vorgang → 403/400; Gewerkeleiter setzt Bedarf auf `bestaetigt` →
  abgelehnt; Gewerkeleiter legt Bezeichnung an → ok, benennt sie um → abgelehnt.
- Bedarfsstatus: Rückfall auf `angefragt` bei Änderung von Anzahl/Zeit (Unit-Test),
  Altplan ohne `status` importiert → `angefragt`.
- `tools/verify-mehrbenutzer.mjs`: zwei Browser, zwei Konten, gleicher Plan —
  Änderung erscheint beim anderen; gleicher Vorgang gleichzeitig → Konfliktdialog;
  Undo nimmt fremde Änderung nicht zurück; Offline → «nur Ansicht», Wiederverbinden.
- Die bestehenden neun verify-Skripte laufen weiter grün (sie seeden Pläne heute
  per `tools/plan-fixture.mjs` — müssen sie künftig gegen die lokale PocketBase
  seeden oder einen Testmodus nutzen; siehe O-4).
- Sperren: kein Token/Passwort in Repo/Export; kein `fetch` einer Plan-`.json`;
  kein Browser-Standarddialog.

## 15. Klärungen aus der Umsetzer-Prüfung

- **Wo Personal/Maschinen liegen (aus dem Code):** Die *Liste* der Bezeichnungen
  steht heute in `project.ressourcen` (→ eigene Collection `ressourcen`, damit
  Gewerkeleiter anlegen dürfen); die *Zuordnung* am Vorgang
  steht in den Vorgangsfeldern (`res`, `bereitstellung`, `anforderungen`,
  `material`, `kontakt`, `status`, `progress`, `ackCrit`, `ackConflictMin` …) →
  `vorgaenge`. Ein Gewerkeleiter schreibt also `vorgaenge` (eigene Gewerke) und
  legt höchstens neue `ressourcen` an.
- **Live-Monitor (Entscheidung Claude):** eigenes Konto mit Rolle Betrachter für das
  Monitor-Gerät; Token-Laufzeit lang einstellen und vor Ablauf automatisch
  erneuern (`authRefresh`). Scheitert das, zeigt der Monitor **weiter die lokale
  Kopie** mit Hinweis «Anmeldung abgelaufen», nie eine leere Seite oder nur die
  Anmeldeseite. Token nur im Gerät (localStorage), nie in Repo/Export.
- **Gewerk löschen** (nur Bearbeiter+): die betroffenen Vorgänge/Verknüpfungen gehen
  im **selben Batch** mit — wie heute `removeGewerk`. Der Hook prüft, dass kein
  Vorgang auf ein unbekanntes Gewerk und keine Verknüpfung auf einen unbekannten
  Vorgang zeigt.
- **Erster Superadmin (Entscheidung Claude):** Marcos Konto legt ein Seed-Skript
  (`pocketbase/setup.mjs`) mit dem Superuser-Zugang an; Phase-2-Auftrag ruft es auf.
- **Einladung annehmen (Entscheidung Claude):** eigene Seite im Frontend
  (Einladungslink → Name + Passwort setzen → Konto anlegen per Hook, Mitglied
  werden). Bestehendes Konto → nach Anmeldung direkt Mitglied.
- **Import erzeugt immer eine neue Plan-id** (Entscheidung Claude); Vorgangs-,
  Gewerk-, Phasen- und Verknüpfungs-ids bleiben je Plan gültig (Schlüssel ist
  immer `plan_id` + id).
- **GitHub-Sync-Ausbau (Entscheidung Claude):** bis zum Live-Gang bleibt die heutige
  lokale App unverändert auf `main`; die Server-Fassung entsteht auf einem
  Feature-Branch und wird bis dahin über `localhost:8080` gegen die Test-PocketBase
  geprüft (CORS erlaubt localhost). Mit dem Live-Gang wird der Branch gemergt:
  `callboard.nyxlightwork.de` geht live, GitHub Pages wird ab da zur Testseite,
  Sync und lokaler Modus entfallen in einem Schritt.

## 16. Offene Punkte für den Umsetzer

- **O-1** Feldweise vs. datensatzweise Konfliktauflösung: datensatzweise reicht
  (Entscheidung Claude), feldweises Zusammenführen ist ein späterer Ausbau.
- **O-2** Sammelvorgänge: Liegt ein Sammelvorgang in einem anderen Gewerk als seine
  Kinder, darf die abgeleitete Hülle nicht als «fremde Änderung» abgelehnt werden.
  Vorschlag: Hülle nur clientseitig ableiten und nicht speichern, oder serverseitig
  vom Hook neu berechnen. Umsetzer entscheidet nach Lesen von `reflowParents`.
- **O-3** `shiftPlan` (ganzen Plan verschieben) erzeugt viele Änderungen → Batch;
  nur Bearbeiter+.
- **O-4** Wie die neun bestehenden verify-Skripte künftig zu Plänen kommen.
- **O-5** Reihenfolge der Umsetzung in Teilschritten, jeder für sich lauffähig.
