# Opening Prep ♞

Prepare your openings against a specific Lichess opponent, right from your phone's browser. Nothing to install.

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
  - Lichess cloud eval with a best-move arrow.
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
- **My lines**: save lines with notes per opponent and colour, export them as PGN, and **drill** them. In a drill the app plays the opponent's moves in proportion to how often they really play them.
- **Filters**: time control, rated only, time period, a minimum-games threshold, and an optional "favour recent games" weighting. Filters apply instantly without re-downloading.
- **Phone-first**:
  - Dark and light themes.
  - Four board colours.
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

## Development

No build step. The site is plain ES modules plus a few libraries copied into `vendor/`.

```sh
npm install          # dev only: libraries + test deps
npm run vendor       # refresh vendor/ from node_modules
npm run serve        # http://localhost:8080
npm test             # unit tests (node --test)
npm run test:e2e     # phone-sized Playwright run with a mocked Lichess API; screenshots in tests/e2e/screenshots/
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
js/board.js                               chessground wrapper and arrows
js/components/                            screens and panels (Preact + htm)
```

Bump `VERSION` in `sw.js` when you change the list of shell files.

## License

GPL-3.0-or-later, because it bundles [chessground](https://github.com/lichess-org/chessground) (GPL-3.0). It also bundles chess.js (BSD-2), Preact (MIT) and htm (Apache-2.0); their licences are in `vendor/`. Game data comes from [lichess.org](https://lichess.org). This project is not affiliated with Lichess.
