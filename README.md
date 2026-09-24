# Opening Prep ♞

Study your own opening repertoire with spaced-repetition drills, and prepare against a specific Lichess opponent, right from your phone's browser. Nothing to install.

The app has five tabs: **Home**, **Practice**, **Library**, **Search** and **Opponents**. The first four are the repertoire trainer, a port of the [Chess Opening Studies](https://github.com/cappylot/ChessOpeningStudies) iOS app. **Opponents** is the prep tool.

## Studies

- **Curated studies** ship with the app: *The Caro-Kann* (Black) and *The Ruy Lopez* (White). They are read-only, and they update themselves when their PGN in `content/` changes.
- **Your own studies**, made three ways:
  - Play the moves on the board.
  - Paste or open a PGN, with variations, comments, NAGs, `[FEN]` set-ups and `[%cal]`/`[%csl]` arrows and marks. The preview shows chapters, moves and any lines that were skipped. Your side is guessed from the branching.
  - Build one from **your Lichess games**: pick one of your 12 most played openings, and the study holds the moves you play most plus the replies you've met at least twice.
- **Study viewer**:
  - Step through the book, or autoplay it.
  - Choose a variation from the chips.
  - Play book moves on the board (anything else just flashes).
  - Hints show the next book move.
  - Comments, the move's idea, and coach arrows and marks appear as you step.
- **Editor**:
  - Add moves on the board.
  - Make a move the main line, or delete from here.
  - Write a chapter introduction, a note per move ("Why this move?"), a one-line idea, and **why-not notes** for tempting wrong moves. The drill shows the why-not note when you play that move.
  - Draw arrows and marks: right-drag on desktop, or use *Draw* mode on touch screens.
  - Set a per-move drill policy: *Auto*, *Always* (quizzed even past move 20) or *Never* (shown but never quizzed).
  - Paste a PGN into an existing chapter to merge it, or set a starting FEN.
  - The details sheet edits the title, summary, ECO and side, and reorders or deletes chapters.
- **Drills** play whole lines from the chapter start to the end, mainline first.
  - The book's moves play themselves.
  - Answering:
    - A wrong move isn't applied; its source square flashes and the book move is named.
    - A book move from another line is named without penalty.
    - *Hint* first highlights the piece, then shows the arrow.
    - *Answer* shows the move and makes you play it.
    - *Skip* moves on without grading.
  - Premoves work while the book is replying.
  - Bookmark positions to find them later under *Practice*.
  - Choose *Pause after each answer* in Settings to wait for a tap after each answer.
  - The summary shows accuracy, hints and time.
- **Spaced repetition** (SM-2 with learning steps, as in the iOS app):
  - A card is a position where it's your move. Its identity is a content hash, so progress survives edits, re-imports and transpositions.
  - Grades come from what happened: first try, after a hint, after retries, or wrong.
  - Daily caps on new cards and reviews, a 04:00 day rollover, and leech suspension, all adjustable in Settings.
- **Practice**: streak, answers today, a 7/30/90-day accuracy chart, *Needs work* (the positions you miss most), bookmarks, and a drill button per repertoire.
- **Search** by opening name, ECO code, side, or moves such as `e4 c6 d4`. The last 8 searches are kept.
- **Analyse position** shows Lichess cloud eval with three lines and falls back to Stockfish on the device.
- **Boards**: the four original colours, the iOS app's eight themes, and eight piece sets (the iOS ones load on first use). There are also settings for arrow colour, move animation and the last-move highlight.
- **Mini-player**: shows the drill in progress, the last drill's result, the study you have open, or where you left off.

To add a curated study, drop a `.pgn` into `content/` and list its name in `BUNDLED` in `js/study/studyStore.js` and in `SHELL` in `sw.js`. The first game can carry `[StudySlug]`, `[StudyTitle]`, `[StudySummary]`, `[StudySide]` and `[StudyECO]`. Each game is a chapter named by its `[Event]`. Keep the slug stable, because card identities (and so everyone's progress) are keyed on it.

## Opponent prep

Type their username. The app downloads their games from Lichess and builds an opening tree on your device. The board then shows **what they are most likely to play** at every move and **where they score badly**.

## Features

- **Opponent search** with Lichess username autocomplete. Recent opponents are cached for instant, offline reopening.
- **Explore board**:
  - Blue arrows show the opponent's likely replies. Thicker means more frequent, and the label is the percentage.
  - On your turn, arrows are coloured by how the opponent scored against each move: green for poorly, red for well.
  - The move table shows frequency, number of games, and a result bar with the opponent's score.
  - Badges mark moves: *Main line*, *They struggle*, *Their strength*, *Best try*, *Few games*.
  - Transpositions are merged, since positions are compared, not move orders.
  - "Out of their book" appears when you reach a position they have never had.
  - Engine eval that works for every position, even offline.
    - It uses Lichess's cloud analysis when the position is known.
    - Otherwise **Stockfish 18 runs on your phone**: the lite, single-threaded WASM build, about 7 MB, downloaded the first time it's needed and cached afterwards.
    - The chip shows the source (☁ or chip icon), the depth, and a live dot while Stockfish is still thinking. Tap it for the best line.
    - Evals are saved on the device, so positions you've already looked at are instant.
  - Their recent games from the current position link straight to that move on lichess.org.
- **Prep ideas**:
  - Suggested lines follow the opponent's likely replies and pick the moves they have scored worst against.
  - Available from the start position or from any position you're exploring.
- **Insights**:
  - Score and predictability.
  - How they answer each first move.
  - Their opening families.
  - Weak spots and comfort zones.
  - Head-to-head record, if you set your own username.
- **My lines**: save lines with notes per opponent and colour, export them as PGN, and **drill** them. In a drill the opponent's moves follow the saved line, and a missed line comes back once at the end of the round.
- **Filters**: time control, rated only, time period, a minimum-games threshold, and an optional "favour recent games" weighting. Filters apply instantly without re-downloading.
- **Phone-first**:
  - Dark and light themes.
  - Twelve board themes and eight piece sets.
  - Swipe the panel to step through moves.
  - Vibration feedback on supported phones.
  - Works in landscape.
  - Installable to the home screen and works offline.
  - Shareable links to any position.

## Use it on your phone

1. Enable GitHub Pages once. In this repo go to **Settings → Pages → Build and deployment → Source: GitHub Actions**. (A private repo needs a paid GitHub plan for Pages. Otherwise make the repo public.)
2. Push to `main`. The *Deploy to GitHub Pages* workflow publishes the site to `https://<user>.github.io/opening_prep/`.
3. Open that URL on your phone.
   - **iPhone:** tap Share → *Add to Home Screen*.
   - **Android/Chrome:** menu → *Add to Home screen* / *Install app*.

Everything stays on your device: downloaded games, saved lines and settings are kept in the browser's local storage (IndexedDB).

## How it works

- `lichess.org/api/games/user/{name}` is streamed as NDJSON. It needs no login and is CORS-enabled.
  - Without a token Lichess sends about 20 games per second. An optional personal token (no scopes needed) makes downloads faster.
  - A later **Refresh** downloads only new games.
- Each game is replayed in a Web Worker for its first 30 plies using chess.js. Positions are keyed by FEN, without the move counters.
- The tree, statistics and suggestions are recomputed instantly when you change a filter.
- Scores are smoothed toward 50% (4 virtual games) so a 2–0 sample doesn't look like a sure thing.
- The Lichess *opening explorer* API now requires authentication, so this app builds its own explorer from the raw games instead.
- Evals are looked up in this order: the on-device cache, then `lichess.org/api/cloud-eval` (with a 2.5 s timeout and one retry), then local Stockfish, which searches to the depth set in Settings (default 18).
  - If Lichess rate-limits cloud lookups, they're skipped for a minute and Stockfish covers.
  - The engine stops while the app is in the background and restarts itself if it stalls.

## Development

No build step. The site is plain ES modules plus a few libraries copied into `vendor/`.

```sh
npm install          # dev only: libraries + test deps
npm run vendor       # refresh vendor/ from node_modules
npm run serve        # http://localhost:8080
npm test             # unit tests (node --test)
npm run test:e2e     # phone-sized Playwright run with a mocked Lichess API; screenshots in tests/e2e/screenshots/
E2E_ONLY=study npm run test:e2e   # just the study flows
```

`npm run test:e2e` needs Playwright. Set `CHROMIUM_PATH` to use a specific Chromium build. `node scripts/icons.js` re-renders the PNG icons from `icons/icon.svg`.

Layout:

```
index.html, manifest.webmanifest, sw.js   app shell, PWA manifest, offline cache
css/app.css                               styles (theme tokens, layouts)
js/tree.js                                replay + opening tree (pure, tested)
js/insights.js                            summary, weak spots, suggested lines (pure, tested)
js/lichess.js                             API client (streaming, rate limits, cloud eval)
js/data.js, js/store.js                   download/caching, IndexedDB + settings
js/board.js                               chessground wrapper: arrows, marks, premoves, promotion
js/study/                                 studies: PGN, move tree, cards, SRS, plans, drill session (pure, tested), store
js/components/                            opponent-prep screens and panels (Preact + htm)
js/components/study/                      study screens: home, library, viewer, drill, practice, editor, create
content/                                  curated study PGNs
css/boards.css, css/pieces.css, pieces/   board themes and piece sets (generated: node scripts/study-assets.js ../ChessOpeningStudies)
```

Bump `VERSION` in `sw.js` when you change the list of shell files.

## License

GPL-3.0-or-later, because it bundles [chessground](https://github.com/lichess-org/chessground) (GPL-3.0). It also bundles Stockfish.js 18 (GPL-3.0), chess.js (BSD-2), Preact (MIT) and htm (Apache-2.0); their licences are in `vendor/`. The Sashité Merida pieces are CC0. The other iOS piece sets are original artwork from SwiftChessTools; see `pieces/NOTICE.md`. Game data comes from [lichess.org](https://lichess.org). This project is not affiliated with Lichess.
