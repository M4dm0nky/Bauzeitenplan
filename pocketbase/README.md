# PocketBase — Benutzerverwaltung (vorbereitet, noch nicht live)

Backend für Login + Rollen. Die App läuft weiter aus localStorage; PocketBase
greift **nur mit Schalter** (`?backend=pb`). Dieser Ordner ist die Entwicklungs-
und Deploy-Grundlage.

## Was drin ist

| | |
|---|---|
| `bin/pocketbase` | PB-Binary (v0.39, **gitignored** — mit `setup`-Schritt neu holen) |
| `pb_data/` | lokale DB (**gitignored**) |
| `pb_hooks/main.pb.js` | Server-Hook: Task-Gewerk-Wächter + Auto-Verify + Einladung verknüpfen |
| `pb_schema.json` | Schnappschuss aller Collections + API-Rules (für den Coolify-Import) |
| `setup.mjs` | legt Schema + Regeln an und sät Testdaten |

## Lokal starten

```bash
# einmalig: Binary holen (macOS arm64)
mkdir -p pocketbase/bin && cd pocketbase/bin
curl -sL -o pb.zip https://github.com/pocketbase/pocketbase/releases/download/v0.39.7/pocketbase_0.39.7_darwin_arm64.zip
unzip -o pb.zip pocketbase && rm pb.zip && cd -

# einmalig: Superuser
./pocketbase/bin/pocketbase superuser create admin@bzp.local devpass1234

# Server (Hooks!)
cd pocketbase && ./bin/pocketbase serve --http=127.0.0.1:8090 --hooksDir=./pb_hooks

# Schema + Testdaten (in einem zweiten Terminal, Server läuft)
node pocketbase/setup.mjs
```

**Testnutzer** (nach `setup.mjs`): `chef@bzp.local` / `chefpass1234` (Owner/Admin),
`rigging@bzp.local` / `leadpass1234` (Leiter, Gewerk Rigging).

App im PB-Modus: `http://127.0.0.1:8090`-PB läuft, App über einen Webserver öffnen
(`python3 -m http.server 8080`) und `index.html?backend=pb` aufrufen → leitet zu
`login.html`. Der Schalter merkt sich in localStorage; raus mit „Abmelden" oder
`localStorage.removeItem('bzp_backend')`.

## Rollenmodell (der Kern)

- **admin / Owner** — schreibt alle Felder aller Gewerke.
- **lead (Gewerkeleiter)** — schreibt nur Task-Zeiten in SEINEN Gewerken.
- Durchsetzung **serverseitig**: API-Rules (`tasks` erlaubt Lead nur bei passendem
  `lead_scopes`-Eintrag) plus Hook (verhindert das Herausschieben in ein fremdes
  Gewerk). Mitgliedschaft & Scope hängen an der **E-Mail** (`@request.auth.email`),
  damit man einladen kann, bevor jemand ein Konto hat.

Beweis: `node tests/pb-rules.test.mjs` (läuft nur bei erreichbarer lokaler PB) —
Lead darf Rigging ändern (200), Licht nicht (403), kein Gewerk anlegen (403),
nicht herausschieben (Hook).

## Deploy auf Coolify/Hetzner (später)

1. PB-Instanz hochziehen, Superuser anlegen.
2. **Collections importieren:** `pb_schema.json` im PB-Dashboard unter
   *Settings → Import collections* einspielen.
3. **Hook hochladen:** `pb_hooks/main.pb.js` in den `pb_hooks`-Ordner der Instanz
   (wie Crewplaner via `curl` in das Docker-Volume + `docker restart`).
4. **⚠️ API-Rules nach JEDEM Redeploy prüfen.** Coolify-Reimport kippt die Regeln
   auf `auth != ""` zurück (Crewplaner-Lektion). Die gültigen Regeln stehen in
   `pb_schema.json` — dort abgleichen, sonst darf plötzlich jeder alles.
5. In der App die Basis-URL setzen: `window.BZP_PB_URL = 'https://…'` (oder
   `localStorage['bzp_pb_url']`), sonst zeigt der Client auf `127.0.0.1:8090`.

## Bewusst (noch) nicht

Echtzeit-Sync mehrerer Bearbeiter (PB-Subscriptions), E-Mail-Versand der Einladung
(Resend-Key), Umstellung des Live-Deploys auf PB, Migration bestehender
localStorage-Pläne. Das ist der nächste Schritt, wenn dieser Stand abgenommen ist.
