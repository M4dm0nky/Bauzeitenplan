# Admin-Auftrag — Bauzeitenplan online, Phase 1: Server-Grundlage

**Für:** den Server-Admin (Coolify / Hetzner)
**Von:** Marco (Bauzeitenplan), Stand 2026-11-23
**Aufwand:** ca. 1–2 Stunden, kein Eingriff in bestehende Dienste, kein Ausfall

---

## Worum es geht

Der **Bauzeitenplan** (Gantt-Ablaufplan für Veranstaltungen, heute eine reine
GitHub-Pages-Seite: `https://m4dm0nky.github.io/Bauzeitenplan/`) soll online gehen,
damit **externe Leute mit eigenem Zugang** an Plänen mitarbeiten können. Heute liegen
die Pläne nur im Browser des jeweiligen Nutzers.

Vorbild ist der **Crewplaner** (Frontend + PocketBase auf Coolify, Test und Live
getrennt). Übernommen wird **nur das Muster**, nichts davon wird mitbenutzt.

Diese Phase 1 baut **nur die leere Server-Grundlage**: zwei PocketBase-Instanzen,
DNS, CORS, Mailversand, Backups. Schema, Hooks und das Frontend auf Coolify folgen
in Phase 2 mit einem eigenen Auftrag (siehe unten), sobald die App dafür gebaut ist.

## ⚠️ Grundregel: komplett getrennt vom Crewplaner

Bauzeitenplan und Crewplaner sind **zwei getrennte Projekte**. Es wird **nichts
doppelt genutzt**:

| Bereich | Bauzeitenplan bekommt … | **nicht** |
|---|---|---|
| Coolify | ein **eigenes Projekt** «Bauzeitenplan» | keine App im Crewplaner-Projekt |
| PocketBase | **zwei eigene Instanzen** (Test, Live) | keine Collections in einer Crewplaner-PB |
| Volumes | eigene `pb_data`- und `pb_hooks`-Volumes | keine geteilten Volumes |
| Superuser | eigene Konten, eigene Passwörter | keine Crewplaner-Zugänge |
| Mailversand | eigener Zugang (eigener Resend-Key bzw. eigenes SMTP) | nicht der `RESEND_KEY` des Crewplaners |
| CORS / Traefik | eine **eigene** Datei in `/data/coolify/proxy/dynamic/` | `pocketbase-fix.yaml` bleibt unangetastet |
| Backups | eigener Zeitplan, eigener Ablageort | nicht in Crewplaner-Backups gemischt |

**Am Crewplaner wird in diesem Auftrag nichts verändert** — kein Container, keine
Datei, kein Neustart. Gemeinsam ist nur die Maschine: derselbe Hetzner-Server mit
derselben Coolify-Installation, darin ein eigenes Projekt (mit Marco abgestimmt).

## Zielbild

| | **TEST** | **LIVE** |
|---|---|---|
| Frontend | GitHub Pages: `https://m4dm0nky.github.io/Bauzeitenplan/` (besteht) | Coolify-App, Branch `live` — **erst Phase 2** |
| Frontend-URL | `https://m4dm0nky.github.io` | `https://callboard.nyxlightwork.de` |
| PocketBase | `https://api-test.callboard.nyxlightwork.de` | `https://api.callboard.nyxlightwork.de` |
| Mailversand | **aus** | **an** (eigener Zugang) |
| Daten | Test-DB, darf jederzeit geleert werden | echte Pläne |

Das Frontend wählt die PocketBase später **automatisch nach Hostname** (wie beim
Crewplaner): `callboard.nyxlightwork.de` → Live-API, alles andere (GitHub Pages, localhost)
→ Test-API.

### Domains (festgelegt)

| Zweck | Domain |
|---|---|
| Frontend LIVE | `callboard.nyxlightwork.de` |
| PocketBase LIVE | `api.callboard.nyxlightwork.de` |
| PocketBase TEST | `api-test.callboard.nyxlightwork.de` |

---

## Schritt 1 — DNS

Für alle drei Domains einen **A-Record** (und ggf. AAAA) auf den Server anlegen.
`callboard.nyxlightwork.de` wird erst in Phase 2 benutzt, darf aber jetzt schon zeigen.

