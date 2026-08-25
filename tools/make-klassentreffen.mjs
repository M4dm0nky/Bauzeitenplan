// ── Klassentreffen Festival 2026 ──────────────────────────────────────────────
// Baut aus dem „Bauzeitenplan V07, Stand 25.08.2026" eine importierbare JSON.
// V07 löst V06 vollständig ab: was dort nicht mehr steht, ist hier nicht mehr
// drin; was neu dazukam, ist aufgenommen. Kein Nachtrag, sondern der Plan.
//
//   node tools/make-klassentreffen.mjs   →  klassentreffen-festival.json
//
// QUELLENTREUE ist die oberste Regel:
//   • Tag UND Uhrzeit stammen aus V07 (Spalten Beginn/Ende) → estimated: false.
//   • Zeilen OHNE gedruckte Uhrzeit (Kran vor Ort, Sanitäter an einzelnen Tagen,
//     Gelenk-Teleskop-Bühne, Einlasschleusen, Soundcheck) bekommen das
//     Tagesfenster 08:00–18:00, estimated: true und sagen es in der Notiz.
//   • Dienstleister · Anmerkung · Kopfzahl stehen in der Notiz — nichts geht verloren.
//   • KEINE erfundenen Abhängigkeiten. V07 ist ein terminierter Kalender. deps: [].
//
// Container-Zeilen: V07 druckt die komplette Stückliste in die Spalte «Aktion»
// («Anlieferung 1x Trio Anlage (Team Spindler), 1x Duo Anlage (AvS), 5x
// Solocontainer …»). Als Balkenbeschriftung ist das unbrauchbar — deshalb trägt
// der Titel die kurze Form und die NOTIZ die vollständige gedruckte Liste,
// Zeichen für Zeichen. Pro Tag gibt es höchstens eine solche Zeile, die Kurzform
// ist also eindeutig. Gleiches Verfahren wie in V06, nur mit den neuen Listen.
//
// Gewerk-Modell: unverändert 20 Gewerke. Das ist exakt MAX_SLOTS aus
// js/palette.js — ein 21. Gewerk sprengt die Palette und verlangt eine neue
// Farbsuche (tools/farbsuche.mjs). Der Test hält das fest.

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serialize } from '../js/persistence.js';

const here = dirname(fileURLToPath(import.meta.url));

