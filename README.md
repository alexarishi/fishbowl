# Fishbowl – online party game

Three rounds with the same cards: **Describe → Act it out → One word**.
Host a game, share the link (`https://yourdomain.com/r/ABCD`), everyone joins with just a name.
Best played on a video call (guessers shout answers, the clue giver taps **Got it!**).

When a turn ends (timer runs out, bowl empties, or the clue giver taps *End my turn*) the clue giver gets a
**review screen** listing every card that came up. Tick cards that were guessed but missed, untick any counted
by mistake, then confirm. Everyone else sees the same list read-only. The host can also edit/confirm as a fallback.

## Run locally
    node server.js            # http://localhost:3000   (Node 18+, no npm install needed)
    PORT=8080 MIN_PLAYERS=2 node server.js     # optional env vars
    node test_game.js         # automated end-to-end game test

## Deploy on Render (free)
1. Put these files at the top level of a GitHub repo.
2. Render -> New -> Web Service -> pick the repo. Runtime Node, build `npm install`, start `node server.js`, plan Free.
3. Settings -> Custom Domains -> add your (sub)domain and create the DNS record Render shows.
Leave `public/config.js` as is (`window.FISHBOWL_API = ''`).
Free services sleep after ~15 min idle; game rooms live in memory so a restart ends active games. Health check: `/healthz`.
