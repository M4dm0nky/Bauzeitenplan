# Rückmeldung: Bauzeitenplan online, Phase 1 (Server-Grundlage)

**An:** Marco · **Von:** Server-Admin (Robs) · **Stand:** 2026-11-23
**Bezug:** [`admin-auftrag-online-phase1.md`](admin-auftrag-online-phase1.md)

Phase 1 ist bis auf zwei Punkte erledigt: **Superuser** und **Mailversand**. Beides ist bewusst
offen (siehe unten). Kein bestehender Dienst wurde verändert, es gab keinen Ausfall. Der Crewplaner ist
unverändert, gemessen vor und nach jedem Schritt.

## Ergebnis

| | TEST | LIVE |
|---|---|---|
| Domain | `https://api-test.callboard.nyxlightwork.de` | `https://api.callboard.nyxlightwork.de` |
| PocketBase-Image (Tag) | `ghcr.io/coollabsio/pocketbase:0.40.6` | `ghcr.io/coollabsio/pocketbase:0.40.6` |
| Container-Name | `pocketbase-7r9smcixas5kqgwlrm8giewf` | `pocketbase-3tnkcl0pwfilttoxpux8hfmw` |
| Daten-Volume (Pfad auf dem Server) | `/var/lib/docker/volumes/7r9smcixas5kqgwlrm8giewf_pocketbase-data/_data` → im Container `/app/pb_data` | `/var/lib/docker/volumes/3tnkcl0pwfilttoxpux8hfmw_pocketbase-data/_data` → `/app/pb_data` |
| Hooks-Volume (Pfad auf dem Server) | `/var/lib/docker/volumes/7r9smcixas5kqgwlrm8giewf_pocketbase-hooks/_data` → `/app/pb_hooks` | `/var/lib/docker/volumes/3tnkcl0pwfilttoxpux8hfmw_pocketbase-hooks/_data` → `/app/pb_hooks` |
| Superuser-E-Mail | **noch keiner**, siehe „Offen“ | **noch keiner** |
| Mailversand (A/B, Absender) | — (kein SMTP, bewusst) | **offen**, geplant Variante A, siehe „Offen“ |
| CORS gelöst über | Traefik-Datei `bauzeitenplan-pb.yaml` | Traefik-Datei `bauzeitenplan-pb.yaml` |
| Backups (wie, wohin) | — | täglich 03:02, `sqlite3 .backup` + `integrity_check`, 7 Tage, `/root/backups/bauzeitenplan-pb/` |
| `/api/health` = 200 | ☑ | ☑ |

Weitere Eckdaten:
- **Coolify:** Projekt `callboard`, Environment `production`, Services `callboard-pb-test` und
  `callboard-pb-live`.
- **TLS:** Let's Encrypt, gültig bis 21.02.2027, erneuert sich automatisch. `http://` leitet auf
  `https://` um.
- **DNS:** A-Records für `api.callboard` und `api-test.callboard`. Kein AAAA, siehe unten.
- **Ausfall:** keiner.

## Was ich anders gemacht habe als im Auftrag, und warum

1. **Volumes auf `/app/pb_data` und `/app/pb_hooks`, nicht auf `/pb_data` und `/pb_hooks`.** Das Image
   `coollabsio/pocketbase` arbeitet unter `/app`, so wie beim Crewplaner. Es deklariert selbst
   **kein** Volume. Mit `/pb_data` hätte die Datenbank im Container gelegen und wäre beim ersten
   Redeploy gelöscht worden. Die Volume-Namen setzt Coolify selbst, mit der Service-UUID davor.
   Eigene Namen wie `bauzeitenplan-pb-test-data` lassen sich dort nicht vergeben.
2. **Kein AAAA-Record.** Die Server-Firewall lässt über IPv6 bewusst nichts durch. Mit einem
   AAAA-Record wären die APIs für IPv6-Nutzer nicht erreichbar. Clients aus reinen IPv6-Netzen kommen
   über das NAT64 ihres Providers trotzdem an.
3. **Kein neues Coolify-Projekt „Bauzeitenplan“.** Das Projekt `callboard` mit der heutigen statischen
   Seite auf `callboard.nyxlightwork.de` gab es schon. Ein zweites Projekt hätte in Phase 2 zwei Apps
   auf derselben Domain bedeutet. Robs hat entschieden, das bestehende Projekt weiterzuentwickeln. Es
   ist genauso vollständig vom Crewplaner getrennt.
4. **Port 8080.** Das Image lauscht auf 8080, nicht auf 8090.
5. **Zusätzlich ein NullMX auf `callboard.nyxlightwork.de`** (`MX 0 .`), wie beim Crewplaner. Die
   Domain hat einen A-Record. Ohne MX würde Mail an `…@callboard.nyxlightwork.de` laut Standard an den
   Server zugestellt. Mit NullMX wird sie sofort abgewiesen. Den **Versand** über Resend stört das
   nicht, der läuft über `send.callboard`.

## CORS – bitte für Phase 2 beachten

Die Traefik-Datei lässt nur diese Origins zu:

| Instanz | erlaubte Origins |
|---|---|
| TEST | `https://m4dm0nky.github.io`, `http://localhost:8080` |
| LIVE | `https://callboard.nyxlightwork.de` |