**Prüfen:** `dig +short api-test.callboard.nyxlightwork.de` und `dig +short api.callboard.nyxlightwork.de` liefern die
Server-IP.

## Schritt 2 — Coolify-Projekt anlegen

In Coolify ein **neues Projekt «Bauzeitenplan»** anlegen. Alle Apps dieses Auftrags
(und von Phase 2) kommen dort hinein.

## Schritt 3 — PocketBase TEST

1. Im Projekt «Bauzeitenplan» eine **PocketBase-App** anlegen.
2. **Image gepinnt**, nicht `:latest` — dieselbe aktuelle stabile Version, die du auch
   sonst einsetzt (z. B. `ghcr.io/coollabsio/pocketbase:<X.Y.Z>`). Den Tag bitte
   zurückmelden.
3. **Domain:** `https://api-test.callboard.nyxlightwork.de`, TLS über Traefik / Let's Encrypt.
4. **Persistente Volumes**, eigene Namen, z. B.:
   - `bauzeitenplan-pb-test-data` → `/pb_data` (Datenbank)
   - `bauzeitenplan-pb-test-hooks` → `/pb_hooks` (kommt in Phase 2 zum Einsatz)
5. **Keine** Mail-Zugangsdaten, **kein** SMTP. Auf Test sollen garantiert keine Mails
   rausgehen.
6. Deployen.
7. **Superuser anlegen** über `https://api-test.callboard.nyxlightwork.de/_/`. Starkes, eigenes Passwort.
8. In den PocketBase-Einstellungen (`/_/` → Settings → Application):
   - **Application name:** `Bauzeitenplan TEST`
   - **Application URL:** `https://m4dm0nky.github.io/Bauzeitenplan/`
   - **Rate limiting:** einschalten (Standardregeln genügen).

## Schritt 4 — PocketBase LIVE

Wie Schritt 3, mit diesen Unterschieden:

- **Domain:** `https://api.callboard.nyxlightwork.de`
- **Volumes:** `bauzeitenplan-pb-live-data`, `bauzeitenplan-pb-live-hooks`
- **Application name:** `Bauzeitenplan`
- **Application URL:** `https://callboard.nyxlightwork.de/`
- **Mailversand:** siehe Schritt 5
- **Eigener Superuser**, nicht derselbe wie auf Test.

## Schritt 5 — Mailversand (nur LIVE)

Gebraucht für Einladungen und «Passwort vergessen». **Eigener Zugang**, nicht der des
Crewplaners. Eine der beiden Varianten, was dir lieber ist:

- **A — SMTP in PocketBase** (Settings → Mail settings): eigener SMTP-Zugang bzw.
  eigener Resend-SMTP-Key nur für den Bauzeitenplan. Absender z. B.
  `no-reply@callboard.nyxlightwork.de`.
- **B — eigener Resend-API-Key** als Umgebungsvariable `RESEND_KEY` an der
  **Live**-PocketBase-App (wird dann in Phase 2 vom Hook benutzt).

Die Absenderdomain muss beim Mailanbieter verifiziert sein (SPF/DKIM im DNS).
**Prüfen (Variante A):** Settings → Mail settings → «Send test email» an Marco.

## Schritt 6 — CORS

Eine **eigene** Traefik-Datei, z. B. `/data/coolify/proxy/dynamic/bauzeitenplan-pb.yaml`.
`pocketbase-fix.yaml` des Crewplaners **nicht** bearbeiten.

Erlaubte Herkünfte:

| Instanz | erlaubte Origins |
|---|---|
| TEST | `https://m4dm0nky.github.io`, `http://localhost:8080` |
| LIVE | `https://callboard.nyxlightwork.de` |

Methoden: `GET, POST, PATCH, DELETE, OPTIONS`; Header: `Authorization, Content-Type`.

Hinweis aus dem Crewplaner: PocketBase selbst antwortet standardmäßig mit
`Access-Control-Allow-Origin: *`. Die eigentliche Sperre kommt dort aus dem Hook.
Für den Bauzeitenplan liefert Phase 2 einen Hook mit eigener Positivliste. Die
Traefik-Ebene hier ist die zweite Absicherung und kann bis dahin auch weggelassen
werden, wenn sie dir Aufwand macht. Bitte zurückmelden, wie du es gelöst hast.

