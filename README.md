# Fishbowl – online party game

Three rounds with the same cards: **Describe → Act it out → One word**.
Host a game, share the link (`https://yourdomain.com/r/ABCD`), everyone joins with just a name.
Best played on a video call (guessers shout answers, the clue giver taps **Got it!**).

When a turn ends (timer runs out, bowl empties, or the clue giver taps *End my turn*) the clue giver gets a
**review screen** listing every card that came up. Tick cards that were guessed but missed, untick any counted
by mistake, then confirm. Everyone else sees the same list read-only. The host can also edit/confirm as a fallback.

## Teams
After everyone has submitted cards the host sees a **Set up the teams** screen:
- **Shuffle randomly** – draws balanced random teams (use it again any time to re-roll).
- **Pick manually** – clears the teams so the host can assign each player with one tap, or use the **→ other team** button to move players.
- **Looks good** is enabled once every player is on a team and both teams have at least one player (uneven teams are allowed).
Other players see the teams update live and can't change them. Teams lock when the first round starts.

### Team names
Teams start as *Team Coral* and *Team Seafoam*. On the same screen:
- the **host** types a name for **their own team**;
- **one player on the other team** (the first one on that team) types a name for **theirs**; everyone else sees "<name> chooses this team's name";
- if the other team is empty or offline, the host can name it too. A blank name resets to the default.
Names are max 20 characters and must differ. If the host moves the name-picker to another team, the job passes to the next player. Names reset after *Play again*.

## Run locally
    node server.js            # http://localhost:3000   (Node 18+, no npm install needed)
    PORT=8080 MIN_PLAYERS=2 node server.js     # optional env vars
    node test_game.js         # automated end-to-end game test
    node test_teams.js        # team selection tests
    node test_names.js        # team naming tests

## Deploy on Render (free)
1. Put these files at the top level of a GitHub repo.
2. Render -> New -> Web Service -> pick the repo. Runtime Node, build `npm install`, start `node server.js`, plan Free.
3. Settings -> Custom Domains -> add your (sub)domain and create the DNS record Render shows.
Leave `public/config.js` as is (`window.FISHBOWL_API = ''`).
Free services sleep after ~15 min idle; game rooms live in memory so a restart ends active games. Health check: `/healthz`.
