# Fishbowl – online party game

Three rounds with the same cards: **Describe → Act it out → One word**.
Host a game, share the link (`https://yourdomain.com/r/ABCD`), everyone joins with just a name.
Best played on a video call (guessers shout answers, the clue giver taps **Got it!**).

## New in this version
1. **End-of-turn review (only for the player whose turn just ended).** When a turn ends (timer runs out, *End my turn*,
   or the bowl empties) that player lands on a screen listing every card that came up. Tap a card to tick it (guessed but
   missed) or untick it (counted by mistake), then confirm. Everyone else only sees "<name> is reviewing their cards…" –
   the list is never sent to them. If that player goes offline the host gets a "continue without review" button.
2. **Custom team names.** The host names their own team; one **random** player from the opposite team names the other.
   (If that player is offline the host can step in.) Max 20 characters, names must differ, blank = default.
3. **Manual team distribution.** Besides *Shuffle randomly*, the host can tap *Pick manually* and put every player on a
   team (or move them across / take them off). *Looks good* unlocks when everyone is on a team and each team has at least
   one player. Naming opens once everyone is placed. Shuffling or starting over resets the names. Teams and names lock
   when the host confirms the teams.

## Run locally
    node server.js            # http://localhost:3000   (Node 18+, no npm install needed)
    PORT=8080 MIN_PLAYERS=2 node server.js     # optional env vars
    node test_game.js         # turn-review tests
    node test_teams.js        # manual teams + team-name tests

## Deploy on Render (free)
1. Put these files at the top level of a GitHub repo.
2. Render -> New -> Web Service -> pick the repo. Runtime Node, build `npm install`, start `node server.js`, plan Free.
3. Settings -> Custom Domains -> add your (sub)domain and create the DNS record Render shows.
Free services sleep after ~15 min idle; game rooms live in memory so a restart ends active games. Health check: `/healthz`.
