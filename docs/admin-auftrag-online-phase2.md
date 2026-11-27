# Admin-Auftrag — Bauzeitenplan online, Phase 2: Schema, Hook, Frontend

**Für:** den Server-Admin (Robs, Coolify / Hetzner)
**Von:** Marco (Bauzeitenplan), Stand 2026-11-26
**Bezug:** [`admin-auftrag-online-phase1.md`](admin-auftrag-online-phase1.md), Rückmeldungen
[`…-2026-11-23.md`](rueckmeldung-online-phase1-2026-11-23.md) und [`…-abschluss-2026-11-26.md`](rueckmeldung-online-phase1-abschluss-2026-11-26.md)
**Aufwand:** ca. 1 Stunde für Teil A, ca. 30 Minuten für Teil B. Kein Eingriff in andere Dienste.

Alles, was in Phase 1 steht und in deiner Abschluss-Rückmeldung als erledigt gemeldet ist, **bleibt unangetastet**:
Application URL, Rate Limiting an, Proxy-Header (`X-Forwarded-For`, rechter Eintrag), CORS (Traefik),
Backups, Mail (Live: weiter offen, Test: aus). **Einzige Änderung an den Einstellungen** ist die
Migration `1700000003_ratelimits.js` (siehe unten), und die setzt sich beim Start selbst.

Der Ablauf ist dein Runbook aus dem Crewplaner: **sha-Gate, Backup, einspielen, Wirkung messen** — nicht nur
das Log lesen. Erst TEST, messen, dann LIVE.

## Zwei Teile, zwei Zeitpunkte

| Teil | Was | Wann |
|---|---|---|
| **A** | Migrationen und Hooks auf TEST, dann LIVE | **jetzt**, sobald Marco den Branch `online` gepusht und dir Bescheid gesagt hat. Die Live-Seite zeigt noch die alte App und merkt davon nichts. |
| **B** | Coolify-App für `callboard.nyxlightwork.de` aus Branch `live` | **erst auf Marcos Zeichen** («`live` ist gepusht»). Ab dann zeigt die Live-Seite die neue App. |
| **C** | Erstes Superadmin-Konto der App | **Marco selbst**, mit seinem Superuser. Nicht dein Teil, steht hier nur zur Orientierung. |

---

## Teil A — Migrationen und Hooks einspielen

### Was eingespielt wird

Sechs Dateien aus dem öffentlichen Repo `M4dm0nky/Bauzeitenplan`, Ordner `pocketbase/`:

| Datei | Ziel im Container | Wirkung |
|---|---|---|
| `pb_migrations/1700000001_schema.js` | `/app/pb_migrations/` | legt die Collections an (`plaene`, `mitglieder`, `einladungen`, `ressourcen`, `gewerke`, `vorgaenge`, `phasen`, `verknuepfungen`), Felder `superadmin`/`produktionsleitung` an `users`, alle API-Regeln |
| `pb_migrations/1700000002_reset_mail.js` | `/app/pb_migrations/` | Reset-Mail der Konten verweist auf `login.html?reset=…` |
| `pb_migrations/1700000003_ratelimits.js` | `/app/pb_migrations/` | hebt **nur** die Regel `*:create` von 20 auf **2000 je 5 s** (legt sie an, falls sie fehlt). `enabled` und die anderen Regeln (`*:auth`, `/api/batch`, `/api/`) fasst sie **nicht** an. |
| `pb_migrations/1700000004_plan_loeschen.js` | `/app/pb_migrations/` | setzt **nur** `plaene.deleteRule`: einen Plan löschen darf nur der Besitzer oder der Superadmin (zuvor auch ein Mitglied «produktionsleitung»). Fasst sonst nichts an. |
| `pb_hooks/main.pb.js` | Hooks-Volume `/app/pb_hooks/` | Revisionsprüfung, Rollen, Konten, Einladung (`POST /api/bzp/einladung`) |
| `pb_hooks/hilfen.js` | Hooks-Volume `/app/pb_hooks/` | Hilfsfunktionen des Hooks (muss neben `main.pb.js` liegen) |

