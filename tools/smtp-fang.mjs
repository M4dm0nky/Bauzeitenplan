// Minimaler SMTP-Empfänger für Prüfungen (geteilt von verify-mehrbenutzer.mjs und verify-pb-regeln.mjs).
import { createServer as tcpServer } from 'node:net';

// Minimaler SMTP-Empfänger: sammelt Mails, damit der Reset-Link aus der echten PB-Mail kommt.
export function smtpEmpfaenger() {
  const mails = [];
  const socks = new Set();
  const s = tcpServer((sock) => {
    socks.add(sock); sock.on('close', () => socks.delete(sock));
    let puffer = '', daten = null;
    sock.write('220 localhost ESMTP\r\n');
    sock.on('data', (d) => {
      puffer += d.toString('latin1');
      for (;;) {
        if (daten !== null) {
          const i = puffer.indexOf('\r\n.\r\n');
          if (i < 0) return;
          mails.push(daten + puffer.slice(0, i)); daten = null; puffer = puffer.slice(i + 5);
          sock.write('250 OK\r\n'); continue;
        }
        const i = puffer.indexOf('\r\n');
        if (i < 0) return;
        const z = puffer.slice(0, i).toUpperCase(); puffer = puffer.slice(i + 2);
        if (z.startsWith('DATA')) { daten = ''; sock.write('354 go\r\n'); }
        else if (z.startsWith('QUIT')) { sock.write('221 bye\r\n'); sock.end(); }
        else if (z.startsWith('EHLO')) sock.write('250 localhost\r\n');
        else sock.write('250 OK\r\n');
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r({ s, mails, port: s.address().port, schliessen: () => { for (const k of socks) k.destroy(); s.close(); } })));
}
export const qp = (t) => t.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
