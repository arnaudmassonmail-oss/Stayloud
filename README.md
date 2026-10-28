# STAYLOUD — Radar Metal

Application web (installable sur téléphone) pour suivre ses groupes de metal : actualités, concerts près de chez soi, albums et extraits, clips, radio métal, amis.

En ligne : https://stayloud-radar.online

## Organisation

- `public/index.html` : toute l'interface (une seule page), `public/sw.js` : mode hors ligne, `public/confidentialite.html` : politique de confidentialité.
- `src/server.js` : serveur Express (API, comptes, amis, partages, concerts signalés, administration).
- `src/d1.js` : base Cloudflare D1 (comptes et données des utilisateurs) ; `src/db.js` : copie locale SQLite.
- `src/providers/` : sources de données (MusicBrainz, Deezer, concerts : Concerts-Metal, Sueur de Metal, Songkick, Bandsintown ; radio : Radio Browser).
- `src/apicache.js` : cache partagé des réponses des services extérieurs ; `src/health.js` : surveillance des sources de concerts ; `src/ratelimit.js` : protection contre les essais de mots de passe.
- `docs/notes/` : notes de chaque version.

## Lancer en local

```
npm install
npm start          # http://localhost:8787
```

Variables utiles (sur Render) : `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID`, `CLOUDFLARE_API_TOKEN` (base D1), `RESEND_API_KEY` (e-mails), `TICKETMASTER_API_KEY` (🎫 Billets : concerts en vente sur Ticketmaster, clé gratuite sur developer.ticketmaster.com), `SETLISTFM_API_KEY` (setlists des concerts passés, clé gratuite sur setlist.fm/settings/api), `YOUTUBE_API_KEY` (clips lus dans l’app, clé gratuite « YouTube Data API v3 » sur console.cloud.google.com), `APP_PUBLIC_URL`, `ADMIN_USERS` (administrateurs), `SCRAPERAPI_KEY` (relais gratuit pour lire les agendas qui bloquent le serveur, compte sur scraperapi.com ; `SCRAPERAPI_PREMIUM=1` pour son mode renforcé), `JINA_API_KEY` (autre relais, payant en tokens, utilisé si `SCRAPERAPI_KEY` est vide), `PHOTO_WIDE_SEARCH=1` (recherche de photos sur le web, désactivée par défaut).

## Tests

```
npm test
```

Les tests n'utilisent pas Internet : la base D1 est simulée et les services extérieurs sont remplacés par de fausses réponses. Ils se lancent automatiquement sur GitHub à chaque pull request (`.github/workflows/tests.yml`).