**Warum die Rate-Limit-Migration:** Ein ganzer Plan geht als **ein** Batch, und PocketBase zählt jede
Unteranfrage einzeln gegen `*:create`. Mit 20 je 5 s scheiterten der AMK- und der Klassentreffen-Import
schon ab 21 Datensätzen (gemessen, es ist derselbe Fehler wie beim Crewplaner). Statt eines eigenen
Hook-Endpunkts hebt die Migration die Regel an; du musst nichts von Hand einstellen. Die App wiederholt
außerdem selbst bei `429`.

Die Migrationen liegen im Container (`/app/pb_migrations`) und **nicht** in einem Volume. Das ist in
Ordnung: PocketBase merkt sich angewendete Migrationen in der Datenbank (`_migrations`), ein Redeploy
braucht die Dateien nicht erneut. Ist dein Image anders aufgebaut (`--migrationsDir` gesetzt),
nimm den dort gesetzten Ordner und melde ihn zurück.

### Die Prüfsummen (sha256)

Gate: Diese Werte müssen **genau** stimmen, sonst nichts einspielen.

```
7fa4baf2fe76f4dd90853f118b2cf93064dbe2d52093d31bdde564ec0a83d121  1700000001_schema.js
9ef292de18e8ca6fecc46a2317604bcfbaad646acdb11dbd6b6de65043533701  1700000002_reset_mail.js
b4e3928e9536c72bf5013388780bb480ad32005aefc0a6ce1022c18d7975b2cf  1700000003_ratelimits.js
e033757076260624374a15549381754df594cd69277a4d359cb11382773c2efd  1700000004_plan_loeschen.js
969d70621e96d00e27ef0c284a88dc5d944cb04ee468290f3889e187fc62e543  main.pb.js
218fe878ca685d6ccc1c7d042047d2c185c4f588bff2bbcc141d070ab2d09ae2  hilfen.js
```

### Ablauf je Instanz (zuerst TEST)

Variablen (Werte aus deiner Rückmeldung vom 23.11.):

| | TEST | LIVE |
|---|---|---|
| `CT` | `pocketbase-7r9smcixas5kqgwlrm8giewf` | `pocketbase-3tnkcl0pwfilttoxpux8hfmw` |
| `UUID` | `7r9smcixas5kqgwlrm8giewf` | `3tnkcl0pwfilttoxpux8hfmw` |
| `API` | `https://api-test.callboard.nyxlightwork.de` | `https://api.callboard.nyxlightwork.de` |

**1. Nach /tmp holen und gegen die Prüfsummen prüfen** (per SSH, nichts im Container ändern):

```bash
mkdir -p /tmp/bzp-phase2 && cd /tmp/bzp-phase2
R=https://raw.githubusercontent.com/M4dm0nky/Bauzeitenplan/online/pocketbase
for f in pb_migrations/1700000001_schema.js pb_migrations/1700000002_reset_mail.js \
         pb_migrations/1700000003_ratelimits.js pb_migrations/1700000004_plan_loeschen.js \
         pb_hooks/main.pb.js pb_hooks/hilfen.js; do
  curl -fsSL "$R/$f" -o "$(basename "$f")"
done
cat > SHA256SUMS <<'EOF'
7fa4baf2fe76f4dd90853f118b2cf93064dbe2d52093d31bdde564ec0a83d121  1700000001_schema.js
9ef292de18e8ca6fecc46a2317604bcfbaad646acdb11dbd6b6de65043533701  1700000002_reset_mail.js
b4e3928e9536c72bf5013388780bb480ad32005aefc0a6ce1022c18d7975b2cf  1700000003_ratelimits.js
e033757076260624374a15549381754df594cd69277a4d359cb11382773c2efd  1700000004_plan_loeschen.js
969d70621e96d00e27ef0c284a88dc5d944cb04ee468290f3889e187fc62e543  main.pb.js
218fe878ca685d6ccc1c7d042047d2c185c4f588bff2bbcc141d070ab2d09ae2  hilfen.js
EOF
sha256sum -c SHA256SUMS          # alle sechs «OK», sonst STOPP und Marco melden
```

(Ist der Branch `online` schon in `main` gemergt, steht dasselbe unter `main`; die Prüfsummen gelten
für die Dateien, nicht für den Branch.)

**2. Vorher messen** (Ausgangszustand; hier muss die Collection noch fehlen):

```bash
curl -s -o /dev/null -w "plaene: %{http_code}\n" "$API/api/collections/plaene/records"          # erwartet: 404
curl -s -o /dev/null -w "hook:   %{http_code}\n" -X POST "$API/api/bzp/einladung" \
  -H 'content-type: application/json' -d '{}'                                                  # erwartet: 404
curl -s -o /dev/null -w "health: %{http_code}\n" "$API/api/health"                              # erwartet: 200
```

