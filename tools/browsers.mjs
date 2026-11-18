// ── Playwright-Browser finden, auf Mac, Windows und Linux ────────────────────
// Die Prüfwerkzeuge riefen Firefox früher über einen festen Mac-Pfad
// (`~/Library/Caches/ms-playwright/…/Nightly.app`) — auf Windows brach jeder
// Browserlauf mit ENOENT ab, bevor er etwas prüfte. Die Suche steht jetzt an
// EINER Stelle. Einmalig holen: node node_modules/playwright-core/cli.js install firefox chromium
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || (
  process.platform === 'darwin' ? join(homedir(), 'Library/Caches/ms-playwright')
  : process.platform === 'win32' ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData/Local'), 'ms-playwright')
  : join(homedir(), '.cache/ms-playwright'));

const ls = (d) => { try { return readdirSync(d); } catch { return []; } };
// Neueste Revision zuerst: nach einem Update liegen alte Ordner noch daneben.
const neueste = (prefix) => ls(cache).filter((d) => d.startsWith(prefix))
  .sort((a, b) => Number(b.split('-').pop()) - Number(a.split('-').pop()));

export function firefoxExe() {
  for (const d of neueste('firefox-')) {
    const base = join(cache, d, 'firefox');
    const p = process.platform === 'darwin' ? join(base, 'Nightly.app/Contents/MacOS/firefox')
      : process.platform === 'win32' ? join(base, 'firefox.exe') : join(base, 'firefox');
    if (existsSync(p)) return p;
  }
  return null;
}

// Nicht raten: auf dem Mac heißt der Ordner `chrome-mac` oder `chrome-mac-arm64`
// und das Programm mal `Chromium.app`, mal «Google Chrome for Testing.app».
// Ein abgebrochener Download hinterlässt einen leeren Ordner — deshalb wird
// das Programm selbst geprüft, nicht der Ordner.
export function chromiumExe() {
  for (const d of neueste('chromium-')) {
    const bin = join(cache, d);
    for (const arch of ls(bin).filter((x) => x.startsWith('chrome-'))) {
      if (process.platform === 'darwin') {
        const app = ls(join(bin, arch)).find((x) => x.endsWith('.app'));
        const p = app && join(bin, arch, app, 'Contents/MacOS', app.replace(/\.app$/, ''));
        if (p && existsSync(p)) return p;
      } else {
        const p = join(bin, arch, process.platform === 'win32' ? 'chrome.exe' : 'chrome');
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

export function mustFirefox() {
  const p = firefoxExe();
  if (!p) {
    console.error('Firefox für Playwright fehlt in ' + cache + '\n  Einmalig: node node_modules/playwright-core/cli.js install firefox');
    process.exit(2);
  }
  return p;
}