// ── Gewerke (Reihenfolge = Farbplatz) ────────────────────────────────────────
const GEWERKE = [
  'Bühne', 'Rigging', 'Licht', 'Ton', 'Video', 'Pyro', 'Catering', 'Sanitär',
  'Produktion', 'Strom', 'Zäune & Absperrung', 'Zelte', 'Security', 'Branding',
  'Artist Care', 'Show', 'Logistik', 'Besucher-Gastro', 'Sanitätsdienst', 'Crew',
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
const EST = 'Uhrzeit in V07 nicht angegeben';

// r(Gewerk, Titel, Tag, Beginn, Ende, Notiz?, est?) — ein Vorgang
const r = (gw, t, day, s, e, note = '', est = false) => ({ gw, t, day, s, e, note, est });
// e08(Gewerk, Titel, Tag, Notiz) — Zeile ohne V07-Uhrzeit → Tagesfenster, geschätzt
const e08 = (gw, t, day, note = '') => r(gw, t, day, '08:00', '18:00', N(note, EST), true);
// cont(Titel, Tag, Beginn, Ende, Stückliste, Hinweis?) — Container-/Kabinenzeile:
// kurzer Titel, vollständige gedruckte Liste in der Notiz. Der Hinweis vermerkt
// Abweichungen vom Druckbild.
const cont = (t, day, s, e, liste, hinweis = '') => r('Logistik', t, day, s, e, N('Wölkchen', liste, hinweis));

// Tage
const [D21, D22, D23, D24, D25, D26, D27, D28, D29, D30, D31, S01, S02, S03] = [
  '2026-08-21', '2026-08-22', '2026-08-23', '2026-08-24', '2026-08-25', '2026-08-26',
  '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01',
  '2026-09-02', '2026-09-03',
];
const CL = 'Carsten Langenfeld';
const SX = '36StageXL';

// ── Vorgänge nach V07, Tag für Tag ───────────────────────────────────────────
const ROWS = [
  // ── Fr 21.08. (Seite 1) ────────────────────────────────────────────────────
  r('Produktion', 'Produktion vor Ort', D21, '08:00', '18:00'),
  e08('Logistik', 'Kran vor Ort', D21, 'Mobi Hub'),
  e08('Sanitätsdienst', 'Sanitäter vor Ort', D21),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D21, '18:00', '00:00', N('BEST', 'Ende in V07 «open»'), true),
  r('Crew', 'SITECREW', D21, '10:00', '18:00', N(SX, 'Michael + 2 Helfer')),
  r('Crew', 'SITECREW STAPLER', D21, '10:00', '18:00', N(SX, '1 Fahrer (auch Tele)')),
  r('Crew', 'HELFER eps', D21, '10:00', '12:00', N(SX, '2 Helfer')),
  r('Crew', 'HELFER mobile energy', D21, '12:00', '18:00', N(SX, '2 Helfer')),
  r('Crew', 'STAPLERFAHRER eps', D21, '10:00', '12:00', N(SX, '1 Fahrer')),
  r('Crew', 'STAPLERFAHRER mobile energy', D21, '12:00', '18:00', N(SX, '1 Fahrer')),
  r('Catering', 'Catering Zeiten', D21, '12:00', '14:00', N('SunnyBorrito')),
  r('Produktion', 'Übergabe Gelände', D21, '08:00', '09:00', N(CL)),
  r('Strom', 'Ablesen Strom Zählerstände', D21, '08:00', '09:00', N(CL)),
  r('Sanitär', 'Ablesen Wasser Zählerstände', D21, '08:00', '09:00', N(CL)),
  r('Logistik', 'Anlieferung Müllpresse', D21, '08:00', '18:00', N('ALBA')),
  r('Logistik', 'Anlieferung Mülltonnen', D21, '08:00', '18:00', N('ALBA')),
  r('Produktion', 'Einzeichnen Gelände', D21, '08:00', '18:00', N('RDB')),
  r('Logistik', 'Anlieferung Fuhrpark', D21, '08:00', '10:00', N('Trafö')),
  r('Zäune & Absperrung', 'Anlieferung Zäune', D21, '10:00', '12:00', N('EPS')),
  r('Strom', 'Anlieferung Strom', D21, '12:00', '18:00', N('Mobile Energy')),
  // In V06 standen die beiden Wasser-Zeilen am 22.08. — V07 zieht sie auf den 21.
  r('Sanitär', 'Aufbau Wasserversorgung Crew Catering', D21, '12:00', '14:00'),
  r('Sanitär', 'Aufbau Wasserversorgung WC Container Artist', D21, '11:00', '12:00'),
  r('Zelte', 'Aufbau Zelte Crew Catering + Küche, 6x6er Artist', D21, '08:00', '18:00', N('Zelte Bereit')),
  cont('Anlieferung Container', D21, '08:00', '12:00',
    '1x Trio Anlage (Team Spindler), 1x Duo Anlage (AvS), 5x Solocontainer (STM, Stageco, Dienstleister, stagecrew, IT), 2x WC Container (Produktion, Stage)'),

  // ── Sa 22.08. (Seite 2) ────────────────────────────────────────────────────
  r('Produktion', 'Produktion vor Ort', D22, '08:00', '18:00', N('Produktion')),
  e08('Logistik', 'Kran vor Ort', D22, 'Mobi Hub'),
  e08('Sanitätsdienst', 'Sanitäter vor Ort', D22),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D22, '00:01', '23:59', N('BEST')),
  r('Crew', 'SITECREW', D22, '08:00', '18:00', N(SX, 'Michael + 4 Helfer')),
  r('Crew', 'SITECREW STAPLER', D22, '08:00', '18:00', N(SX, '1 Fahrer')),
  r('Crew', 'HELFER mobile energy', D22, '08:00', '18:00', N(SX, '2 Helfer')),
  r('Crew', 'STAPLERFAHRER mobile energy', D22, '08:00', '18:00', N(SX, '1 Fahrer')),
  r('Catering', 'Catering Zeiten', D22, '12:00', '14:00', N('SunnyBorrito')),
  r('Catering', 'Anlieferung Möbel Crew Catering', D22, '12:00', '14:00', N('Japo ?')),
  r('Produktion', 'Anlieferung Office-Material', D22, '08:00', '10:00', N('36StageXl', 'Karsten')),
  // Neu in V07 — in V06 gab es am 22.08. keine Container-Anlieferung.
  cont('Anlieferung Container', D22, '08:00', '18:00',
    '1x Duo Anlage (Security), 2x Solo Container (ME, Channel), 2x Lager (Cleaning, Site)'),
  r('Zelte', 'Aufbau Pagoden Artist, Hospitality, Inklusion, SiteCrew, Cleaning', D22, '08:00', '18:00', N('Zelte Bereit')),
  r('Strom', 'Aufbau Strom', D22, '08:00', '18:00', N('Mobile Energy')),
  r('Strom', 'Verstromung Produktionsbüro', D22, '08:00', '09:00', N('Mobile Energy')),
  r('Catering', 'Einrichten Crew Catering', D22, '14:00', '18:00', N('Morsh / Site')),
  r('Produktion', 'Einrichten Produktionsbüro', D22, '08:00', '10:00', N('Produktion')),
  r('Zäune & Absperrung', 'Aufbau Zäune Backstage', D22, '08:00', '18:00', N('Site')),
  r('Produktion', 'Einrichten Internet Produktionsbüro', D22, '08:00', '10:00', N('Yannik')),

  // ── So 23.08. (Seite 3) — auch in V07 kein baufreier Tag ───────────────────
  r('Produktion', 'Produktion vor Ort', D23, '08:00', '18:00', N('Produktion')),
  e08('Logistik', 'Kran vor Ort', D23, 'Mobi Hub'),
  e08('Sanitätsdienst', 'Sanitäter vor Ort', D23),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D23, '00:01', '23:59', N('BEST')),
  r('Crew', 'SITECREW', D23, '08:00', '18:00', N(SX, 'Michael + 4 Helfer')),
  r('Crew', 'SITECREW STAPLER', D23, '08:00', '18:00', N(SX, '1 Fahrer (auch Tele)')),
  r('Crew', 'HELFER mobile energy', D23, '08:00', '18:00', N(SX, '4 Helfer')),
  r('Crew', 'STAPLERFAHRER mobile energy', D23, '08:00', '18:00', N(SX, '1 Fahrer')),
  r('Catering', 'Catering Zeiten', D23, '12:00', '14:00', N('SunnyBorrito')),
  r('Zelte', 'Aufbau Pagoden Einlass, Merch, Gastro Check In, VIP Bar', D23, '08:00', '18:00', N('Zelte Bereit')),
  r('Strom', 'Verstromung Crew Catering', D23, '08:00', '12:00', N('Mobile Energy')),

  // ── Mo 24.08. (Seite 4) ────────────────────────────────────────────────────
  r('Produktion', 'Produktion vor Ort', D24, '08:00', '18:00', N('Produktion')),
  e08('Logistik', 'Kran vor Ort', D24, 'Mobi Hub'),
  r('Sanitätsdienst', 'Sanitäter vor Ort', D24, '08:00', '18:00', N('Pandemedics')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D24, '00:01', '23:59', N('BEST')),
  r('Crew', 'SITECREW', D24, '08:00', '18:00', N(SX, 'Michael + 2 Helfer')),
  r('Crew', 'SITECREW STAPLER', D24, '08:00', '18:00', N(SX, '1 Fahrer (auch Tele)')),
  r('Crew', 'HELFER mobile energy', D24, '08:00', '18:00', N(SX, '4 Helfer')),
  r('Crew', 'HELFER HypeIT', D24, '08:00', '18:00', N(SX, '2 Helfer')),
  r('Crew', 'STAPLERFAHRER mobile energy', D24, '08:00', '18:00', N(SX, '1 Fahrer')),
  r('Crew', 'STAPLERFAHRER stageco', D24, '13:00', '18:00', N(SX, '3 Fahrer')),
  r('Crew', 'STAPLERFAHRER HypeIT', D24, '08:00', '18:00', N(SX, '1 Fahrer')),
  r('Catering', 'Catering Zeiten', D24, '13:00', '15:00', N('Morsh')),
  r('Zelte', 'Aufbau Pagoden Partner, Bars, Top-Up-Stationen', D24, '08:00', '18:00', N('Zelte Bereit')),
  r('Zelte', 'Aufbau Artist Zelte / Pagoden', D24, '08:00', '14:00', N('Zelte Bereit')),
  r('Zelte', 'Aufbau Einlass Zelt', D24, '14:00', '18:00', N('Zelte Bereit')),
  r('Zelte', 'Aufbau Aufenthaltszelte BEST / UG', D24, '14:00', '18:00', N('Zelte Bereit')),
  r('Zelte', 'Aufbau Zelte Gastro', D24, '08:00', '18:00', N('Zelte Bereit')),
  r('Catering', 'Aufbau Klimatisierung Catering / Kitchen', D24, '08:00', '12:00', N('Helot')),
  // In V06 am 23.08. — V07 schiebt es auf den 24.
  r('Catering', 'Einrichten Crew Catering Zelt', D24, '08:00', '12:00', N('Site')),
  r('Strom', 'Verstromung Bühne / Backstage', D24, '10:00', '18:00', N('Mobile Energy')),
  cont('Anlieferung Container', D24, '08:00', '18:00',
    '2x Duo Anlage (Channel, Trinity), 4x Solocontainer (Office Sido, Artist Hospitality, Booking, Dressing Rooms), 1x WC Container (Produktion), 1x Maxi WC Container (Artist)'),
  r('Bühne', 'Anlieferung Stahl', D24, '08:00', '10:00', N('StageCo')),
  r('Bühne', 'Aufbau Bühne', D24, '08:00', '18:00', N('StageCo', 'Tag 1 von 3')),
  r('Produktion', 'Einrichten Internet Gelände', D24, '10:00', '18:00'),

  // ── Di 25.08. (Seite 5) ────────────────────────────────────────────────────
  r('Produktion', 'Produktion vor Ort', D25, '08:00', '18:00', N('Produktion')),
  r('Logistik', 'Kran vor Ort', D25, '12:00', '18:00', N('Mobi Hub', '60 to Kran')),
  r('Sanitätsdienst', 'Sanitäter vor Ort', D25, '08:00', '18:00', N('Pandemedics')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D25, '00:01', '23:59', N('BEST')),
  r('Crew', 'SITECREW', D25, '08:00', '18:00', N(SX, 'Michael + 2 Helfer')),
  r('Crew', 'SITECREW STAPLER', D25, '08:00', '18:00', N(SX, '1 Fahrer (auch Tele)')),
  r('Crew', 'HELFER HypeIT', D25, '08:00', '18:00', N(SX, '2 Helfer')),
  r('Crew', 'STAPLERFAHRER HypeIT', D25, '08:00', '18:00', N(SX, '1 Fahrer')),
  r('Crew', 'HELFER mobile energy', D25, '08:00', '18:00', N(SX, '4 Helfer')),
  r('Crew', 'STAPLERFAHRER mobile energy', D25, '08:00', '18:00', N(SX, '1 Fahrer')),
  r('Crew', 'STAPLERFAHRER stageco', D25, '08:00', '18:00', N(SX, '3 Fahrer')),
  r('Crew', 'CLIMBER stageco', D25, '08:00', '18:00', N(SX, '10 Climber')),
  r('Crew', 'STEELHANDS stageco', D25, '08:00', '18:00', N(SX, '10 Steelhands')),
  r('Catering', 'Catering Zeiten', D25, '12:00', '15:00', N('Morsh')),
  r('Strom', 'Verstromung Gelände', D25, '08:00', '18:00', N('Mobile Energy')),
  r('Strom', 'Verstromung Container', D25, '14:00', '18:00', N('Mobile Energy')),
  cont('Anlieferung Container', D25, '08:00', '18:00',
    '2x Duo Anlage (Sido/MJ, Savas/Samy), 2x Solocontainer (2x Büro), 1x Maxi Dusche (Artist), 3x WC Container (2x VIP, 1x Artist), 2x Kassencontainer, 14x Toilettenkabine, 8x Kabine Gastro, 12x Raketen'),
  r('Bühne', 'Aufbau Bühne', D25, '08:00', '18:00', N('StageCo', 'Tag 2 von 3')),
  r('Logistik', 'Abholung Schiri-Hochstuhl TC Blau-Weiß', D25, '10:00', '15:00', N(SX, '1x Patrick mit Sprinter')),
  r('Zäune & Absperrung', 'Aufbau Zäune / Infrastruktur', D25, '08:00', '18:00', N('SiteCrew')),

  // ── Mi 26.08. (Seite 6) ────────────────────────────────────────────────────
  r('Produktion', 'Produktion vor Ort', D26, '08:00', '18:00', N('Produktion')),
  r('Logistik', 'Kran vor Ort', D26, '08:00', '14:00', N('Mobi Hub', '60 to Kran')),
  r('Sanitätsdienst', 'Sanitäter vor Ort', D26, '08:00', '18:00', N('Pandemedics')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D26, '00:01', '23:59', N('BEST')),
  r('Crew', 'SITECREW', D26, '08:00', '18:00', N(SX, 'Michael + 6 Helfer')),
  r('Crew', 'SITECREW STAPLER', D26, '08:00', '18:00', N(SX, '1 Fahrer (auch Tele)')),
  r('Crew', 'HELFER mobile energy', D26, '08:00', '18:00', N(SX, '4 Helfer')),
  r('Crew', 'STAPLERFAHRER mobile energy', D26, '08:00', '18:00', N(SX, '1 Fahrer')),
  r('Crew', 'STAPLERFAHRER stageco', D26, '08:00', '18:00', N(SX, '3 Fahrer')),
  r('Crew', 'HELFER HypeIT', D26, '08:00', '18:00', N(SX, '2 Helfer')),
  r('Crew', 'CLIMBER stageco', D26, '08:00', '18:00', N(SX, '10 Climber')),
  r('Crew', 'STEELHANDS stageco', D26, '08:00', '18:00', N(SX, '10 Steelhands')),
  r('Catering', 'Catering Zeiten', D26, '12:00', '15:00', N('Morsh')),
  r('Artist Care', 'Anlieferung Backstagemöbel', D26, '08:00', '10:00', N('Japo')),
  r('Besucher-Gastro', 'Aufbau Besuchergastro', D26, '08:00', '18:00', N('Trinity F&B')),
  r('Sanitär', 'Aufbau Wasser Infrastruktur', D26, '08:00', '18:00'),
  r('Bühne', 'Aufbau Bühne', D26, '08:00', '18:00', N('StageCo', 'Tag 3 von 3')),
  cont('Anlieferung Kabinen', D26, '08:00', '18:00', '86x Toilettenkabine, 5x CAP Kabine, 8x Rakete'),
  r('Branding', 'Anbringen Banner Look & Feel', D26, '08:00', '18:00', N('Site')),
  r('Branding', 'Anbringen Banner Notausgänge', D26, '08:00', '18:00', N('Site')),
  r('Artist Care', 'Einrichten Artist Dressing Rooms', D26, '10:00', '18:00', N('Site')),
  r('Zelte', 'Einrichten Einlasszelte', D26, '08:00', '14:00', N('Site')),
  r('Logistik', 'Abholung Parkkrallen Boehlke', D26, '10:00', '15:00', N(SX, '1x Patrick mit Sprinter')),

  // ── Do 27.08. (Seite 7) ────────────────────────────────────────────────────
  r('Produktion', 'Produktion vor Ort', D27, '08:00', '18:00', N('Produktion')),
  r('Logistik', 'Kran vor Ort', D27, '08:00', '14:00', N('Mobi Hub', '60 to Kran')),
  e08('Logistik', 'Gelenk-Teleskop-Bühne vor Ort', D27, 'Trafö / Mateco'),
  r('Sanitätsdienst', 'Sanitäter vor Ort', D27, '08:00', '20:00', N('Pandemedics')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D27, '00:01', '23:59', N('BEST')),
  r('Crew', 'SITECREW', D27, '08:00', '18:00', N(SX, 'Michael + 4 Helfer')),
  r('Crew', 'SITECREW STAPLER', D27, '08:00', '18:00', N(SX, '1 Fahrer (auch Tele)')),
  r('Crew', 'HELFER eps', D27, '08:00', '16:00', N(SX, '8 Helfer')),
  r('Crew', 'HELFER HypeIT', D27, '08:00', '18:00', N(SX, '2 Helfer')),
  r('Crew', 'HELFER mobile energy', D27, '08:00', '18:00', N(SX, '4 Helfer')),
  r('Crew', 'HELFER tse', D27, '12:00', '20:00', N(SX, '12 Helfer')),
  r('Crew', 'HELFER complete audio', D27, '13:00', '20:00', N(SX, '1 CC + 18 Helfer')),
  r('Crew', 'STAPLERFAHRER tse', D27, '12:00', '20:00', N(SX, '2 Fahrer')),
  r('Crew', 'STAPLERFAHRER eps', D27, '08:00', '16:00', N(SX, '1 Fahrer')),
  r('Crew', 'STAPLERFAHRER mobile energy', D27, '08:00', '18:00', N(SX, '1 Fahrer')),
  // Zwei stageco-Zeilen mit verschiedener Besetzung — bleiben zwei Balken.
  r('Crew', 'STAPLERFAHRER stageco', D27, '08:00', '12:00', N(SX, '2 Fahrer')),
  r('Crew', 'STAPLERFAHRER stageco', D27, '08:00', '15:00', N(SX, '1 Fahrer')),
  r('Crew', 'CLIMBER stageco', D27, '08:00', '15:00', N(SX, '10 Climber')),
  r('Crew', 'STEELHANDS stageco', D27, '08:00', '15:00', N(SX, '10 Steelhands')),
  r('Catering', 'Catering Zeiten', D27, '12:00', '15:00', N('Morsh')),
  r('Besucher-Gastro', 'Aufbau Besuchergastro', D27, '08:00', '18:00', N('Trinity F&B')),
  r('Rigging', 'Einbau Rigging', D27, '12:00', '15:00', N('RDB')),
  r('Licht', 'Einbau Licht', D27, '13:00', '20:00', N('Complete Audio')),
  r('Video', 'Einbau Video', D27, '13:00', '20:00', N('TSE')),
  r('Ton', 'Einbau PA', D27, '13:00', '20:00', N('TSE')),
  r('Licht', 'Einrichten FOH', D27, '13:00', '20:00', N('Complete Audio')),
  r('Licht', 'Einleuchten / Programmierung', D27, '21:00', '00:00', N('Complete Audio')),
  r('Zäune & Absperrung', 'Aufbau Barriers Bühne / 2nd Barrier', D27, '08:00', '16:00', N('EPS')),
  r('Produktion', 'Abnahme Fliegende Bauten', D27, '12:00', '18:00', N('AvS / TÜV')),
  r('Besucher-Gastro', 'Aufbau Ticketing', D27, '12:00', '18:00', N('Trinity')),
  // Neu in V07.
  r('Security', 'Aufbau CCTV', D27, '08:00', '18:00', N('Movetos')),
  r('Branding', 'Anbringen Banner Look & Feel', D27, '08:00', '18:00', N('Site')),
  r('Branding', 'Anbringen Banner Notausgänge', D27, '08:00', '18:00', N('Site')),

  // ── Fr 28.08. (Seite 8) ────────────────────────────────────────────────────
  r('Produktion', 'Produktion vor Ort', D28, '08:00', '18:00', N('Produktion')),
  e08('Logistik', 'Kran vor Ort', D28, 'Mobi Hub'),
  r('Sanitätsdienst', 'Sanitäter vor Ort', D28, '08:00', '20:00', N('Pandemedics')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D28, '00:01', '23:59', N('BEST')),
  r('Crew', 'CATERING RUNNER morsh', D28, '08:00', '18:00', N(SX, '1 Fahrer mit Cargo Van')),
  r('Crew', 'SITECREW', D28, '08:00', '18:00', N(SX, 'Michael + 4 Helfer')),
  r('Crew', 'SITECREW STAPLER', D28, '08:00', '18:00', N(SX, '2 Fahrer')),
  r('Crew', 'HELFER eps', D28, '08:00', '16:00', N(SX, '4 Helfer')),
  r('Crew', 'HELFER mobile energy', D28, '08:00', '18:00', N(SX, '4 Helfer')),
  r('Crew', 'HELFER tse', D28, '09:00', '19:00', N(SX, '6 Helfer')),
  r('Crew', 'HELFER complete audio', D28, '09:00', '19:00', N(SX, '1 CC + 8 Helfer')),
  r('Crew', 'STAPLERFAHRER tse', D28, '09:00', '19:00', N(SX, '2 Fahrer')),
  r('Crew', 'TELESTAPLERFAHRER tse', D28, '09:00', '19:00', N(SX, '1 Fahrer')),
  r('Crew', 'STAPLERFAHRER eps', D28, '08:00', '16:00', N(SX, '1 Fahrer')),
  r('Crew', 'STAPLERFAHRER mobile energy', D28, '08:00', '18:00', N(SX, '1 Fahrer')),
  // In V06 durchgestrichen und deshalb weggelassen — in V07 steht sie regulär drin.
  r('Crew', 'SHOWCREW SIDO complete audio', D28, '16:00', '23:00', N(SX, '1 CC + 12 Helfer')),
  r('Catering', 'Catering Zeiten', D28, '12:00', '15:00', N('Morsh')),
  r('Besucher-Gastro', 'Aufbau Besuchergastro', D28, '08:00', '18:00', N('Trinity F&B')),
  r('Licht', 'Einbau / Restarbeiten Licht', D28, '08:00', '18:00', N('Complete Audio')),
  r('Rigging', 'Einbau Rigging', D28, '10:00', '20:00', N('RDB')),
  r('Video', 'Einbau / Restarbeiten Video', D28, '08:00', '18:00', N('TSE')),
  r('Ton', 'Einbau / Restarbeiten PA', D28, '08:00', '18:00', N('TSE')),
  r('Pyro', 'Einbau SFX', D28, '08:00', '23:00', N('TBA')),
  r('Licht', 'Einbau Floorset / Backline / Riser', D28, '08:00', '23:00', N('Complete Audio')),
  r('Licht', 'Einleuchten / Programmierung', D28, '21:00', '00:00', N('Complete Audio')),
  e08('Zäune & Absperrung', 'Aufbau Einlasschleusen', D28, 'EPS'),
  r('Produktion', 'Behördliche Abnahme', D28, '16:00', '17:30', N('AvS / Behörden', 'Treffpunkt Besuchereinlass')),
  e08('Ton', 'Soundcheck Zeiten gemäß Genehmigung', D28, 'AvS / TSE'),
  r('Branding', 'Anbringen Banner Look & Feel', D28, '08:00', '18:00', N('Site')),
  r('Branding', 'Anbringen Banner Notausgänge', D28, '08:00', '18:00', N('Site')),
  r('Licht', 'Stellen Lichtmasten', D28, '08:00', '18:00', N('Site')),
  r('Sanitätsdienst', 'Aufbau Sanitätsstationen', D28, '08:00', '18:00', N('ASB')),
  r('Produktion', 'Test Sicherheitsbeleuchtung', D28, '21:00', '22:00', N('Produktion')),

  // ── Sa 29.08. — Showtag 1 (Seiten 9+10) ────────────────────────────────────
  r('Produktion', 'Produktion vor Ort', D29, '08:00', '00:00', N('Produktion')),
  e08('Logistik', 'Kran vor Ort', D29, 'Mobi Hub'),
  r('Sanitätsdienst', 'Sanitäter vor Ort', D29, '22:30', '03:00', N('Pandemedics')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D29, '00:00', '08:00', N('BEST')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D29, '23:00', '00:00', N('BEST')),
  r('Crew', 'CATERING RUNNER morsh', D29, '08:00', '18:00', N(SX, '1 Fahrer mit Cargo Van')),
  // Neu in V07.
  r('Crew', 'CATERING ASSISTANT 1314Productions', D29, '10:00', '16:00', N(SX, '1 Catering Helfer')),
  r('Crew', 'SITECREW', D29, '08:00', '23:00', N(SX, 'Michael + 2 Helfer')),
  r('Crew', 'SITECREW', D29, '08:00', '14:00', N(SX, '2 Helfer')),
  r('Crew', 'SITECREW STAPLER', D29, '08:00', '23:00', N(SX, '1 Fahrer (auch Tele)')),
  r('Crew', 'SHOW CREW HELFER complete audio', D29, '08:00', '23:00', N(SX, '6 Helfer')),
  r('Crew', 'SHOW CREW STAPLER complete audio', D29, '08:00', '02:00', N(SX, '1 Fahrer')),
  r('Crew', 'SHOW CREW SIDO', D29, '08:00', '13:00', N(SX, '1 CC + 12 Helfer')),
  r('Crew', 'SHOW CREW SIDO', D29, '18:00', '02:00', N(SX, '1 CC + 10 Helfer')),
  r('Crew', 'KAMERA SIDO', D29, '18:00', '23:00', N('TSE', '2 Kameraleute')),
  r('Crew', 'SHOW CREW SPOTFAHRER', D29, '18:00', '23:00', N(SX, '6 Spotfahrer, call auf deutsch')),
  r('Crew', 'ABBAU SIDO', D29, '22:00', '02:00', N(SX, '6 Helfer (zusätzlich)')),
  r('Catering', 'Catering Zeiten', D29, '12:00', '16:00', N('Morsh')),
  r('Catering', 'Catering Zeiten', D29, '17:00', '21:00', N('Morsh')),
  r('Besucher-Gastro', 'Aufbau Besuchergastro', D29, '08:00', '11:00', N('Trinity F&B')),
  r('Rigging', 'Standby Rigging', D29, '08:00', '23:00', N('RDB')),
  r('Licht', 'Einbau / Restarbeiten Licht', D29, '08:00', '11:00', N('Complete Audio')),
  r('Video', 'Einbau / Restarbeiten Video', D29, '08:00', '11:00', N('TSE')),
  r('Ton', 'Einbau / Restarbeiten PA', D29, '08:00', '11:00', N('TSE')),
  r('Pyro', 'Restarbeiten SFX', D29, '08:00', '11:00', N('TBA')),
  r('Licht', 'Einbau Floorset / Backline / Riser', D29, '08:00', '11:00', N('Complete Audio')),
  r('Branding', 'Anbringen Banner Look & Feel', D29, '08:00', '11:00', N('Site')),
  r('Branding', 'Anbringen Banner Notausgänge', D29, '08:00', '11:00', N('Site')),
  r('Produktion', 'Security Meeting', D29, '09:00', '10:00'),
  r('Show', 'Fahrverbot auf dem Gelände', D29, '11:30', '23:00', N('ALLE')),
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

  // ── So 30.08. — Showtag 2 (Seiten 11+12) ───────────────────────────────────
  r('Produktion', 'Produktion vor Ort', D30, '08:00', '00:00', N('Produktion')),
  e08('Logistik', 'Kran vor Ort', D30, 'Mobi Hub'),
  r('Sanitätsdienst', 'Sanitäter vor Ort', D30, '22:30', '03:00', N('Pandemedics', 'Abbaubegleitung')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D30, '00:00', '08:00', N('BEST')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D30, '23:00', '00:00', N('BEST')),
  r('Crew', 'CATERING RUNNER morsh', D30, '08:00', '18:00', N(SX, '1 Fahrer mit Cargo Van')),
  r('Crew', 'CATERING ASSISTANT 1314Productions', D30, '10:00', '16:00', N(SX, '1 Catering Helfer')),
  r('Crew', 'SITECREW', D30, '08:00', '02:00', N(SX, 'Michael + 2 Helfer')),
  r('Crew', 'SITECREW STAPLER', D30, '08:00', '02:00', N(SX, '1 Fahrer (auch Tele)')),
  r('Crew', 'SHOW CREW HELFER', D30, '08:00', '23:00', N(SX, '6 Helfer')),
  r('Crew', 'SHOW CREW STAPLER', D30, '08:00', '23:00', N(SX, '1 Fahrer')),
  r('Crew', 'SHOW CREW SPOTFAHRER', D30, '18:00', '23:00', N(SX, '6 Fahrer')),
  r('Crew', 'HELFER mobile energy', D30, '22:00', '04:00', N(SX, '2 Helfer')),
  r('Crew', 'HELFER complete audio', D30, '22:00', '04:00', N(SX, '1 CC + 18 Helfer')),
  r('Crew', 'STAPLERFAHRER mobile energy', D30, '22:00', '04:00', N(SX, '1 Fahrer')),
  r('Crew', 'HELFER tse', D30, '22:00', '04:00', N(SX, '12 Helfer')),
  r('Crew', 'STAPLERFAHRER tse', D30, '22:00', '04:00', N(SX, '2 Fahrer')),
  r('Catering', 'Catering Zeiten', D30, '12:00', '16:00', N('Morsh')),
  r('Catering', 'Catering Zeiten', D30, '17:00', '21:00', N('Morsh')),
  r('Besucher-Gastro', 'Aufbau Besuchergastro', D30, '08:00', '11:00', N('Trinity F&B')),
  r('Rigging', 'Standby Rigging', D30, '08:00', '23:00', N('RDB')),
  r('Licht', 'Einbau / Restarbeiten Licht', D30, '08:00', '11:00', N('Complete Audio')),
  r('Video', 'Einbau / Restarbeiten Video', D30, '08:00', '11:00', N('TSE')),
  r('Ton', 'Einbau / Restarbeiten PA', D30, '08:00', '11:00', N('TSE')),
  r('Pyro', 'Restarbeiten SFX', D30, '08:00', '11:00', N('TBA')),
  r('Licht', 'Einbau Floorset / Backline / Riser', D30, '08:00', '11:00', N('Complete Audio')),
  r('Branding', 'Anbringen Banner Look & Feel', D30, '08:00', '11:00', N('Site')),
  r('Branding', 'Anbringen Banner Notausgänge', D30, '08:00', '11:00', N('Site')),
  r('Produktion', 'Security Meeting', D30, '09:00', '10:00'),
  r('Show', 'Fahrverbot auf dem Gelände', D30, '11:30', '23:00', N('ALLE')),
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

  // ── Mo 31.08. (Seite 13) ───────────────────────────────────────────────────
  r('Produktion', 'Produktion vor Ort', D31, '08:00', '18:00', N('Produktion')),
  r('Logistik', 'Kran vor Ort', D31, '10:00', '16:00', N('Mobi Hub', '60 to Kran')),
  r('Sanitätsdienst', 'Sanitäter vor Ort', D31, '08:00', '18:00', N('Pandemedics')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D31, '00:00', '08:00', N('BEST')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', D31, '18:00', '00:00', N('BEST')),
  r('Crew', 'CATERING RUNNER morsh', D31, '08:00', '18:00', N(SX, '1 Fahrer mit Cargo Van')),
  r('Crew', 'SITECREW', D31, '08:00', '18:00', N(SX, 'Michael + 6 Helfer')),
  r('Crew', 'SITECREW STAPLER', D31, '08:00', '18:00', N(SX, '1 Fahrer (auch Tele)')),
  r('Crew', 'HELFER eps', D31, '08:00', '18:00', N(SX, '10 Helfer')),
  r('Crew', 'HELFER mobile energy', D31, '08:00', '18:00', N(SX, '4 Helfer')),
  r('Crew', 'HELFER HypeIT', D31, '08:00', '18:00', N(SX, '2 Helfer')),
  r('Crew', 'STAPLERFAHRER HypeIT', D31, '08:00', '18:00', N(SX, '1 Fahrer')),
  r('Crew', 'STAPLERFAHRER eps', D31, '08:00', '18:00', N(SX, '1 Fahrer')),
  r('Crew', 'STAPLERFAHRER mobile energy', D31, '08:00', '18:00', N(SX, '1 Fahrer')),
  r('Crew', 'STAPLERFAHRER stageco', D31, '08:00', '18:00', N(SX, '3 Fahrer')),
  r('Crew', 'CLIMBER stageco', D31, '08:00', '18:00', N(SX, '10 Climber')),
  r('Crew', 'STEELHANDS stageco', D31, '08:00', '18:00', N(SX, '10 Steelhands')),
  r('Catering', 'Catering Zeiten', D31, '12:00', '15:00', N('Morsh')),
  r('Besucher-Gastro', 'Abbau Besuchergastro', D31, '08:00', '18:00', N('Trinity F&B')),
  // Fortsetzung der Nacht vom 30.: verschmilzt mit 23:00–00:00 zu EINEM Balken.
  r('Licht', 'Ausbau Licht', D31, '00:00', '03:00', N('Complete Audio')),
  r('Video', 'Ausbau Video', D31, '00:00', '03:00', N('TSE')),
  r('Ton', 'Ausbau PA', D31, '00:00', '03:00', N('TSE')),
  r('Rigging', 'Ausbau Rigging', D31, '00:00', '03:00', N('BigRig')),
  r('Bühne', 'Abbau Bühne', D31, '08:00', '18:00', N('StageCo', 'Tag 1 von 2')),
  r('Zäune & Absperrung', 'Abbau Barriers Bühne / 2nd Barrier', D31, '08:00', '15:00', N('EPS')),
  r('Besucher-Gastro', 'Abbau Ticketing', D31, '08:00', '18:00', N('Trinity')),
  // Neu in V07 — Gegenstück zum Aufbau am 27.
  r('Security', 'Abbau CCTV', D31, '08:00', '18:00', N('Movetos')),
  r('Branding', 'Abbau Banner Look & Feel', D31, '08:00', '18:00', N('Site')),
  r('Branding', 'Abbau Banner Notausgänge', D31, '08:00', '18:00', N('Site')),
  r('Artist Care', 'Abbau Artist Möblierung', D31, '08:00', '12:00', N('Site')),
  r('Sanitär', 'Abbau Besucher-Toiletten', D31, '08:00', '18:00', N('Wölkchen')),
  cont('Abholung Container', D31, '12:00', '18:00',
    '3x Duo Anlage (Trinity, Channel, Security), 4x Solocontainer (Booking, Channel, Artist Hospitality, Dressing Rooms), 1x Lagercontainer (Reinigung), 1x WC Container (Produktion), alle Kabinen'),
  r('Zelte', 'Abbau Zelte Einlass, Partner, Gastro-Check-In, TopUp, Merch', D31, '08:00', '18:00', N('Zelte Bereit')),
  r('Logistik', 'Rücklieferung Schiri-Hochstuhl TC Blau-Weiß', D31, '10:00', '15:00', N(SX, '1x Patrick mit Sprinter')),

  // ── Di 01.09. (Seite 14) ───────────────────────────────────────────────────
  r('Produktion', 'Produktion vor Ort', S01, '08:00', '18:00', N('Produktion')),
  e08('Logistik', 'Kran vor Ort', S01, 'Mobi Hub'),
  r('Sanitätsdienst', 'Sanitäter vor Ort', S01, '08:00', '18:00', N('Pandemedics')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', S01, '00:00', '08:00', N('BEST')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', S01, '18:00', '00:00', N('BEST')),
  r('Crew', 'SITECREW', S01, '08:00', '18:00', N(SX, 'Michael + 4 Helfer')),
  r('Crew', 'SITECREW STAPLER', S01, '08:00', '18:00', N(SX, '1 Fahrer (auch Tele)')),
  r('Crew', 'HELFER eps', S01, '08:00', '16:00', N(SX, '4 Helfer')),
  r('Crew', 'HELFER mobile energy', S01, '08:00', '18:00', N(SX, '4 Helfer')),
  r('Crew', 'STAPLERFAHRER eps', S01, '08:00', '16:00', N(SX, '1 Fahrer')),
  r('Crew', 'STAPLERFAHRER mobile energy', S01, '08:00', '18:00', N(SX, '1 Fahrer')),
  r('Crew', 'STAPLERFAHRER stageco', S01, '08:00', '18:00', N(SX, '3 Fahrer')),
  r('Crew', 'CLIMBER stageco', S01, '08:00', '18:00', N(SX, '10 Climber')),
  r('Crew', 'STEELHANDS stageco', S01, '08:00', '18:00', N(SX, '10 Steelhands')),
  r('Catering', 'Catering Zeiten', S01, '12:00', '14:00', N('Morsh')),
  r('Besucher-Gastro', 'Abbau Besuchergastro', S01, '08:00', '18:00', N('Trinity F&B')),
  r('Bühne', 'Abbau Bühne', S01, '08:00', '18:00', N('StageCo', 'Tag 2 von 2')),
  r('Zelte', 'Abbau Zelte Einlass, BEST / UG Aufenthalt, Artist', S01, '08:00', '18:00', N('Zelte Bereit')),
  r('Strom', 'Abbau Strom', S01, '08:00', '18:00', N('Mobile Energy')),
  cont('Abholung Container', S01, '08:00', '18:00',
    '3x WC Container (Artist, 2x VIP), 1x Maxi Dusche (Artist), 2x Kassencontainer'),
  r('Zäune & Absperrung', 'Abbau Zäune', S01, '08:00', '18:00', N('Site')),
  r('Zelte', 'Abbau Pagoden Artist, Bars, Reinigung, SiteCrew', S01, '08:00', '18:00', N('Zelte Bereit')),
  r('Catering', 'Abbau Kücheneinrichtung', S01, '14:00', '18:00', N('Site / Morsh')),

  // ── Mi 02.09. (Seite 15) ───────────────────────────────────────────────────
  r('Produktion', 'Produktion vor Ort', S02, '08:00', '18:00', N('Produktion')),
  r('Crew', 'Sitecrew vor Ort', S02, '08:00', '18:00', N('Produktion')),
  r('Crew', 'Staplerfahrer vor Ort', S02, '08:00', '18:00', N('Produktion')),
  e08('Logistik', 'Kran vor Ort', S02, 'Mobi Hub'),
  e08('Logistik', 'Gelenk-Teleskop-Bühne vor Ort', S02, 'Trafö / Mateco'),
  r('Sanitätsdienst', 'Sanitäter vor Ort', S02, '08:00', '18:00', N('Pandemedics')),
  r('Catering', 'Catering Zeiten', S02, '12:00', '14:00', N('extern')),
  r('Security', 'Sicherheitsdienst / Objektbewachung', S02, '00:00', '08:00', N('BEST')),
  e08('Security', 'Sicherheitsdienst / Objektbewachung', S02, 'BEST'),
  r('Crew', 'SITECREW', S02, '08:00', '18:00', N(SX, 'Michael + 2 Helfer')),
  r('Crew', 'SITECREW STAPLER', S02, '08:00', '18:00', N(SX, '1 Fahrer (auch Tele)')),
  r('Zelte', 'Abbau Küchen / Catering Zelte', S02, '08:00', '18:00', N('Zelte Bereit')),
  r('Sanitär', 'Abbau Wasser', S02, '08:00', '18:00'),
  r('Strom', 'Abbau Strom', S02, '08:00', '14:00', N('Mobile Energy')),
  cont('Abholung Container', S02, '14:00', '18:00',
    '1x Trio Anlage (Spindler), 2x Duo Anlage (Sido/MJ, Savas/Samy), 3x Solocontainer (Office Sido, 2x Büro), 1x Lagercontainer (Site), 2x WC Container (Produktion, Stage), 1x Maxi WC Container (Artist)'),
  r('Zäune & Absperrung', 'Abbau Zäune', S02, '08:00', '14:00', N('Site')),
  r('Zäune & Absperrung', 'Abholung Zäune', S02, '12:00', '18:00', N('EPS')),
  r('Licht', 'Abbau Lichtmasten', S02, '08:00', '14:00', N('Site')),

  // ── Do 03.09. (Seite 16) ───────────────────────────────────────────────────
  r('Produktion', 'Produktion vor Ort', S03, '08:00', '12:00', N('Produktion')),
  e08('Sanitätsdienst', 'Sanitäter vor Ort', S03),
  r('Logistik', 'Abholung Fahrzeuge', S03, '08:00', '12:00', N('Trafö')),
  // In V07 fehlt hier die schließende Klammer — vergessen, nicht abgeschnitten:
  // sechs Namen für 6x Solocontainer, und alle sechs sind vorher angeliefert
  // worden (21.08.: STM, Stageco, Dienstleister, stagecrew, IT · 22.08.: ME).
  // Die Klammer ist auf Ansage gesetzt, der Eingriff steht in der Notiz.
  cont('Abholung Container', S03, '14:00', '18:00',
    '1x Duo Anlage (AvS), 6x Solocontainer (STM, Stageco, Dienstleister, stagecrew, IT, ME)',
    'schließende Klammer in V07 nicht gedruckt'),
  r('Logistik', 'Abholung Müllpresse', S03, '08:00', '12:00', N('ALBA')),
  r('Logistik', 'Abholung Mülltonnen', S03, '08:00', '12:00', N('ALBA')),
  r('Produktion', 'Geländerückgabe', S03, '08:00', '12:00', N(CL)),
  r('Strom', 'Auslesen Stromzähler', S03, '08:00', '12:00', N(CL)),
  r('Sanitär', 'Auslesen Wasserzähler', S03, '08:00', '12:00', N(CL)),
];