**3. Backup von `pb_data`** (wie beim Live-Backup: `sqlite3 .backup` plus `integrity_check`; auf TEST einmalig,
obwohl dort keine Backups laufen, damit der Rückweg überall derselbe ist):

```bash
DATA=/var/lib/docker/volumes/${UUID}_pocketbase-data/_data
# eigener Ordner, NICHT im rotierenden Live-Backup-Ordner (dort räumt die Tagessicherung nach 7 Tagen auf)
BK=/root/backups/bauzeitenplan-pb-phase2-$(date +%F-%H%M)
mkdir -p "$BK"
sqlite3 "$DATA/data.db"      ".backup '$BK/data.db'"
sqlite3 "$DATA/auxiliary.db" ".backup '$BK/auxiliary.db'"
sqlite3 "$BK/data.db" "PRAGMA integrity_check;"        # erwartet: ok
sqlite3 "$BK/auxiliary.db" "PRAGMA integrity_check;"   # erwartet: ok
```

(So auf TEST am 27.11. gemacht, Rückmeldung Robs: dort zusätzlich Einstellungen vorher/nachher und die
Collection-Liste im selben Ordner abgelegt — gern beibehalten.)

**4. Kopieren** (Hooks ins Hooks-Volume, Migrationen in den Container) und **Neustart**:

```bash
HOOKS=/var/lib/docker/volumes/${UUID}_pocketbase-hooks/_data
cd /tmp/bzp-phase2
docker exec "$CT" mkdir -p /app/pb_migrations
docker cp 1700000001_schema.js     "$CT":/app/pb_migrations/
docker cp 1700000002_reset_mail.js "$CT":/app/pb_migrations/
docker cp 1700000003_ratelimits.js "$CT":/app/pb_migrations/
docker cp 1700000004_plan_loeschen.js "$CT":/app/pb_migrations/
# Reihenfolge: ERST hilfen.js, DANN main.pb.js — PocketBase überwacht das Hooks-Verzeichnis und startet sich
# beim Kopieren von main.pb.js selbst neu; hilfen.js muss dann schon da sein.
cp hilfen.js "$HOOKS/"
cp main.pb.js "$HOOKS/"
docker restart "$CT"
sleep 8
docker logs --tail 40 "$CT"       # keine Fehlerzeile zu Migration oder Hook
```

**5. Wirkung messen — nicht nur das Log lesen.** Dieselben drei Anfragen wie in Schritt 2, jetzt mit
anderem Ergebnis:

```bash
curl -s -o /dev/null -w "health: %{http_code}\n" "$API/api/health"                              # erwartet: 200
curl -s "$API/api/collections/plaene/records?perPage=1"                                         # erwartet: {"items":[],"totalItems":0,…} (HTTP 200)
curl -s -X POST "$API/api/bzp/einladung" -H 'content-type: application/json' -d '{}'            # erwartet: 400 «Einladung unbekannt oder schon verwendet.»
```

`404` bei der zweiten Anfrage heißt: die Migrationen sind nicht gelaufen (Ordner falsch). `404` bei der
dritten heißt: der Hook ist nicht geladen (Datei im falschen Volume, oder `hilfen.js` fehlt). Fehler der
Hooks stehen **nicht** im Prozess-Log, sondern in der Tabelle `_logs` (Admin-Oberfläche → Logs).

Dazu die vollständige Prüfung, **ohne Anmeldung und ohne zu schreiben**, aus einem Checkout des Repos
(Node 22 oder neuer; `git clone https://github.com/M4dm0nky/Bauzeitenplan && cd Bauzeitenplan && git checkout online`):

```bash
node tools/verify-pb-regeln.mjs --gegen "$API"
# erwartet am Ende: «Lesemodus: alles wie erwartet» (Health, alle neun Collections da und anonym leer, Hook-Route lehnt ab)
```

Kommt ein `✗`, **nicht weitermachen**, Ausgabe an Marco schicken; Rückweg siehe unten.

