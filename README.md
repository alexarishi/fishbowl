# Fishbowl – online party game

Three rounds with the same cards: **Describe -> Act it out -> One word**.
Host a game, share the link (`https://yourdomain.com/r/ABCD`), everyone joins with just a name.
Best played on a video call (guessers shout answers, the clue giver taps **Got it!**).

## Features
- **Teams:** after cards are written the host can *Shuffle randomly* (as often as they like) or *Pick manually* and put each
  player on a team (or move / unassign them). Continue unlocks when everyone is on a team and each team has a player.
- **Team names:** the host names their own team; one player on the other team names theirs (a name box appears for them).
  Max 20 characters, names must differ, blank = default. Teams and names lock when the host confirms the teams.
- **End-of-turn review (only for the player whose turn just ended):** when a turn ends (timer runs out, *End my turn*, or
  the bowl empties) that player lands on a screen listing every card that came up. Tap a card to tick it (guessed but missed)
  or untick it (counted by mistake), then confirm. **Nobody else gets a review screen or the list** – everyone else goes
  straight to the next turn's "Up next" screen. The next player's Start button shows "Almost ready…" until the review is
  confirmed, and the scores others see only update at that moment. If the reviewing player goes offline, only the host gets a
  "continue" button so the game can't get stuck.

## Run locally
    node server.js            # http://localhost:3000   (Node 18+, no npm install needed)
    PORT=8080 MIN_PLAYERS=2 node server.js     # optional env vars
    node test_game.js         # turn-review tests
    node test_teams.js        # manual teams + team-name tests

## Deploy on Render (free)
1. Put these files at the top level of a GitHub repo.
2. Render -> New -> Web Service -> pick the repo. Runtime Node, build `npm install`, start `node server.js`, plan Free.
3. Settings -> Custom Domains -> add your (sub)domain and create the DNS record Render shows.
Leave `public/config.js` as is (`window.FISHBOWL_API = ''`).
Free services sleep after ~15 min idle; game rooms live in memory so a restart ends active games. Health check: `/healthz`.