> Backups von Traefik-Dateien bitte mit Endung `.bak-<datum>`, nicht `.yaml`
> (sonst lädt Traefik sie als zweite Konfiguration).

## Schritt 7 — Backups

- **LIVE:** täglich, mindestens 7 Tage aufbewahren (PocketBase: Settings → Backups,
  oder Volume-Backup in Coolify / auf dem Server).
- **TEST:** keine Backups nötig.
- Ablage getrennt von den Crewplaner-Backups.

## Schritt 8 — Prüfen

```bash
curl -I https://api-test.callboard.nyxlightwork.de/api/health   # erwartet: 200
curl -I https://api.callboard.nyxlightwork.de/api/health   # erwartet: 200

# CORS-Vorabfrage Test, erwartet: Access-Control-Allow-Origin: https://m4dm0nky.github.io
curl -si -X OPTIONS https://api-test.callboard.nyxlightwork.de/api/health \
  -H "Origin: https://m4dm0nky.github.io" \
  -H "Access-Control-Request-Method: GET" | grep -i access-control

# Gegenprobe: Crewplaner unverändert, erwartet: 200
curl -I https://api.crewplanner.nyxlightwork.de/api/health
```

Admin-Oberflächen `https://api-test.callboard.nyxlightwork.de/_/` und `https://api.callboard.nyxlightwork.de/_/`
öffnen sich, Login mit dem jeweiligen Superuser klappt. Die Datenbanken sind leer
(nur `users`/`_superusers`) — das ist richtig so.

---

## Rückmeldung an Marco

Bitte als Datei `docs/rueckmeldung-online-phase1-<datum>.md` (z. B. per «Add files via
upload» im Repo `M4dm0nky/Bauzeitenplan`) oder per Mail. **Ohne Passwörter.**

| | TEST | LIVE |
|---|---|---|
| Domain | | |
| PocketBase-Image (Tag) | | |
| Container-Name | | |
| Daten-Volume (Pfad auf dem Server) | | |
| Hooks-Volume (Pfad auf dem Server) | | |
| Superuser-E-Mail | | |
| Mailversand (A/B, Absender) | — | |
| CORS gelöst über (Traefik-Datei / später Hook) | | |
| Backups (wie, wohin) | — | |
| `/api/health` = 200 | ☐ | ☐ |

**Superuser-Passwörter** bitte **nicht** in die Datei und nicht auf GitHub, sondern
auf getrenntem, sicherem Weg an Marco (z. B. Passwortmanager-Freigabe oder Signal).
Marco legt sie lokal ab; sie kommen nie ins Repo.

---

## Ausblick Phase 2 (eigener Auftrag, nicht jetzt)

Damit du weißt, was noch kommt — **jetzt bitte nichts davon tun**:

1. **Schema importieren** (Collections für Projekte/Pläne, Mitglieder, Rollen) —
   JSON-Datei aus dem Repo, erst Test, dann Live.
2. **Hook** `pb_hooks/main.pb.js` ins Hooks-Volume (CORS-Positivliste, Einladungen,
   Mails) — Ablauf wie beim Crewplaner: erst nach `/tmp`, Version + sha256 prüfen,
   Backup, kopieren, Neustart.
3. **Frontend-App** im Coolify-Projekt «Bauzeitenplan»: Repo `M4dm0nky/Bauzeitenplan`
   (öffentlich), Branch **`live`**, Dockerfile im Repo (nginx), Domain
   `callboard.nyxlightwork.de`, **Auto-Deploy bei Push** an. Danach braucht ein Go-Live keinen
   Admin mehr (`git push origin live`).

Nach Phase 2 braucht nur noch Server-Kram den Admin (Schema-Änderung, Hook-Update,
PocketBase-Upgrade).

## Rückgängig machen

Alles in diesem Auftrag ist neu. Löschen des Coolify-Projekts «Bauzeitenplan», der
vier Volumes, der Traefik-Datei `bauzeitenplan-pb.yaml` und der DNS-Einträge stellt
den vorherigen Zustand vollständig her. Der Crewplaner ist davon nicht berührt.
