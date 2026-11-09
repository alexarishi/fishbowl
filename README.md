# Fishbowl – online party game

Three rounds with the same cards: **Describe → Act it out → One word**.
Host a game, share the link (`https://yourdomain.com/r/ABCD`), everyone joins with just a name.
Best played on a video call (guessers shout answers, the clue giver taps **Got it!**).

## Run locally
    node server.js            # http://localhost:3000   (Node 18+, no npm install needed)
    PORT=8080 MIN_PLAYERS=2 node server.js     # optional env vars
    node test_game.js         # automated end-to-end game test

## Deploy on your own domain
It's one tiny Node process (no database, no dependencies). Any of these work:

**A. Render / Railway / Fly.io (container or Node service)**
1. Push this folder to a GitHub repo.
2. Create a new *Web Service* from the repo (Render: runtime Node, start command `node server.js`, no build command; or use the included Dockerfile).
3. Add your domain under *Custom Domains* and create the DNS record they show (CNAME for `www`/subdomain, or A/ALIAS for the apex).
   HTTPS is issued automatically.
   Note: free tiers may sleep after inactivity (first load is slow) and rooms live in memory, so a restart ends active games.

**B. Your own VPS (always on)**
    docker build -t fishbowl . && docker run -d --restart=always -p 3000:3000 fishbowl
Then put Caddy in front for automatic HTTPS (Caddyfile):
    yourdomain.com {
        reverse_proxy localhost:3000 { flush_interval -1 }
    }
If you use nginx instead, add `proxy_buffering off;` for `/api/events` (live updates use Server-Sent Events).

## Notes
- Game state is held in memory; idle rooms are cleaned up automatically. Health check: `/healthz`.
- Players who refresh or lose connection rejoin automatically (identity is stored in the browser).
- Host-controlled settings: cards per player, turn length, skips per turn, carry-over of leftover time.

## Netlify + free backend (split hosting)
Netlify only hosts static files, so the game server runs separately (Render free web service, see `render.yaml`).
1. Deploy this repo to Render as a Web Service (Node, start command `node server.js`, Free plan). Note its URL, e.g. `https://fishbowl-xxxx.onrender.com`.
2. Edit `public/config.js`:  `window.FISHBOWL_API = 'https://fishbowl-xxxx.onrender.com';`
3. Deploy the repo to Netlify (publish directory `public`, no build command). `public/_redirects` makes invite links (/r/ABCD) work.
4. In Render, set env var `ALLOWED_ORIGIN` to your Netlify/custom-domain URL(s), comma-separated.
