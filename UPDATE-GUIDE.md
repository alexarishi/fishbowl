# How to deploy this update (GitHub + Render)

Do this BETWEEN games - a redeploy restarts the server and ends any game in progress.
Render redeploys by itself whenever new files land in your GitHub repo.

1. Unzip fishbowl-game-v6.zip. Open the folder you get: you should see server.js, package.json, README.md and a `public` folder.
2. Open your repo on github.com (the one Render deploys from) -> Add file -> Upload files.
3. Select EVERYTHING in that folder (including the `public` folder) and drag it in. Same-named files are replaced;
   nothing needs to be deleted. After uploading, `package.json` and `server.js` must be visible on the repo's first page
   (NOT inside another folder).
4. Scroll down, type a message (e.g. "Unique cards, name badge, up-next bar"), keep "Commit directly to the main branch",
   click Commit changes.
5. Open render.com -> your service -> Events. A deploy starts automatically; wait for "Live" (1-3 minutes).
   If the build fails, open Logs: `package.json not found` means the files ended up inside a sub-folder of the repo.
6. Hard-refresh the game (Ctrl+Shift+R / Cmd+Shift+R; on a phone close and reopen the tab).

Quick test (4 devices or tabs):
- Host a game, join with 3 more players, tap Start game.
- Cards: player 1 adds "Apple"; player 2 tries "apple" -> must be refused with "Something similar is already in the pool".
- Every screen shows your own name at the top ("Playing as ...").
- Draw teams, play: the bar at the bottom shows who is up next; that player's bar turns gold.