// ── Rohvorgänge ──────────────────────────────────────────────────────────────
const gewerke = GEWERKE.map((name, i) => ({ id: 'g' + i, name, sort: i, slot: i }));
const gid = new Map(gewerke.map((g) => [g.name, g.id]));

const raw = ROWS.map((x) => {
  const { start, end } = span(x.day, x.s, x.e);
  const g = gid.get(x.gw);
  if (!g) throw new Error('unbekanntes Gewerk: ' + x.gw + ' («' + x.t + '»)');
  return { title: x.t, gewerk: g, start, end,
           milestone: false, notes: (x.note || '').trim(), estimated: !!x.est };
});

// ── Nur ECHTE Fortsetzungen zu je EINEM Balken ───────────────────────────────
// V07 listet mehrtägige Tätigkeiten tageweise. Verschmolzen wird ausschließlich,
// was ohne Unterbrechung weiterläuft: gleiches Gewerk, gleicher Titel, gleiche
// Notiz (Dienstleister UND Kopfzahl) — und die Zeiten müssen sich BERÜHREN oder
// überlappen. So wird aus «Ausbau Licht 30.08. 23:00–00:00» + «31.08. 00:00–03:00»
// ein Balken, und aus der Objektbewachung 23:00–00:00 + 00:00–08:00 die
// durchgehende Nachtschicht.
//
// Eine Wiederholung am Folgetag ist KEINE Fortsetzung: «Einleuchten 21:00–00:00»
// am 27. und am 28.08. bleiben zwei Balken, sonst sähe die Nacht dazwischen nach
// Durcharbeiten aus. Dasselbe gilt für «Fahrverbot» an beiden Showtagen und für
// «Produktion vor Ort» 08:00–18:00. Jede gedruckte V07-Zeile bleibt so sichtbar.
const anschluss = (a, b) => b.start <= a.end;

