# How to deploy this update (GitHub + Render)

Do this BETWEEN games - a redeploy restarts the server and ends any game in progress.
Render redeploys by itself whenever new files land in your GitHub repo.

1. Unzip fishbowl-game-v5.zip and open the `fishbowl` folder.
2. Open your repo on github.com -> Add file -> Upload files.
3. Drag in EVERYTHING inside the `fishbowl` folder, including the `public` folder (it must stay a folder).
   Files with the same name are replaced; nothing needs to be deleted.
4. Scroll down, type a message (e.g. "Review screen only for the clue giver"), keep "Commit directly to the main branch",
   click Commit changes.
5. Open render.com -> your service -> Events. A deploy starts automatically; wait for "Live" (1-3 minutes).
6. Hard-refresh the game (Ctrl+Shift+R / Cmd+Shift+R; on a phone close and reopen the tab).

Quick test (4+ devices or tabs): host a game, join with 3 more players, write cards, draw teams, play. When a turn ends,
only that player should get the card list to tick/untick; everyone else should already be on the next turn's "Up next"
screen (the next player's button says "Almost ready..." until the reviewer confirms).
