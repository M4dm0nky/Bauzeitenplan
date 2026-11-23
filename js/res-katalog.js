// ── Eingebaute Helfer und Maschinen ───────────────────────────────────────────
// Kein DOM, keine Imports. Feste Bezeichnungen in Kategorien: Die Auswahl im
// Plan wählt aus diesem Katalog; eigene Bezeichnungen kommen in `project.
// ressourcen` dazu (resources.js führt beides zusammen).
//
// Die ids sind STABIL — sie stehen in `t.res[].rid` und damit im Export. Ein
// Test pinnt sie; umbenennen heißt: Altpläne zeigen ins Leere.

/** Kategorien in Anzeigereihenfolge; `eigene-*` fangen alles Selbstangelegte ein. */
export const RES_KATEGORIEN = [
  { id: 'stapler', label: 'Stapler', kind: 'maschine' },
  { id: 'telelader', label: 'Teleskoplader', kind: 'maschine' },
  { id: 'schere-halle', label: 'Scherenbühne Halle (Elektro)', kind: 'maschine' },
  { id: 'schere-gelaende', label: 'Gelände-Scherenbühne (Diesel, Allrad)', kind: 'maschine' },
  { id: 'gelenk', label: 'Gelenkteleskopbühne', kind: 'maschine' },
  { id: 'buehne-sonst', label: 'Sonstige Bühnen', kind: 'maschine' },
  { id: 'sonstiges', label: 'Sonstiges', kind: 'maschine' },
  { id: 'helfer', label: 'Helfer', kind: 'personal' },
  { id: 'eigene-m', label: 'Eigene Maschinen', kind: 'maschine' },
  { id: 'eigene-p', label: 'Eigenes Personal', kind: 'personal' },
];

const e = (kat, kind, liste) => liste.map(([id, label]) => ({ id, label, kind, kat }));

/** Die festen Einträge, in Tabellenreihenfolge. */
export const RES_EINGEBAUT = [
  ...e('stapler', 'maschine', [
    ['m-stapler-bis35', 'Gabelstapler bis 3,5 t'], ['m-stapler-ueber35', 'Gabelstapler über 3,5 t'],
    ['m-gelstapler-bis35', 'Geländestapler bis 3,5 t'], ['m-gelstapler-ueber35', 'Geländestapler über 3,5 t']]),
  ...e('telelader', 'maschine', [
    ['m-tele-7', 'Teleskoplader starr 7 m'], ['m-tele-14', 'Teleskoplader starr 14 m'],
    ['m-tele-17', 'Teleskoplader starr 17 m'], ['m-tele-rotor', 'Teleskoplader Rotor (16–26 m)']]),
  ...e('schere-halle', 'maschine', [
    ['m-schere-8', 'Scherenbühne 8 m'], ['m-schere-10', 'Scherenbühne 10 m'],
    ['m-schere-12', 'Scherenbühne 12 m'], ['m-schere-14', 'Scherenbühne 14 m']]),
  ...e('schere-gelaende', 'maschine', [
    ['m-gelschere-10', 'Gelände-Scherenbühne 10 m'], ['m-gelschere-12', 'Gelände-Scherenbühne 12 m'],
    ['m-gelschere-15', 'Gelände-Scherenbühne 15 m'], ['m-gelschere-18', 'Gelände-Scherenbühne 18 m']]),
  ...e('gelenk', 'maschine', [
    ['m-gelenk-16', 'Gelenkteleskopbühne 16 m'], ['m-gelenk-20', 'Gelenkteleskopbühne 20 m'],
    ['m-gelenk-26', 'Gelenkteleskopbühne 26 m']]),
  ...e('buehne-sonst', 'maschine', [['m-raupe', 'Raupenarbeitsbühne'], ['m-lkw-buehne', 'LKW-Arbeitsbühne']]),
  ...e('sonstiges', 'maschine', [['m-mobilkran', 'Mobilkran'], ['m-radlader', 'Radlader'], ['m-hubwagen', 'Hubwagen']]),
  ...e('helfer', 'personal', [
    ['p-stagehand', 'Stagehand'], ['p-rigger', 'Rigger (Höhe)'], ['p-groundrigger', 'Ground-Rigger'],
    ['p-staplerfahrer', 'Staplerfahrer'], ['p-elektro', 'Elektrofachkraft'], ['p-runner', 'Runner']]),
];
