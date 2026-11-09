# Fishbowl – online party game

Three rounds with the same cards: **Describe -> Act it out -> One word**.
Host a game, share the link (`https://yourdomain.com/r/ABCD`), everyone joins with just a name.
Best played on a video call (guessers shout answers, the clue giver taps **Got it!**).

## Features
- **Unique cards.** Every card in the bowl must be different. Cards are compared ignoring capital letters and extra spaces
  (`Apple` = `apple` = `APPLE` = ` aPPle `), but `Apple Pie` is a different card. The first player to submit a card owns it:
  a later player who submits the same card is NOT added and sees
  *"Something similar is already in the pool. Please change: apple"*, with the offending card(s) highlighted and the rest of
  their cards kept. The same card twice in your own list is refused too. The check runs on the server, so two players
  submitting at the same moment can't both get through. Tapping *Edit my cards* releases a player's cards again.
- **Your name, always visible.** A badge in the top corner shows who you are on every in-game screen
  (*Playing as Maya*, with your team's colour dot).
- **Up next, pinned to the bottom.** During play a bar at the bottom shows who goes after the current turn
  (*UP NEXT  Rishi · Team Seafoam*). It follows the real rotation (teams alternate, round-robin inside each team, offline
  players skipped). If it's you, the bar turns gold: *"You're up next – get ready!"* (and a short vibration on phones).
- **Teams:** after cards are written the host can *Shuffle randomly* (as often as they like) or *Pick manually* and put each
  player on a team (or move / unassign them). Continue unlocks when everyone is on a team and each team has a player.
- **Team names:** the host names their own team; one player on the other team names theirs.
  Max 20 characters, names must differ, blank = default. Teams and names lock when the host confirms the teams.
- **End-of-turn review (only for the player whose turn just ended):** that player lands on a screen listing every card that
  came up and can tick (guessed but missed) / untick (counted by mistake) before confirming. Nobody else gets a review
  screen or the list; everyone else is already on the next turn's "Up now" screen (the next player's Start button says
  "Almost ready..." until the reviewer confirms). If the reviewing player goes offline, only the host gets a "continue" button.

## Run locally
    node server.js            # http://localhost:3000   (Node 18+, no npm install needed)
    PORT=8080 MIN_PLAYERS=2 node server.js     # optional env vars
    node test_cards.js        # unique-card + up-next tests
    node test_teams.js        # manual teams + team-name tests
    node test_game.js         # turn-review + full-game tests (takes ~40s)

## Deploy on Render (free)
1. These files must sit at the TOP LEVEL of the GitHub repo (`package.json` and `server.js` visible on the repo's first page).
2. Render -> your Web Service -> Settings: Root Directory = (blank), Build Command = `npm install`, Start Command = `node server.js`.
3. Custom domain: Settings -> Custom Domains.
Leave `public/config.js` as is (`window.FISHBOWL_API = ''`).
Free services sleep after ~15 min idle; game rooms live in memory so a restart ends active games. Health check: `/healthz`.
