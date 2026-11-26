# Bauzeitenplan (Callboard) — statische Auslieferung, kein Build-Schritt.
# Coolify-App aus Branch `live`, Port 80, Domain callboard.nyxlightwork.de (docs/admin-auftrag-online-phase2.md).
# Allowlist: NUR die ausgelieferten Dateien kommen ins Image (kein docs/, tools/, tests/, pocketbase/,
# .superpowers/, .claude/). `.dockerignore` sperrt zusätzlich alles, was hier nicht kopiert wird;
# `tests/run.mjs` prüft beides gegen HUELLE in sw.js.
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html print.html login.html sw.js /usr/share/nginx/html/
COPY js/ /usr/share/nginx/html/js/
COPY styles/ /usr/share/nginx/html/styles/
COPY assets/ /usr/share/nginx/html/assets/

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