Methoden `GET, POST, PATCH, DELETE, OPTIONS`, Header `Authorization, Content-Type`.

**Eine Sache wirkt anders als beim Crewplaner.** Beim Test hat sich gezeigt, dass die Traefik-Regel
allein nur die **Vorabfrage** sperrt. Bei einfachen `GET`s ohne Login kam weiter PocketBases
`Access-Control-Allow-Origin: *` durch. Beim Crewplaner fängt das der Hook ab. Die Datei entfernt
deshalb zusätzlich PocketBases `*`, und Traefik setzt die Origin danach nur für die Positivliste neu.

Gemessen von außen:

| Anfrage | Antwort |
|---|---|
| erlaubte Origin (Vorabfrage, GET, POST, auch Fehlerantworten wie 400) | `Access-Control-Allow-Origin: <diese Origin>` |
| fremde Origin | kein `Access-Control-Allow-Origin` |
| ohne Origin (curl, Server-zu-Server) | kein `Access-Control-Allow-Origin`, Daten kommen normal |

**Für den Hook in Phase 2 heißt das:** Traefik hat das letzte Wort. Ein CORS-Header aus dem Hook für
eine Origin, die **nicht** in der Traefik-Liste steht, wird entfernt. Kommt eine neue Origin dazu,
zum Beispiel ein anderer Port für die lokale Entwicklung, muss sie **an beiden Stellen** eingetragen
werden. Für die Traefik-Seite reicht eine kurze Nachricht an den Admin.

Prüfen kannst du es jederzeit selbst:
```bash
for o in https://m4dm0nky.github.io https://boese.example; do printf "%-28s " $o
  curl -s -D - -o /dev/null https://api-test.callboard.nyxlightwork.de/api/health -H "Origin: $o" \
  | grep -i "^access-control-allow-origin" || echo "(kein Header)"; done
```
Erwartet ist: die erlaubte Origin kommt zurück, die fremde zeigt `(kein Header)`, und es kommt nie `*`.

## Version 0.40.6, nicht 0.39.9

Der Crewplaner läuft noch auf 0.39.9. Für das neue Projekt haben wir 0.40.6 genommen, weil 0.40.5 und
0.40.6 Sicherheitsfixes enthalten (`net/http`-DoS, kompromittierte CA).

- **Hook-Runtime:** Die Release Notes von 0.39.10 bis 0.40.6 nennen keine Breaking Changes. Die
  einzige inkompatible Änderung betrifft den Exit-Code von CLI-Befehlen.
- **Bekannte Fallen aus dem Crewplaner** solltest du trotzdem im Kopf behalten. Jeder Handler läuft
  isoliert und sieht keine Top-Level-Funktionen, und `record.originalCopy()` heißt jetzt `original()`.
  Echte Laufzeitfehler stehen nur in `_logs` in `auxiliary.db`, nicht im Container-Log.

## Offen

1. **Superuser:** Für beide Instanzen ist bewusst noch keiner angelegt (Entscheidung Robs, kommt,
   wenn es soweit ist).
   - Bis dahin zeigt `/_/` die Installationsseite. Die funktioniert nur mit einem Einmal-Link, der
     ausschließlich im Container-Log steht. Über das Netz kann also niemand einen Superuser anlegen,
     gemessen: 403.
   - Die Passwörter bekommst du von Robs auf getrenntem Weg, nicht über GitHub.
   - Danach setze ich die Einstellungen aus dem Auftrag: Application name und URL, Rate limiting.
2. **Mailversand LIVE:** geplant wie beim Crewplaner, also Variante A.
   - Resend-SMTP in PocketBase, Absender `no-reply@callboard.nyxlightwork.de`.
   - Dafür muss die Domain im Resend-Dashboard angelegt werden. Ihre DNS-Records (DKIM, SPF,
     DMARC) trage ich danach ein.
   - Variante A ist hier nötig, weil „Passwort vergessen“ eine Mail ist, die PocketBase selbst
     verschickt. Sie läuft nur über die SMTP-Einstellungen in PocketBase, nicht über einen
     `RESEND_KEY` im Hook.
   - Die Testmail an dich folgt, sobald das steht.
3. **Backups liegen nur auf dem Server, 7 Tage.** Eine Kopie außerhalb fehlt. Das ist dieselbe Lücke
   wie bei allen anderen Diensten auf dem Server und steht dort auf der Liste.

## Gegenprobe Crewplaner

`https://api.crewplanner.nyxlightwork.de/api/health` → **200**. Der CORS des Crewplaners ist
unverändert, auf Live und Test, für erlaubte und fremde Origins. `pocketbase-fix.yaml` ist
unangetastet, die sha256-Prüfsumme ist identisch.

## Rückgängig machen

In Coolify die Services `callboard-pb-test` und `callboard-pb-live` samt Volumes löschen. Dazu die
Datei `/data/coolify/proxy/dynamic/bauzeitenplan-pb.yaml`, das Skript
`/usr/local/bin/backup-bauzeitenplan-pb-db.sh` mit dem Cron `/etc/cron.d/bauzeitenplan-pb-backup` und
die drei DNS-Einträge `api.callboard`, `api-test.callboard` und `MX callboard` entfernen. Das
Projekt `callboard` mit der statischen Seite bleibt davon unberührt.
