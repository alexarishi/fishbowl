# How to deploy this update (GitHub + Render)

Your live game updates itself: when new files land in your GitHub repo, Render redeploys automatically.
Do this BETWEEN games – a redeploy restarts the server and ends any game in progress.

1. Unzip fishbowl-game-v4.zip on your computer. Open the `fishbowl` folder.
2. Go to your repo on github.com (the one Render deploys from).
3. Click Add file > Upload files.
4. Select everything INSIDE the `fishbowl` folder (server.js, package.json, README.md, UPDATE-GUIDE.md,
   Dockerfile, render.yaml, the three test_*.js files, and the `public` folder) and drag it into the page.
   (The `public` folder must stay a folder; GitHub keeps its structure when you drag the folder itself.)
5. Scroll down, type a message like "Team names", keep "Commit directly to the main branch", click Commit changes.
   Files with the same name are replaced automatically. Nothing needs to be deleted.
6. Open render.com > your service. Under Events you will see a deploy start. Wait for "Live" (1-3 minutes).
7. Open your game's address and hard-refresh (Ctrl+Shift+R, or Cmd+Shift+R on Mac; on a phone close and reopen the tab).
8. Test: host a game, join with a second device, get to the Teams screen and check that you can name your team and the
   other player can name theirs.
