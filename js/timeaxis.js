// ── Zeitachse: Zeit ↔ Pixel, Zoom, Tick-Erzeugung ─────────────────────────────
// Reine Funktionen, kein DOM. Ein einziges Konzept trägt alle Zoomstufen:
// pxPerMinute. Die Stufen sind nur Presets darauf.

// Die Presets sind danach gewählt, was auf einem ~1300 px breiten Zeitfeld
// tatsächlich SICHTBAR ist — nicht nach runden px-Werten. Eine „Tages"-Ansicht,
// die nur 1,8 Tage zeigt, ist keine Tagesansicht.
export const ZOOM = {
  monate:  { px: 0.02, label: 'Monate'  },  //   29 px/Tag → ~45 Tage: ganzes Projekt
  wochen:  { px: 0.08, label: 'Wochen'  },  //  115 px/Tag → ~11 Tage: Aufbau + Show
  tage:    { px: 0.25, label: 'Tage'    },  //  360 px/Tag → ~3,6 Tage: die Aufbauwoche
  stunden: { px: 1.5,  label: 'Stunden' },  //   90 px/Std → ~14 Std: der Load-In-Tag
};
const ZOOM_MIN = 0.008, ZOOM_MAX = 4.0;

export const clampZoom = (px) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, px));

/** Nächstgelegenes Zoom-Preset zu einem pxPerMinute-Wert (für die Button-Anzeige). */
export function nearestPreset(px) {
  let best = null, bestD = Infinity;
  for (const [k, v] of Object.entries(ZOOM)) {
    // im Log-Raum vergleichen — Zoom ist multiplikativ, nicht additiv
    const d = Math.abs(Math.log(px) - Math.log(v.px));
    if (d < bestD) { bestD = d; best = k; }
  }
  return best;
}

/**
 * Zoom mit festem Ankerpunkt: der Zeitpunkt unter dem Cursor bleibt stehen.
 * Ohne das springt der Plan beim Zoomen weg und man verliert die Stelle.
 * @returns {number} neues scrollLeft
 */
export function zoomAnchored({ scrollLeft, anchorX, oldPx, newPx }) {
  const timeAtAnchor = (scrollLeft + anchorX) / oldPx; // Minuten seit t0
  return timeAtAnchor * newPx - anchorX;
}

// ── Tick-Erzeugung ────────────────────────────────────────────────────────────
// Nur Ticks im (gepufferten) Viewport erzeugen. Bei Stundenzoom über 3 Monate
// wären es sonst >4000 Beschriftungen im DOM.

const DAY_NAMES = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const startOfMonth = (d) => { const x = new Date(d); x.setDate(1); x.setHours(0, 0, 0, 0); return x; };
const startOfWeek = (d) => {
  const x = startOfDay(d);
  const shift = (x.getDay() + 6) % 7; // Montag = 0 (DIN/ISO)
  x.setDate(x.getDate() - shift);
  return x;
};

/**
 * Wählt die Granularität der beiden Header-Zeilen anhand des Zooms.
 * Obere Zeile = grobe Einheit, untere = feine.
 */
export function tickScale(pxPerMinute) {
  if (pxPerMinute >= 1.2)  return { major: 'day',   minor: 'hour3' };
  if (pxPerMinute >= 0.45) return { major: 'day',   minor: 'hour6' };
  if (pxPerMinute >= 0.16) return { major: 'week',  minor: 'day'   };
  if (pxPerMinute >= 0.05) return { major: 'month', minor: 'day'   };
  return { major: 'month', minor: 'week' };
}

/**
 * Erzeugt Ticks einer Einheit im Zeitfenster [from, to].
 * @returns {{t: Date, label: string, weekend?: boolean}[]}
 */
export function ticksFor(unit, from, to) {
  const out = [];
  let cur;
  switch (unit) {
    case 'hour3':
    case 'hour6': {
      const step = unit === 'hour3' ? 3 : 6;
      cur = startOfDay(from);
      while (cur <= to) {
        if (cur >= from) out.push({ t: new Date(cur), label: String(cur.getHours()).padStart(2, '0') });
        cur.setHours(cur.getHours() + step);
      }
      break;
    }
    case 'day': {
      cur = startOfDay(from);
      while (cur <= to) {
        const wd = cur.getDay();
        if (cur >= from) out.push({
          t: new Date(cur),
          label: String(cur.getDate()),
          sub: DAY_NAMES[wd],
          weekend: wd === 0 || wd === 6,
        });
        cur.setDate(cur.getDate() + 1);
      }
      break;
    }
    case 'week': {
      cur = startOfWeek(from);
      while (cur <= to) {
        if (cur >= startOfWeek(from)) out.push({ t: new Date(cur), label: 'KW ' + isoWeek(cur) });
        cur.setDate(cur.getDate() + 7);
      }
      break;
    }
    case 'month': {
      cur = startOfMonth(from);
      while (cur <= to) {
        out.push({ t: new Date(cur), label: MONTH_NAMES[cur.getMonth()] + ' ' + cur.getFullYear() });
        cur.setMonth(cur.getMonth() + 1);
      }
      break;
    }
  }
  return out;
}

/** ISO-8601-Kalenderwoche (DIN 1355) — der Donnerstag entscheidet das Jahr. */
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

/** Wochenend-Bänder im Fenster — als Hintergrund, nicht als Tick. */
export function weekendBands(from, to) {
  const out = [];
  const cur = startOfDay(from);
  while (cur <= to) {
    const wd = cur.getDay();
    if (wd === 6) { // Samstag 00:00 → Montag 00:00
      const end = new Date(cur); end.setDate(end.getDate() + 2);
      out.push({ from: new Date(cur), to: end });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export const fmtTime = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
export const fmtDay = (d) => DAY_NAMES[d.getDay()] + ' ' + d.getDate() + '. ' + MONTH_NAMES[d.getMonth()];
export const fmtDur = (min) => {
  if (min === 0) return 'Meilenstein';
  const h = min / 60;
  if (h < 24) return h % 1 === 0 ? h + ' h' : h.toFixed(1).replace('.', ',') + ' h';
  const d = h / 24;
  return (d % 1 === 0 ? d : d.toFixed(1).replace('.', ',')) + ' Tage';
};
export const fmtFloat = (min) => {
  if (min <= 0) return 'kein Puffer';
  const h = min / 60;
  if (h < 48) return Math.round(h) + ' h Puffer';
  return Math.round(h / 24) + ' Tage Puffer';
};
