// ── Anmeldeseite (login.html) ────────────────────────────────────────────────
// Vier Abläufe auf einer Seite, gewählt über die Adresse:
//   (ohne)        Anmelden · «Passwort vergessen»
//   ?einladung=T  Name + Passwort (2×) → POST /api/bzp/einladung → angemeldet; oder mit vorhandenem Konto
//   ?reset=T      neues Passwort (2×) → confirm-password-reset
// Kein SDK, kein alert/confirm/prompt: Rückmeldungen stehen im Hinweisfeld (#lg-hinweis).
import { createPb, apiBasis } from './pb.js';

const $ = (id) => document.getElementById(id);
const MIN_PW = 10;
const q = new URLSearchParams(location.search);
const pb = createPb({ basis: apiBasis(), autostart: false });

// Nach der Anmeldung zur App; ?api= (nur lokal wirksam, siehe apiBasis) bleibt erhalten.
const weiter = () => {
  const api = q.get('api');
  location.replace('index.html' + (api ? '?api=' + encodeURIComponent(api) : ''));
};

function hinweis(text, art = 'fehler') {
  const h = $('lg-hinweis');
  h.textContent = text || '';
  h.dataset.art = art;
  h.hidden = !text;
}

const FORMS = ['f-anmelden', 'f-vergessen', 'f-einladung', 'f-reset', 'f-fertig'];
const TEXTE = {
  anmelden: ['Anmelden', 'Melde dich mit deiner E-Mail-Adresse an.'],
  konto: ['Einladung annehmen', 'Melde dich mit deinem Konto an, dann wirst du dem Plan hinzugefügt.'],
  vergessen: ['Passwort vergessen', 'Wir schicken dir einen Link zum Zurücksetzen.'],
  einladung: ['Einladung annehmen', 'Lege dein Konto an, um dem Plan beizutreten.'],
  reset: ['Neues Passwort', 'Wähle ein neues Passwort für dein Konto.'],
  fertig: ['Passwort geändert', ''],
};
function zeige(modus, meldung) {
  const form = { anmelden: 'f-anmelden', konto: 'f-anmelden', vergessen: 'f-vergessen', einladung: 'f-einladung', reset: 'f-reset', fertig: 'f-fertig' }[modus];
  for (const f of FORMS) $(f).hidden = f !== form;
  $('lg-titel').textContent = TEXTE[modus][0];
  $('lg-sub').textContent = TEXTE[modus][1];
  $('lg-sub').hidden = !TEXTE[modus][1];
  $('a-knopf').textContent = modus === 'konto' ? 'Anmelden und annehmen' : 'Anmelden';
  $('a-vergessen').hidden = modus === 'konto';
  $('a-einl-zurueck').hidden = modus !== 'konto';
  hinweis(meldung?.text, meldung?.art);
  const erst = $(form).querySelector('input');
  if (erst) erst.focus();
}

// Sperrt den Sendeknopf während der Anfrage (kein Doppelklick).
async function sende(form, fn) {
  const knopf = form.querySelector('button[type=submit]');
  knopf.disabled = true;
  try { await fn(); } finally { knopf.disabled = false; }
}

const fehlertext = (r, standard) => (r.code === 'netz' ? 'Keine Verbindung zum Server.' : r.status === 400 && r.message ? r.message : standard);

/** Zwei Passwörter: gleich und lang genug; sonst Hinweis und false. */
function passwortOk(a, b) {
  if (a.length < MIN_PW) { hinweis(`Das Passwort braucht mindestens ${MIN_PW} Zeichen.`); return false; }
  if (a !== b) { hinweis('Die beiden Passwörter sind nicht gleich.'); return false; }
  return true;
}

