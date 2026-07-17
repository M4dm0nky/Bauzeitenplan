// ── Klassentreffen Festival 2026 ──────────────────────────────────────────────
// Baut aus dem „Bauzeitenplan V03, Stand 17.07.2026" eine importierbare JSON.
// V03 ist der ausschlaggebende Detailstand und löst den früheren Grob-Entwurf ab.
//
//   node tools/make-klassentreffen.mjs   →  klassentreffen-festival.json
//
// QUELLENTREUE ist die oberste Regel:
//   • Tag UND Uhrzeit stammen aus V03 (Spalten Beginn/Ende) → estimated: false.
//   • Wenige Zeilen ohne gedruckte Uhrzeit (einige Einbau-/Abnahme-Zeilen) sind
//     aus der Balkenfärbung geschätzt → estimated: true, mit Notiz.
//   • Dienstleister · Zuständig · Anmerkung stehen in der Notiz — nichts geht verloren.
//   • KEINE erfundenen Abhängigkeiten. V03 ist ein terminierter Kalender. deps: [].
//
// Gewerk-Modell (mit Marco abgestimmt): 17 bisherige + Besucher-Gastro (Trinity F&B)
// + Sanitätsdienst (ASB) = 19. Container-AN-/ABLIEFERUNG (Transport) → Logistik;
// die zugehörige Sanitär-/Artist-Arbeit steht separat unter ihrem Gewerk.

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serialize } from '../js/persistence.js';

const here = dirname(fileURLToPath(import.meta.url));

// ── Gewerke (Reihenfolge = Farbplatz) ────────────────────────────────────────
const GEWERKE = [
  'Bühne', 'Rigging', 'Licht', 'Ton', 'Video', 'Pyro', 'Catering', 'Sanitär',
  'Produktion', 'Strom', 'Zäune & Absperrung', 'Zelte', 'Security', 'Branding',
  'Artist Care', 'Show', 'Logistik', 'Besucher-Gastro', 'Sanitätsdienst',
];