Die Einstellungen (Rate Limit `*:create` = 2000 je 5 s, Rate Limiting weiter an, Application URL unverändert)
prüft **Marco** mit seinem Superuser-Token (`PB_SU_TOKEN`, bleibt bei ihm, kommt nie ins Repo); du kannst es
auch in `/_/` → Settings → Application ansehen. Dort muss `*:create` jetzt **2000 / 5 s** stehen, alle
anderen Regeln unverändert (`*:auth` 2/3 s, `/api/batch` 3/1 s, `/api/` 300/10 s).

**6. Aufräumen:** `rm -rf /tmp/bzp-phase2` (nach dem **zweiten** Durchlauf, also nach LIVE).

Dann **dasselbe für LIVE**. Erst wenn TEST sauber durch ist.

### Rückweg Teil A

Alles in Teil A ist neu; vorhanden war nichts davon. Zurück: `main.pb.js` und `hilfen.js` aus dem
Hooks-Volume löschen, `docker restart "$CT"`. Die Collections entfernen sich dabei **nicht** von selbst:
sollen sie weg, das Backup aus Schritt 3 zurückspielen (Container stoppen, `data.db` ersetzen, starten) —
bei LIVE gibt es noch keine echten Daten, bis Marco sein Konto anlegt. Der Crewplaner ist davon nicht berührt.

---

## Teil B — Coolify-App für `callboard.nyxlightwork.de` (erst auf Marcos Zeichen)

Die Domain `callboard.nyxlightwork.de` zeigt heute die alte statische Seite im Coolify-Projekt `callboard`
(Environment `production`). Damit nicht zwei Apps auf derselben Domain liegen, **stellst du die bestehende
App um** (oder legst eine neue an und nimmst die Domain von der alten, wie dir lieber ist). **Notiere vorher
die alte Konfiguration** (Repo, Branch, Build-Pack, Port): das ist der Rückweg.

| Einstellung | Wert |
|---|---|
| Quelle | öffentliches Repo `M4dm0nky/Bauzeitenplan`, Branch **`live`** |
| Build-Pack | **Dockerfile** (`/Dockerfile` im Repo-Stamm, nichts zu bauen außer dem Image) |
| Port | **80** (nginx im Image) |
| Domain | `https://callboard.nyxlightwork.de`, TLS über Traefik wie bisher |
| Health-Check | Pfad `/healthz` (liefert `200 ok`); das Image hat auch einen eigenen `HEALTHCHECK` |
| Auto-Deploy bei Push | **an** — danach ist ein Go-Live `git push origin live`, ohne dich |
| Umgebungsvariablen | keine |

Das Image enthält nur die ausgelieferten Dateien (`index.html`, `login.html`, `print.html`, `sw.js`, `js/`,
`styles/`, `assets/`); `docs/`, `tools/`, `tests/`, `pocketbase/` sind nicht drin (im Repo per Test gesperrt).
Die App wählt die API **nach Hostname**: `callboard.nyxlightwork.de` → `https://api.callboard.nyxlightwork.de`.
Dazu ist nichts einzustellen; die CORS-Liste aus Phase 1 (`https://callboard.nyxlightwork.de` für LIVE) passt
bereits.

**Wirkung messen:**

```bash
curl -si https://callboard.nyxlightwork.de/ | head -12                       # 200, cache-control: no-cache
curl -si https://callboard.nyxlightwork.de/sw.js | grep -i cache-control     # no-cache, no-store, must-revalidate
curl -s -o /dev/null -w "%{http_code}\n" https://callboard.nyxlightwork.de/healthz    # 200
curl -s -o /dev/null -w "%{http_code}\n" https://callboard.nyxlightwork.de/docs/x.md  # 404 (nichts aus docs/ im Image)
curl -si -X OPTIONS https://api.callboard.nyxlightwork.de/api/health \
  -H "Origin: https://callboard.nyxlightwork.de" -H "Access-Control-Request-Method: GET" | grep -i access-control
# erwartet: Access-Control-Allow-Origin: https://callboard.nyxlightwork.de
curl -I https://api.crewplanner.nyxlightwork.de/api/health                   # Gegenprobe Crewplaner: 200
```

Danach prüft **Marco** die Seite selbst (`node tools/verify-browser.mjs --base https://callboard.nyxlightwork.de/`
prüft Anmeldeseite und Weiterleitung) und meldet sich an.

**Rückweg Teil B:** alte Konfiguration der App wiederherstellen (Branch/Build-Pack/Port), neu deployen.

---

