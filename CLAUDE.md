# NFL Central - Claude Code Instructions

## Project Overview
**NFL Central** is a Pebble **watchapp** (not a watchface): a multi-screen NFL app built from the
NFL Live watchface (`Pebble-NFL-Live`) the same way NHL Central was built from the NHL Live face.
UUID: `f7482335-2aab-4725-b049-172582e20088`
GitHub: `brooks2564/NFL-Central`
Platforms: emery and gabbro (color only, touch on both)
Data: ESPN public API (no key). Scoreboard and summary on `site.api.espn.com/apis/site/v2/...`,
standings on `site.api.espn.com/apis/v2/...?level=3`, leaders on `site.web.api.espn.com/apis/common/v3/...`.

## Structure
- `src/c/` watch app. One generic list screen (`list_window.c`) draws every page from text rows the
  phone sends. Row formats are documented at the top of that file (G, F, M, S, R, T, L).
  - `tracker.c` polls this week's games every 30s and fires score, red zone and close-game alerts
  - `score.c` score celebration (football through the uprights, headline, who scored and how far) and
    popup; `score_event_title()` turns a score jump into TOUCHDOWN / FIELD GOAL / SAFETY and ignores extra
    points. The phone sends who/what (`scoreDetail` in index.js) in the last two columns of M and G rows.
  - `comm.c` request queue and listeners; `teams.c` team table, colors, logos
- `src/pkjs/index.js` phone side: ESPN fetches, row building, settings page (a data: URI, no Clay),
  timeline pins, kickoff wake time
- `resources/images/logos/` 32 teams x LG (36px) and SM (22px), copied from the NFL Live face's emery set
- `scripts/gen_art.py` icons and banner, `scripts/run_emulator.sh` build + install + open

## Message keys (must match `package.json` and `REQ_*` in `src/c/app.h` and `src/pkjs/index.js`)
REQ, ARG, TYPE, DATA, FAV_TEAM, FOLLOW, VIBRATE, AUTO_OPEN, WAKE_TIME, ERROR, RED_ZONE, CLOSE_GAME

## Testing with a fake live game
`src/pkjs/sim.json` (gitignored) maps URL fragments to canned ESPN JSON; `getJSON` in index.js uses it
when present. A key starting with `$` matches the end of the URL. **Never commit it, and never build
the committed PBW while it exists.** Move it out of `src/pkjs/` before building the PBW.

## Screenshots and GIFs
`screenshots/emery` and `screenshots/gabbro` hold a full set from a replay of a real Ravens home game
(Titans at Ravens, week 4, cut in the 3rd quarter with the Ravens up 24-10) plus
`touchdown_celebration.gif`. The live state was added to real ESPN data with a local sim.json; the team
stats are from the full game. Frames for the GIFs came from a test build with a git-ignored
`src/c/debug.h` that steps the popup one frame per Down press.

## Build and release
```bash
pebble build
cp build/NFL-Central.pbw NFL-Central.pbw
git add -f NFL-Central.pbw    # *.pbw is in .gitignore
git commit -m "Update PBW"
git push
```
CloudPebble: https://cloudpebble.repebble.com/ide/import/github/brooks2564/NFL-Central