const groups = new Map();
for (const t of raw) {
  const key = [t.gewerk, t.title, t.notes].join('|');
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(t);
}

const merged = [];
for (const g of groups.values()) {
  g.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  let run = null;
  for (const t of g) {
    if (run && anschluss(run, t)) {
      if (t.end > run.end) run.end = t.end;
      run.estimated = run.estimated && t.estimated;
      continue;
    }
    run = { ...t };
    merged.push(run);
  }
}
merged.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

const tasks = merged.map((t, i) => ({
  id: 't' + i, gewerk: t.gewerk, title: t.title, start: t.start, end: t.end,
  milestone: false, progress: 0, status: 'geplant', crew: null, notes: t.notes, estimated: t.estimated,
}));

const deps = [];   // V07 ist ein terminierter Kalender — keine erfundenen Verknüpfungen.

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

export { plan, ROWS };

if (process.argv[1] && process.argv[1].endsWith('make-klassentreffen.mjs')) {
  writeFileSync(join(here, '..', 'klassentreffen-festival.json'), serialize(plan));
  const est = tasks.filter((t) => t.estimated).length;
  const used = new Set(tasks.map((t) => t.gewerk));
  console.log('  ✓ klassentreffen-festival.json (aus V07)');
  console.log(`    ${gewerke.length} Gewerke (${used.size} belegt) · ${ROWS.length} V07-Zeilen → ${tasks.length} Vorgänge · ${deps.length} Verknüpfungen`);
  console.log(`    ${est} Vorgänge mit geschätzter Uhrzeit (Rest quellentreu aus V07)`);
}