## Teil C — Erstes Superadmin-Konto (macht Marco, nicht der Admin)

Damit überhaupt jemand Pläne anlegen und andere einladen kann, braucht die App ein erstes Konto mit den Flags
`superadmin` und `produktionsleitung`. Das legt **Marco selbst** an, mit **seinem** Superuser, nach Teil A
(für TEST) bzw. nach Teil A auf LIVE:

```bash
# Zugangsdaten in pocketbase/pb-admin.local.json (gitignored) oder als Umgebungsvariablen, nie im Repo
node pocketbase/setup.mjs --trocken    # zeigt, was passieren würde
node pocketbase/setup.mjs              # legt das Konto an (idempotent: ein zweiter Lauf ändert nichts)
```

Dein Zugriff ist dafür nicht nötig, und es gehen **keine Passwörter** über dich.

---

## Was du **nicht** anfassen sollst

- Application URL, Rate Limiting (an), User-IP-Proxy-Header (`X-Forwarded-For`, **rechter** Eintrag, nicht auf
  «leftmost» stellen), CORS-Datei, Backups, Mail-Einstellungen. Änderungen an den Einstellungen kommen nur
  aus den Migrationen: `1700000001` schaltet die **Batch-API** ein (`batch.enabled` an, `maxRequests` 2000,
  `timeout` 30 s — nötig für die App), `1700000003` hebt `*:create` auf 2000/5 s; `1700000004` ändert nur
  die Löschregel von `plaene`. Auf TEST am 27.11. genau so gemessen (Diff vorher/nachher).
- **Migrationsdateien liegen nur im Container**, nicht im Volume: Nach einem Recreate/Redeploy ist
  `/app/pb_migrations` leer — das ist in Ordnung, `_migrations` führt sie als angewendet. Jede **künftige**
  Migration muss wieder per `docker cp` hinein.
- Keine Collections oder Regeln von Hand in `/_/` ändern: Sie würden beim nächsten Redeploy oder bei einer
  Migration überschrieben, und die Regeln sind die erste Sicherheitsschranke.
- Der Crewplaner bleibt unberührt.

## Rückmeldung an Marco

Bitte als Datei `docs/rueckmeldung-online-phase2-<datum>.md` (oder per Mail), **ohne Passwörter und Token**:

| | TEST | LIVE |
|---|---|---|
| `sha256sum -c` alle sechs OK | ☐ | ☐ |
| Backup vor dem Einspielen (Pfad, `integrity_check` = ok) | ☐ | ☐ |
| Ordner der Migrationen im Container (`/app/pb_migrations` oder anderer) | | |
| Vorher: `plaene` 404, Hook 404 | ☐ | ☐ |
| Nachher: `plaene` 200 leer, Hook 400 «Einladung unbekannt…» | ☐ | ☐ |
| `verify-pb-regeln.mjs --gegen` = «alles wie erwartet» | ☐ | ☐ |
| `*:create` in Settings → Application = 2000 / 5 s | ☐ | ☐ |
| `/api/health` = 200, Crewplaner-Gegenprobe = 200 | ☐ | ☐ |
| Teil B: App umgestellt/angelegt (Branch `live`, Port 80, Auto-Deploy) | — | ☐ |
| Teil B: Messungen (Cache-Header, `/healthz`, `/docs/` 404, CORS) | — | ☐ |

## Bitte an Marco/Robs: Token-Laufzeit für den Wandmonitor

Der Live-Monitor läuft tagelang ohne Bedienung und erneuert sein Anmelde-Token selbst alle 6 Stunden. Damit ein
Monitor nach einer längeren Pause (Wochenende, Server-Neustart) nicht abgemeldet ist, bitte in PocketBase unter
`users` → Optionen → «Auth token duration» eine **lange Laufzeit** einstellen (z. B. 30 Tage statt der
PocketBase-Vorgabe; Marco entscheidet über den Wert). Das ist eine Einstellung der
Collection `users`, **keine** Migration, und wird nicht still per Skript gesetzt.

## Offen aus Phase 1 (unverändert)

1. **Mailversand Live** (Resend, Variante A): bis dahin geht auf Live kein «Passwort vergessen». Einladungen
   funktionieren auch ohne Mail: der Besitzer kopiert den Link aus der App. Auf Test bleibt Mail dauerhaft aus.
2. **Kopie der Live-Backups außerhalb des Servers.**
