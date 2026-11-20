// Palettenprüfung für tools/farbsuche.mjs (ersetzt den entfallenen Import aus dem dataviz-Skill).
// validate(palette, {mode, surface}) -> { report: [[Name, ok, Meldung], …] }
//   ok ist true / false / 'fail' (harte Verletzung der Normalsicht-Grenze); Meldungen tragen «ΔE <Zahl>».
// ΔE = euklidischer Abstand in OKLab × 100 (Ottosson 2020). CVD-Simulation: Machado et al. 2009, Schweregrad 1,0
// (Protanopie, Deuteranopie, Tritanopie), gerechnet in linearem sRGB.

const lin = (u) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);
const voll = (h) => (h.length === 4 ? '#' + [...h.slice(1)].map((c) => c + c).join('') : h);
const rgbLin = (hex) => ((hex = voll(hex)), [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255)));

// WCAG-Relative-Luminanz und Kontrast (gleiche Rechnung wie tests/run.mjs).
export const lum = (hex) => { const [r, g, b] = rgbLin(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const kontrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}
const dE = (p, q) => 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

const CVD = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const sim = (c, M) => M.map((z) => Math.min(1, Math.max(0, z[0] * c[0] + z[1] * c[1] + z[2] * c[2])));

// Kleinster Abstand benachbarter Töne (Palettenreihenfolge = Zeilenreihenfolge im Plan, nur Nachbarn stehen aneinander).
function minPaar(labs) {
  let m = Infinity;
  for (let i = 0; i + 1 < labs.length; i++) m = Math.min(m, dE(labs[i], labs[i + 1]));
  return m;
}

// Grenzen: Helligkeitsband (OKLab-L) je Modus, Mindest-Chroma, Mindestabstand bei Normalsicht.
const BAND = { light: [0.35, 0.85], dark: [0.45, 0.90] };
const CHROMA_MIN = 0.09;
const NORMAL_MIN = 5;

export function validate(palette, { mode = 'light', surface = '#ffffff' } = {}) {
  const lin3 = palette.map(rgbLin);
  const labs = lin3.map(oklab);
  const normal = minPaar(labs);
  let cvd = Infinity;
  for (const M of Object.values(CVD)) cvd = Math.min(cvd, minPaar(lin3.map((c) => oklab(sim(c, M)))));
  const [lo, hi] = BAND[mode] || BAND.light;
  const Ls = labs.map((l) => l[0]);
  const bandOk = Ls.every((l) => l >= lo && l <= hi);
  const chromaOk = labs.every((l) => Math.hypot(l[1], l[2]) >= CHROMA_MIN);
  const kmin = Math.min(...palette.map((h) => kontrast(h, surface)));
  return {
    report: [
      ['CVD separation', cvd >= 5, `ΔE ${cvd.toFixed(1)} (kleinster Nachbarabstand unter Protan/Deutan/Tritan)`],
      ['Normal-vision floor', normal >= NORMAL_MIN ? true : 'fail', `ΔE ${normal.toFixed(1)} (Grenze ${NORMAL_MIN})`],
      ['Lightness band', bandOk, `L ${Math.min(...Ls).toFixed(2)}–${Math.max(...Ls).toFixed(2)} (Band ${lo}–${hi})`],
      ['Chroma floor', chromaOk, `Chroma ≥ ${CHROMA_MIN}`],
      ['Contrast on surface', kmin >= 3, `${kmin.toFixed(2)}:1 auf ${surface}`],
    ],
  };
}