// ── Anmelden (auch «mit vorhandenem Konto» bei einer Einladung) ──
$('f-anmelden').addEventListener('submit', (ev) => {
  ev.preventDefault();
  sende(ev.currentTarget, async () => {
    const email = $('a-email').value.trim();
    const pw = $('a-pw').value;
    if (!email || !pw) return hinweis('Bitte E-Mail und Passwort eingeben.');
    const r = await pb.anmelden(email, pw);
    if (!r.ok) return hinweis(r.code === 'netz' ? 'Keine Verbindung zum Server.' : r.status === 400 ? 'E-Mail oder Passwort stimmt nicht.' : fehlertext(r, 'Anmeldung nicht möglich.'));
    const einl = q.get('einladung');
    if (einl) {
      const a = await pb.post('/api/bzp/einladung', { token: einl });
      if (!a.ok) { pb.abmelden(); return hinweis(fehlertext(a, 'Einladung konnte nicht angenommen werden.')); }
    }
    weiter();
  });
});
$('a-vergessen').addEventListener('click', () => zeige('vergessen'));
$('a-einl-zurueck').addEventListener('click', () => zeige('einladung'));

// ── Passwort vergessen: Antwort immer gleich, es wird nicht verraten, ob die Adresse bekannt ist ──
$('f-vergessen').addEventListener('submit', (ev) => {
  ev.preventDefault();
  sende(ev.currentTarget, async () => {
    const email = $('v-email').value.trim().toLowerCase();
    if (!email) return hinweis('Bitte die E-Mail-Adresse eingeben.');
    const r = await pb.post('/api/collections/users/request-password-reset', { email });
    if (r.code === 'netz') return hinweis('Keine Verbindung zum Server.');
    hinweis('Wenn die Adresse bekannt ist, kommt eine Mail.', 'ok');
  });
});
$('v-zurueck').addEventListener('click', () => zeige('anmelden'));

// ── Einladung annehmen (neues Konto) ──
$('f-einladung').addEventListener('submit', (ev) => {
  ev.preventDefault();
  sende(ev.currentTarget, async () => {
    const name = $('e-name').value.trim();
    const pw = $('e-pw').value;
    if (!name) return hinweis('Bitte einen Namen angeben.');
    if (!passwortOk(pw, $('e-pw2').value)) return;
    const r = await pb.post('/api/bzp/einladung', { token: q.get('einladung'), name, passwort: pw });
    if (!r.ok) {
      if (/schon ein Konto/.test(r.message || '')) return zeige('konto', { text: r.message });
      return hinweis(fehlertext(r, 'Einladung konnte nicht angenommen werden.'));
    }
    // Die Antwort nennt die eingeladene Adresse; damit melden wir das neue Konto gleich an.
    const a = await pb.anmelden(r.daten.email, pw);
    if (!a.ok) return zeige('anmelden', { text: 'Dein Konto ist angelegt. Bitte melde dich jetzt an.', art: 'ok' });
    weiter();
  });
});
$('e-konto').addEventListener('click', () => zeige('konto'));

// ── Passwort zurücksetzen (Link aus der Mail) ──
$('f-reset').addEventListener('submit', (ev) => {
  ev.preventDefault();
  sende(ev.currentTarget, async () => {
    const pw = $('r-pw').value;
    if (!passwortOk(pw, $('r-pw2').value)) return;
    const r = await pb.post('/api/collections/users/confirm-password-reset', { token: q.get('reset'), password: pw, passwordConfirm: pw });
    if (!r.ok) return hinweis(r.code === 'netz' ? 'Keine Verbindung zum Server.' : 'Der Link ist ungültig oder abgelaufen. Fordere einen neuen an.');
    zeige('fertig', { text: 'Dein Passwort wurde geändert.', art: 'ok' });
  });
});
$('z-anmelden').addEventListener('click', () => { location.replace('login.html' + (q.get('api') ? '?api=' + encodeURIComponent(q.get('api')) : '')); });

// ── Start ──
zeige(q.get('reset') ? 'reset' : q.get('einladung') ? 'einladung' : 'anmelden');