// ── Zeit-Helfer ──────────────────────────────────────────────────────────────
const HHMM = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const nextDay = (d) => {
  const x = new Date(d + 'T12:00');
  x.setDate(x.getDate() + 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
// Ende 00:00 oder Ende ≤ Beginn → geht über Mitternacht in den Folgetag.
function span(day, s, e) {
  const cross = e === '00:00' || HHMM(e) <= HHMM(s);
  return { start: day + 'T' + s, end: (cross ? nextDay(day) : day) + 'T' + e };
}
const N = (...parts) => parts.filter(Boolean).join(' · ');
const EST = 'Uhrzeit geschätzt (in V03 ohne Zeit)';

// r(Gewerk, Titel, Tag, Beginn, Ende, Notiz?, est?) — ein Vorgang
const r = (gw, t, day, s, e, note = '', est = false) => ({ gw, t, day, s, e, note, est });
// mss(Titel, Zeitpunkt, Notiz) — projekt-Meilenstein
const mss = (t, at, note = '') => ({ gw: 'projekt', t, ms: at, note });

// Tage
const [D21, D22, D23, D24, D25, D26, D27, D28, D29, D30, D31, S01, S02, S03] = [
  '2026-08-21', '2026-08-22', '2026-08-23', '2026-08-24', '2026-08-25', '2026-08-26',
  '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01',
  '2026-09-02', '2026-09-03',
];
const CL = 'Carsten Langenfeld';

// ── Vorgänge nach V03, Tag für Tag ───────────────────────────────────────────
const ROWS = [
  // ── Fr 21.08. ──────────────────────────────────────────────────────────────
  r('Produktion', 'Produktion vor Ort', D21, '08:00', '12:00'),
  r('Produktion', 'Übergabe Gelände', D21, '08:00', '09:00', N(CL)),
  r('Strom', 'Ablesen Strom Zählerstände', D21, '08:00', '09:00', N(CL)),
  r('Sanitär', 'Ablesen Wasser Zählerstände', D21, '08:00', '09:00', N(CL)),
  r('Produktion', 'Einzeichnen Catering-Zelt', D21, '10:00', '11:00', N('Produktion')),
  r('Logistik', 'Anlieferung Fuhrpark', D21, '08:00', '10:00', N('Trafö')),
  r('Zäune & Absperrung', 'Anlieferung Zäune', D21, '10:00', '12:00', N('EPS')),
  r('Logistik', 'Anlieferung WC-Container Artist', D21, '08:00', '12:00', N('Wölkchen')),
  r('Logistik', 'Anlieferung Trio-Container', D21, '08:00', '12:00', N('Wölkchen', 'Produktion')),
  r('Logistik', 'Anlieferung Duo-Container', D21, '08:00', '12:00', N('Wölkchen', 'Produktion')),
  r('Logistik', 'Anlieferung 4× Single-Container', D21, '08:00', '12:00', N('Wölkchen', 'Produktion')),

  // ── Sa 22.08. ──────────────────────────────────────────────────────────────
  r('Produktion', 'Produktion vor Ort', D22, '08:00', '14:00', N('Produktion')),
  r('Produktion', 'Sitecrew vor Ort', D22, '08:00', '14:00', N('Produktion')),
  r('Produktion', 'Staplerfahrer vor Ort', D22, '08:00', '14:00', N('Produktion', '1× Staplerfahrer')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D22, '14:00', '00:00', N('BEST')),
  r('Produktion', 'Einzeichnen Gelände', D22, '08:00', '12:00', N('Produktion')),
  r('Catering', 'Anlieferung Möbel Crew-Catering', D22, '12:00', '14:00', N('Japo (unklar)')),
  r('Produktion', 'Anlieferung Office-Material', D22, '08:00', '10:00', N('36StageXl')),
  r('Zelte', 'Aufbau Cateringzelt / Küchenzelt', D22, '08:00', '12:00', N('Zelte Bereit')),
  r('Sanitär', 'Aufbau Wasserversorgung Crew-Catering', D22, '12:00', '14:00'),
  r('Sanitär', 'Aufbau Wasserversorgung WC-Container Artist', D22, '11:00', '12:00'),
  r('Strom', 'Verstromung Produktionsbüro', D22, '08:00', '09:00', N('Mobile Energy')),
  r('Catering', 'Einrichten Crew-Catering', D22, '12:00', '14:00', N('Morsh / Site')),
  r('Produktion', 'Einrichten Produktionsbüro', D22, '08:00', '10:00', N('Produktion')),
  r('Zäune & Absperrung', 'Aufbau Zäune Backstage', D22, '08:00', '14:00', N('Site')),

  // ── So 23.08. — Baufrei (nur 24/7-Security) ────────────────────────────────
  r('Security', 'Sicherheitsdienst / Objektbewachung', D23, '00:00', '00:00', N('BEST', '24/7')),
  mss('Baufrei — kein Aufbau', D23 + 'T12:00', 'In V03 an diesem Tag nur Objektbewachung.'),

  // ── Mo 24.08. ──────────────────────────────────────────────────────────────
  r('Produktion', 'Produktion vor Ort', D24, '08:00', '18:00', N('Produktion')),
  r('Produktion', 'Sitecrew vor Ort', D24, '08:00', '18:00', N('Produktion')),
  r('Produktion', 'Staplerfahrer vor Ort', D24, '08:00', '18:00', N('Produktion', '4× StageCo, 1× Strom, 1× Site')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D24, '00:00', '08:00', N('BEST')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D24, '18:00', '00:00', N('BEST')),
  r('Catering', 'Catering-Zeiten', D24, '13:00', '15:00', N('Morsh')),
  r('Zelte', 'Aufbau Artist-Zelte / Pagoden', D24, '08:00', '14:00', N('Zelte Bereit')),
  r('Zelte', 'Aufbau Einlass-Zelt', D24, '14:00', '18:00', N('Zelte Bereit')),
  r('Zelte', 'Aufbau Aufenthaltszelte BEST / UG', D24, '14:00', '18:00', N('Zelte Bereit')),
  r('Zelte', 'Aufbau Zelte Gastro', D24, '08:00', '18:00', N('Zelte Bereit')),
  r('Catering', 'Aufbau Klimatisierung Catering / Kitchen', D24, '08:00', '12:00', N('Helot')),
  r('Strom', 'Anlieferung Strom', D24, '08:00', '10:00', N('Mobile Energy')),
  r('Strom', 'Verstromung Crew-Catering', D24, '12:00', '14:00', N('Mobile Energy')),
  r('Strom', 'Verstromung Bühne / Backstage', D24, '10:00', '18:00', N('Mobile Energy')),
  r('Logistik', 'Anlieferung alle Backstage-Container Artists', D24, '08:00', '18:00', N('Wölkchen')),
  r('Logistik', 'Anlieferung Dusch-Container Artist', D24, '08:00', '18:00', N('Wölkchen')),
  r('Bühne', 'Anlieferung Stahl', D24, '08:00', '10:00', N('StageCo')),
  r('Bühne', 'Aufbau Bühne Tag 1', D24, '08:00', '18:00', N('StageCo')),
  r('Produktion', 'Einrichten Internet Produktionsbüro', D24, '08:00', '10:00'),
  r('Produktion', 'Einrichten Internet Gelände', D24, '10:00', '18:00'),

  // ── Di 25.08. ──────────────────────────────────────────────────────────────
  r('Produktion', 'Produktion vor Ort', D25, '08:00', '18:00', N('Produktion')),
  r('Produktion', 'Sitecrew vor Ort', D25, '08:00', '18:00', N('Produktion')),
  r('Produktion', 'Staplerfahrer vor Ort', D25, '08:00', '18:00', N('Produktion', '4× StageCo, 1× Strom, 1× Site')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D25, '00:00', '08:00', N('BEST')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D25, '18:00', '00:00', N('BEST')),
  r('Catering', 'Catering-Zeiten', D25, '12:00', '15:00', N('Morsh')),
  r('Strom', 'Verstromung Gelände', D25, '08:00', '18:00', N('Mobile Energy')),
  r('Strom', 'Verstromung Container', D25, '14:00', '18:00', N('Mobile Energy')),
  r('Logistik', 'Anlieferung WC-Container VIP', D25, '08:00', '18:00', N('Wölkchen')),
  r('Logistik', 'Anlieferung Kassencontainer', D25, '08:00', '12:00', N('Wölkchen')),
  r('Bühne', 'Aufbau Bühne Tag 2', D25, '08:00', '18:00', N('StageCo')),

  // ── Mi 26.08. ──────────────────────────────────────────────────────────────
  r('Produktion', 'Produktion vor Ort', D26, '08:00', '18:00', N('Produktion')),
  r('Produktion', 'Sitecrew vor Ort', D26, '08:00', '18:00', N('Produktion')),
  r('Produktion', 'Staplerfahrer vor Ort', D26, '08:00', '18:00', N('Produktion', '4× StageCo, 1× Site, 2× Gastro')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D26, '00:00', '08:00', N('BEST')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D26, '18:00', '00:00', N('BEST')),
  r('Catering', 'Catering-Zeiten', D26, '12:00', '15:00', N('Morsh')),
  r('Artist Care', 'Anlieferung Backstagemöbel', D26, '08:00', '10:00', N('Japo')),
  r('Besucher-Gastro', 'Aufbau Besuchergastro', D26, '08:00', '18:00', N('Trinity F&B')),
  r('Sanitär', 'Aufbau Wasser-Infrastruktur', D26, '08:00', '18:00'),
  r('Bühne', 'Aufbau Bühne Tag 3', D26, '08:00', '18:00', N('StageCo')),
  r('Logistik', 'Anlieferung Container Bühne', D26, '12:00', '18:00', N('Wölkchen')),
  r('Logistik', 'Anlieferung Kabinen Besucherbereiche', D26, '12:00', '18:00', N('Wölkchen')),
  r('Branding', 'Anbringen Banner Look & Feel', D26, '08:00', '18:00', N('Site')),
  r('Branding', 'Anbringen Banner Notausgänge', D26, '08:00', '18:00', N('Site')),
  r('Artist Care', 'Einrichten Artist Dressing Rooms', D26, '10:00', '18:00', N('Site')),
  r('Zelte', 'Einrichten Einlasszelte', D26, '08:00', '14:00', N('Site')),

  // ── Do 27.08. ──────────────────────────────────────────────────────────────
  r('Produktion', 'Produktion vor Ort', D27, '08:00', '18:00', N('Produktion')),
  r('Produktion', 'Sitecrew vor Ort', D27, '08:00', '18:00', N('Produktion')),
  r('Produktion', 'Staplerfahrer vor Ort', D27, '08:00', '18:00', N('Produktion', '2× Technik, 1× Site, 2× Gastro')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D27, '00:00', '08:00', N('BEST')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D27, '18:00', '00:00', N('BEST')),
  r('Catering', 'Catering-Zeiten', D27, '12:00', '15:00', N('Morsh')),
  r('Besucher-Gastro', 'Aufbau Besuchergastro', D27, '08:00', '18:00', N('Trinity F&B')),
  r('Rigging', 'Einbau Rigging', D27, '08:00', '12:00', N('BigRig', EST), true),
  r('Licht', 'Einbau Licht', D27, '10:00', '18:00', N('Complete Audio', EST), true),
  r('Video', 'Einbau Video', D27, '10:00', '18:00', N('TSE', EST), true),
  r('Ton', 'Einbau PA', D27, '10:00', '18:00', N('TSE', EST), true),
  r('Licht', 'Einrichten FOH', D27, '14:00', '18:00', N('Complete Audio', EST), true),
  r('Licht', 'Einleuchten / Programmierung', D27, '18:00', '23:00', N('Complete Audio', EST), true),
  r('Zäune & Absperrung', 'Aufbau Barriers Bühne / 2nd Barrier', D27, '08:00', '18:00', N('EPS')),
  r('Produktion', 'Abnahme Fliegende Bauten', D27, '12:00', '18:00', N('AvS / TÜV')),
  r('Besucher-Gastro', 'Aufbau Ticketing', D27, '12:00', '18:00', N('Trinity')),
  r('Branding', 'Anbringen Banner Look & Feel', D27, '08:00', '18:00', N('Site')),
  r('Branding', 'Anbringen Banner Notausgänge', D27, '08:00', '18:00', N('Site')),

  // ── Fr 28.08. ──────────────────────────────────────────────────────────────
  r('Produktion', 'Produktion vor Ort', D28, '08:00', '18:00', N('Produktion')),
  r('Produktion', 'Sitecrew vor Ort', D28, '08:00', '18:00', N('Produktion')),
  r('Produktion', 'Staplerfahrer vor Ort', D28, '08:00', '18:00', N('Produktion', '2× Technik, 1× Site, 2× Gastro')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D28, '00:00', '08:00', N('BEST')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D28, '18:00', '00:00', N('BEST')),
  r('Catering', 'Catering-Zeiten', D28, '12:00', '15:00', N('Morsh')),
  r('Besucher-Gastro', 'Aufbau Besuchergastro', D28, '08:00', '18:00', N('Trinity F&B')),
  r('Licht', 'Einbau / Restarbeiten Licht', D28, '10:00', '18:00', N('Complete Audio')),
  r('Video', 'Einbau / Restarbeiten Video', D28, '10:00', '18:00', N('TSE')),
  r('Ton', 'Einbau / Restarbeiten PA', D28, '10:00', '18:00', N('TSE')),
  r('Pyro', 'Einbau SFX', D28, '14:00', '18:00', N('TBA')),
  r('Licht', 'Einbau Floorset / Backline / Riser', D28, '14:00', '18:00', N('Complete Audio')),
  r('Licht', 'Einleuchten / Programmierung', D28, '18:00', '23:00', N('Complete Audio', EST), true),
  r('Zäune & Absperrung', 'Aufbau Einlasschleusen', D28, '08:00', '14:00', N('EPS', EST), true),
  r('Produktion', 'Behördliche Abnahme', D28, '12:00', '16:00', N('AvS / Behörden', EST), true),
  r('Ton', 'Soundcheck (Zeiten gemäß Genehmigung)', D28, '16:00', '18:00', N('AvS / TSE', EST), true),
  r('Branding', 'Anbringen Banner Look & Feel', D28, '08:00', '18:00', N('Site')),
  r('Branding', 'Anbringen Banner Notausgänge', D28, '08:00', '18:00', N('Site')),
  r('Licht', 'Stellen Lichtmasten', D28, '08:00', '18:00', N('Site')),
  r('Sanitätsdienst', 'Aufbau Sanitätsstationen', D28, '08:00', '18:00', N('ASB')),
  r('Produktion', 'Test Sicherheitsbeleuchtung', D28, '21:00', '22:00', N('Produktion')),

  // ── Sa 29.08. — Showtag 1 ──────────────────────────────────────────────────
  r('Produktion', 'Produktion vor Ort', D29, '08:00', '00:00', N('Produktion')),
  r('Produktion', 'Sitecrew vor Ort', D29, '08:00', '00:00', N('Produktion')),
  r('Produktion', 'Staplerfahrer vor Ort', D29, '08:00', '12:00', N('Produktion', '1× Site, 2× Gastro')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D29, '00:00', '08:00', N('BEST')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D29, '23:00', '00:00', N('BEST')),
  r('Catering', 'Catering-Zeiten', D29, '12:00', '16:00', N('Morsh')),
  r('Catering', 'Catering-Zeiten', D29, '17:00', '21:00', N('Morsh')),
  r('Besucher-Gastro', 'Aufbau Besuchergastro', D29, '08:00', '11:00', N('Trinity F&B')),
  r('Licht', 'Einbau / Restarbeiten Licht', D29, '08:00', '11:00', N('Complete Audio')),
  r('Video', 'Einbau / Restarbeiten Video', D29, '08:00', '11:00', N('TSE')),
  r('Ton', 'Einbau / Restarbeiten PA', D29, '08:00', '11:00', N('TSE')),
  r('Pyro', 'Restarbeiten SFX', D29, '08:00', '11:00', N('TBA')),
  r('Licht', 'Einbau Floorset / Backline / Riser', D29, '08:00', '11:00', N('Complete Audio')),
  r('Branding', 'Anbringen Banner Look & Feel', D29, '08:00', '11:00', N('Site')),
  r('Branding', 'Anbringen Banner Notausgänge', D29, '08:00', '11:00', N('Site')),
  r('Show', 'Fahrverbot auf dem Gelände', D29, '11:30', '23:00', N('ALLE', '!!! Fahrverbot !!!')),
  r('Show', 'VA-Leitung / KooSt besetzt', D29, '12:00', '23:00', N('AvS / Trinity')),
  r('Show', 'Anwohner-Hotline besetzt', D29, '10:00', '00:00', N('Trinity')),
  r('Security', 'Sicherheitsdienst VA-Begleitung', D29, '12:00', '23:00', N('BEST / UG')),
  r('Security', 'Sicherheitsdienst Umfeld-Begleitung', D29, '11:00', '00:00', N('BEST')),
  r('Security', 'Brandsicherheitswachdienst VA-Begleitung', D29, '12:00', '23:00', N('Feuerfest')),
  r('Sanitätsdienst', 'Sanitätsdienst VA-Begleitung', D29, '12:00', '23:00', N('ASB')),
  r('Show', 'Festival-Shuttle in Betrieb', D29, '11:00', '00:00', N('Team Red / BVB')),
  r('Show', 'Öffnung VA-Gelände', D29, '12:00', '23:00', N('Produktion')),
  r('Besucher-Gastro', 'Ausschank Besucher-Gastronomie', D29, '12:00', '23:00', N('Trinity F&B')),
  r('Besucher-Gastro', 'Promotion / Non-Food-Aktivitäten', D29, '12:00', '23:00', N('Trinity F&B')),
  r('Show', 'Bespielung der Hauptbühne / Beschallung', D29, '12:00', '22:00', N('Produktion')),

  // ── So 30.08. — Showtag 2 (+ Ausbau in der Nacht) ─────────────────────────
  r('Produktion', 'Produktion vor Ort', D30, '08:00', '00:00', N('Produktion')),
  r('Produktion', 'Sitecrew vor Ort', D30, '08:00', '00:00', N('Produktion')),
  r('Produktion', 'Staplerfahrer vor Ort', D30, '08:00', '12:00', N('Produktion', '1× Site, 2× Gastro')),
  r('Produktion', 'Staplerfahrer vor Ort (Nacht)', D30, '23:00', '00:00', N('Produktion', '2× Technik, 1× Site, 2× Gastro')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D30, '00:00', '08:00', N('BEST')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D30, '23:00', '00:00', N('BEST')),
  r('Catering', 'Catering-Zeiten', D30, '12:00', '16:00', N('Morsh')),
  r('Catering', 'Catering-Zeiten', D30, '17:00', '21:00', N('Morsh')),
  r('Besucher-Gastro', 'Aufbau Besuchergastro', D30, '08:00', '11:00', N('Trinity F&B')),
  r('Licht', 'Einbau / Restarbeiten Licht', D30, '08:00', '11:00', N('Complete Audio')),
  r('Video', 'Einbau / Restarbeiten Video', D30, '08:00', '11:00', N('TSE')),
  r('Ton', 'Einbau / Restarbeiten PA', D30, '08:00', '11:00', N('TSE')),
  r('Pyro', 'Restarbeiten SFX', D30, '08:00', '11:00', N('TBA')),
  r('Licht', 'Einbau Floorset / Backline / Riser', D30, '08:00', '11:00', N('Complete Audio')),
  r('Branding', 'Anbringen Banner Look & Feel', D30, '08:00', '11:00', N('Site')),
  r('Branding', 'Anbringen Banner Notausgänge', D30, '08:00', '11:00', N('Site')),
  r('Show', 'Fahrverbot auf dem Gelände', D30, '11:30', '23:00', N('ALLE', '!!! Fahrverbot !!!')),
  r('Show', 'VA-Leitung / KooSt besetzt', D30, '12:00', '23:00', N('AvS / Trinity')),
  r('Show', 'Anwohner-Hotline besetzt', D30, '10:00', '00:00', N('Trinity')),
  r('Security', 'Sicherheitsdienst VA-Begleitung', D30, '12:00', '23:00', N('BEST / UG')),
  r('Security', 'Sicherheitsdienst Umfeld-Begleitung', D30, '11:00', '00:00', N('BEST')),
  r('Security', 'Brandsicherheitswachdienst VA-Begleitung', D30, '12:00', '23:00', N('Feuerfest')),
  r('Sanitätsdienst', 'Sanitätsdienst VA-Begleitung', D30, '12:00', '23:00', N('ASB')),
  r('Show', 'Festival-Shuttle in Betrieb', D30, '11:00', '00:00', N('Team Red / BVB')),
  r('Show', 'Öffnung VA-Gelände', D30, '12:00', '23:00', N('Produktion')),
  r('Besucher-Gastro', 'Ausschank Besucher-Gastronomie', D30, '12:00', '23:00', N('Trinity F&B')),
  r('Besucher-Gastro', 'Promotion / Non-Food-Aktivitäten', D30, '12:00', '23:00', N('Trinity F&B')),
  r('Show', 'Bespielung der Hauptbühne / Beschallung', D30, '12:00', '22:00', N('Produktion')),
  r('Pyro', 'Ausbau SFX', D30, '22:00', '00:00', N('TBA')),
  r('Licht', 'Ausbau Floorset / Backline / Riser', D30, '22:00', '00:00', N('Complete Audio')),
  r('Licht', 'Ausbau Licht', D30, '23:00', '00:00', N('Complete Audio')),
  r('Video', 'Ausbau Video', D30, '23:00', '00:00', N('TSE')),
  r('Ton', 'Ausbau PA', D30, '23:00', '00:00', N('TSE')),
  r('Rigging', 'Ausbau Rigging', D30, '23:00', '00:00', N('BigRig')),
  r('Besucher-Gastro', 'Ausbau Ticketing', D30, '23:00', '00:00', N('Trinity')),
  r('Besucher-Gastro', 'Ausbau Besuchergastro', D30, '23:00', '00:00', N('Trinity F&B')),

  // ── Mo 31.08. ──────────────────────────────────────────────────────────────
  r('Produktion', 'Produktion vor Ort', D31, '08:00', '18:00', N('Produktion')),
  r('Produktion', 'Sitecrew vor Ort', D31, '08:00', '18:00', N('Produktion')),
  r('Produktion', 'Staplerfahrer vor Ort', D31, '08:00', '18:00', N('Produktion', '4× StageCo, 1× Site, 2× Gastro')),
  r('Sanitätsdienst', 'Sanitäter vor Ort', D31, '08:00', '18:00', N('ASB')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D31, '00:00', '08:00', N('BEST')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D31, '18:00', '00:00', N('BEST')),
  r('Catering', 'Catering-Zeiten', D31, '12:00', '15:00', N('Morsh')),
  r('Besucher-Gastro', 'Abbau Besuchergastro', D31, '08:00', '18:00', N('Trinity F&B')),
  r('Licht', 'Ausbau Licht', D31, '00:00', '03:00', N('Complete Audio')),
  r('Video', 'Ausbau Video', D31, '00:00', '03:00', N('TSE')),
  r('Ton', 'Ausbau PA', D31, '00:00', '03:00', N('TSE')),
  r('Rigging', 'Ausbau Rigging', D31, '00:00', '03:00', N('BigRig')),
  r('Bühne', 'Abbau Bühne Tag 1', D31, '08:00', '18:00', N('StageCo')),
  r('Zäune & Absperrung', 'Abbau Barriers Bühne / 2nd Barrier', D31, '08:00', '15:00', N('EPS')),
  r('Besucher-Gastro', 'Abbau Ticketing', D31, '08:00', '18:00', N('Trinity')),
  r('Branding', 'Abbau Banner Look & Feel', D31, '08:00', '18:00', N('Site')),
  r('Branding', 'Abbau Banner Notausgänge', D31, '08:00', '18:00', N('Site')),
  r('Artist Care', 'Abbau Artist-Möblierung', D31, '08:00', '12:00', N('Site')),
  r('Sanitär', 'Abbau Besucher-Toiletten', D31, '08:00', '18:00', N('Wölkchen')),
  r('Logistik', 'Abholung Container Kassen / Backstage', D31, '12:00', '18:00', N('Wölkchen')),

  // ── Di 01.09. ──────────────────────────────────────────────────────────────
  r('Produktion', 'Produktion vor Ort', S01, '08:00', '18:00', N('Produktion')),
  r('Produktion', 'Sitecrew vor Ort', S01, '08:00', '18:00', N('Produktion')),
  r('Produktion', 'Staplerfahrer vor Ort', S01, '08:00', '18:00', N('Produktion', '4× StageCo, 1× Site')),
  r('Sanitätsdienst', 'Sanitäter vor Ort', S01, '08:00', '18:00', N('ASB')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', S01, '00:00', '08:00', N('BEST')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', S01, '18:00', '00:00', N('BEST')),
  r('Catering', 'Catering-Zeiten', S01, '12:00', '14:00', N('Morsh')),
  r('Besucher-Gastro', 'Abbau Besuchergastro', S01, '08:00', '18:00', N('Trinity F&B')),
  r('Bühne', 'Abbau Bühne Tag 2', S01, '08:00', '18:00', N('StageCo')),
  r('Zelte', 'Abbau Zelte Einlass, BEST/UG Aufenthalt, Artist', S01, '08:00', '18:00', N('Zelte Bereit')),
  r('Strom', 'Abbau Strom', S01, '08:00', '18:00', N('Mobile Energy')),
  r('Logistik', 'Abholung Container Bühne, Produktion', S01, '08:00', '18:00', N('Wölkchen')),
  r('Zäune & Absperrung', 'Abbau Zäune', S01, '08:00', '18:00', N('Site')),
  r('Catering', 'Abbau Kücheneinrichtung', S01, '14:00', '18:00', N('Site / Morsh')),

  // ── Mi 02.09. ──────────────────────────────────────────────────────────────
  r('Produktion', 'Produktion vor Ort', S02, '08:00', '18:00', N('Produktion')),
  r('Produktion', 'Sitecrew vor Ort', S02, '08:00', '18:00', N('Produktion')),
  r('Produktion', 'Staplerfahrer vor Ort', S02, '08:00', '18:00', N('Produktion', '4× StageCo, 1× Site')),
  r('Sanitätsdienst', 'Sanitäter vor Ort', S02, '08:00', '18:00', N('ASB')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', S02, '00:00', '08:00', N('BEST')),
  r('Catering', 'Catering-Zeiten', S02, '12:00', '15:00', N('extern')),
  r('Besucher-Gastro', 'Abbau Besuchergastro', S02, '08:00', '18:00', N('Trinity F&B')),
  r('Bühne', 'Abbau Bühne Tag 3', S02, '08:00', '18:00', N('StageCo')),
  r('Zelte', 'Abbau Küchen- / Catering-Zelte', S02, '08:00', '18:00', N('Zelte Bereit')),
  r('Sanitär', 'Abbau Wasser', S02, '08:00', '18:00'),
  r('Strom', 'Abbau Strom', S02, '08:00', '14:00', N('Mobile Energy')),
  r('Logistik', 'Abholung Container Produktion', S02, '14:00', '18:00', N('Wölkchen')),
  r('Zäune & Absperrung', 'Abbau Zäune', S02, '08:00', '14:00', N('Site')),
  r('Licht', 'Abbau Lichtmasten', S02, '08:00', '14:00', N('Site')),

  // ── Do 03.09. — Geländerückgabe ────────────────────────────────────────────
  r('Produktion', 'Produktion vor Ort', S03, '08:00', '18:00', N('Produktion')),
  r('Logistik', 'Abholung Fahrzeuge', S03, '08:00', '14:00', N('Trafö')),
  r('Produktion', 'Geländerückgabe', S03, '08:00', '14:00', N(CL)),
  r('Strom', 'Auslesen Stromzähler', S03, '08:00', '14:00', N(CL)),
  r('Sanitär', 'Auslesen Wasserzähler', S03, '08:00', '14:00', N(CL)),
];

// ── Rohvorgänge (tageweise) ──────────────────────────────────────────────────
const gewerke = GEWERKE.map((name, i) => ({ id: 'g' + i, name, sort: i, slot: i }));
const gid = new Map(gewerke.map((g) => [g.name, g.id]));

const raw = ROWS.map((x) => {
  const notes = (x.note || '').trim();
  if (x.ms) return { title: x.t, gewerk: 'projekt', start: x.ms, end: x.ms, milestone: true, notes, estimated: false };
  const { start, end } = span(x.day, x.s, x.e);
  return { title: x.t, gewerk: gid.get(x.gw), start, end, milestone: false, notes, estimated: !!x.est };
});

// ── Gleichnamiges zu je EINEM Balken zusammenfassen ──────────────────────────
// V03 listet mehrtägige Tätigkeiten (Objektbewachung, „vor Ort"-Schichten,
// Aufbau/Abbau, Ein-/Ausbau, Show-Betrieb) TAGEWEISE — im Gantt stapeln sich
// daraus gleichnamige Zeilen. Regel: gleiche (Gewerk + Titel) → ein durchgehender
// Balken (frühester Start, spätestes Ende). Unterschiedliche Titel (Bühne Tag 1/2/3,
// einzelne Container-Anlieferungen, „Ein-" vs. „Ausbau") bleiben getrennt.
// ISO-Zeitstempel (YYYY-MM-DDTHH:MM) lassen sich direkt als String vergleichen.
const groups = new Map();
for (const t of raw) {
  const key = t.milestone ? 'ms|' + t.title : t.gewerk + '|' + t.title;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(t);
}
const dienst = (note) => (note || '').split(' · ')[0];
const merged = [];
for (const g of groups.values()) {
  if (g.length === 1) { merged.push(g[0]); continue; }
  const start = g.reduce((a, t) => (t.start < a ? t.start : a), g[0].start);
  const end = g.reduce((a, t) => (t.end > a ? t.end : a), g[0].end);
  const uniq = [...new Set(g.map((t) => t.notes).filter(Boolean))];
  const notes = uniq.length <= 1 ? (uniq[0] || '')
    : [...new Set(g.map((t) => dienst(t.notes)).filter(Boolean))].join(' / ') + ' · mehrtägig (V03 tageweise)';
  merged.push({ ...g[0], start, end, notes, estimated: g.every((t) => t.estimated) });
}
merged.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

const tasks = merged.map((t, i) => ({
  id: 't' + i, gewerk: t.gewerk, title: t.title, start: t.start, end: t.end,
  milestone: t.milestone, progress: 0, status: 'geplant', crew: null, notes: t.notes, estimated: t.estimated,
}));

const deps = [];   // V03 ist ein terminierter Kalender — keine erfundenen Verknüpfungen.

const plan = {
  project: {
    id: 'klassentreffen-festival-2026',
    name: 'Klassentreffen Festival 2026',
    venue: '',
    start: '2026-08-21T00:00',
    end: '2026-09-03T23:59',
    timezone: 'Europe/Berlin',
  },
  gewerke,
  tasks,
  deps,
};

export { plan };

if (process.argv[1] && process.argv[1].endsWith('make-klassentreffen.mjs')) {
  writeFileSync(join(here, '..', 'klassentreffen-festival.json'), serialize(plan));
  const est = tasks.filter((t) => t.estimated).length;
  const used = new Set(tasks.filter((t) => t.gewerk !== 'projekt').map((t) => t.gewerk));
  console.log('  ✓ klassentreffen-festival.json (aus V03)');
  console.log(`    ${gewerke.length} Gewerke (${used.size} belegt) · ${tasks.length} Vorgänge · ${tasks.filter((t) => t.milestone).length} Meilenstein · ${deps.length} Verknüpfungen`);
  console.log(`    ${est} Vorgänge mit geschätzter Uhrzeit (Rest quellentreu aus V03)`);
}
