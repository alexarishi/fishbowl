# How to deploy this version (GitHub + Render)

Do this BETWEEN games – a redeploy restarts the server and ends any game in progress.
Render redeploys by itself whenever new files land in your GitHub repo.

1. Unzip fishbowl-game-v2.zip and open the `fishbowl` folder.
2. Open your repo on github.com -> Add file -> Upload files.
3. Drag in EVERYTHING inside the `fishbowl` folder, including the `public` folder (it must stay a folder).
   Files with the same name are replaced; nothing needs to be deleted.
4. Scroll down, type a message (e.g. "Turn review, team names, manual teams"), keep "Commit directly to the main branch",
   click Commit changes.
5. Open render.com -> your service -> Events. A deploy starts automatically; wait for "Live" (1-3 minutes).
6. Hard-refresh the game (Ctrl+Shift+R / Cmd+Shift+R; on a phone close and reopen the tab).

Quick test (4+ devices or tabs):
- Host a game, join with 3 more players, write cards, tap Draw teams.
- Teams screen: try Shuffle randomly, then Pick manually and place everyone. Once everyone is placed the host gets a name
  box for their team and ONE random player on the other team gets a "you were picked" box.
- Play. When a turn ends only that player sees the card list; everyone else sees "is reviewing their cards…".
