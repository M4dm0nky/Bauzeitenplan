// Einrichten als eigene Seite: Status je Bereich und die Prüfung «außerhalb des
// Projektzeitraums». Reine Rechnung, DOM-frei.
import { toMin, toDate } from './schedule.js';
import { planSpanne } from './timeaxis.js';
import { local } from './conflicts.js';
import { artOf } from './ebene.js';

/** Phasen/Vorgänge mit eigenem Termin, die vor project.start beginnen oder nach project.end enden. */
export function ausserhalb(state) {
  const von = toMin(state.project.start), bis = toMin(state.project.end);
  const raus = (x) => !!x.start && !!x.end && (toMin(x.start) < von || toMin(x.end) > bis);
  return {
    phasen: (state.phases || []).filter(raus).length,
    vorgaenge: (state.tasks || []).filter(raus).length,
  };
}

/** Die Hülle aus planSpanne als lokale Strings, gleiche Form wie project.start. */
export function zeitraumHuelle(state) {
  const { von, bis } = planSpanne(state);
  return { start: local(toDate(von)), end: local(toDate(bis)) };
}

/** 'ok' | 'warn' | 'leer' je Bereich der Einrichten-Seite. */
export function einrichtStatus(state) {
  const p = state.project || {};
  return {
    projekt: (p.name || '').trim() ? 'ok' : 'leer',
    phasen: (a => a.phasen + a.vorgaenge)(ausserhalb(state)) > 0 ? 'warn' : (state.phases || []).length ? 'ok' : 'leer',
    baender: (state.gewerke || []).some((g) => artOf(g) === 'gewerk') ? 'ok' : 'leer',
    res: 'ok',   // eingebaute Bezeichnungen gibt es immer
    arten: (p.punktTypen || []).length || (p.abschnitte || []).length ? 'ok' : 'leer',
  };
}
