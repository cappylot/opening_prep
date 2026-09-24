// End-to-end flows for the study section: curated library, viewer, drill with a
// wrong move / hint / reveal, practice stats, search, PGN import, the editor,
// board appearance, building a study from Lichess games, and persistence.
import assert from 'node:assert/strict';

const CLASSICAL_BLACK = ['c7c6', 'd7d5', 'd5e4', 'c8f5'];

export async function studyFlows({ newPage, shot, BASE }) {
  const { ctx, page } = await newPage('light');
  await page.goto(BASE);
  await page.waitForSelector('.study-card.hero');
  await shot(page, 'home');
  assert.match(await page.textContent('.home'), /The Caro-Kann/);
  assert.match(await page.textContent('.home'), /The Ruy Lopez/);

  // Library filters by side
  await page.click('.tab:has-text("Library")');
  await page.waitForSelector('.study-grid');
  await page.click('.library-bar .chip:has-text("Black openings")');
  assert.equal(await page.locator('.study-grid .study-card').count(), 1);
  await shot(page, 'library-black');

  // Study detail → viewer
  await page.click('.study-grid .study-card');
  await page.waitForSelector('.study-detail .chapter-row');
  assert.equal(await page.locator('.chapter-row').count(), 3);
  await shot(page, 'study-detail');
  await page.click('.chapter-row:has-text("Classical") .chapter-main');
  await page.waitForSelector('.viewer .cg-wrap');
  for (let i = 0; i < 8; i++) await page.click('button[aria-label="Forward"]');
  await page.waitForTimeout(300);
  assert.match(await page.textContent('.annotation'), /The whole point/);
  assert.ok(await page.$('.viewer svg.cg-shapes g g'), 'coach arrow drawn');
  assert.ok(await page.$('.viewer square.mark'), 'coach mark drawn');
  await shot(page, 'viewer');
  // A non-book move does nothing but flash
  const board = async (flipped) => {
    const box = await page.locator('.cg-wrap').first().boundingBox();
    return (s) => {
      const f = s.charCodeAt(0) - 97;
      const r = Number(s[1]) - 1;
      const col = flipped ? 7 - f : f;
      const row = flipped ? r : 7 - r;
      return { x: box.x + (col + 0.5) * (box.width / 8), y: box.y + (row + 0.5) * (box.height / 8) };
    };
  };
  const clickMove = async (sq, uci) => {
    const a = sq(uci.slice(0, 2));
    const b = sq(uci.slice(2, 4));
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
  };
  await page.click('button[aria-label="Start"]');
  await page.waitForTimeout(600);
  let sq = await board(true);
  await clickMove(sq, 'd2d3');
  await page.waitForSelector('.viewer square.flash');
  await clickMove(sq, 'e2e4');
  await page.waitForTimeout(250);
  assert.match(await page.textContent('.status-row'), /Move 1 of/);

  // Drill the chapter as Black
  await page.click('button:has-text("Drill this chapter")');
  await page.waitForSelector('.drill-player');
  const banner = () => page.textContent('.drill-banner');
  const waitBanner = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.drill-banner')?.textContent || ''), re.source, { timeout: 8000 });
  await waitBanner(/Black to play/);
  sq = await board(true);
  // two hints on the first prompt: square, then arrow
  await page.click('.drill-controls button:has-text("Hint")');
  await page.waitForSelector('.drill-player square.hint');
  await page.click('.drill-controls button:has-text("Hint")');
  await page.waitForSelector('.drill-player svg.cg-shapes g g', { state: 'attached' });
  await clickMove(sq, CLASSICAL_BLACK[0]);
  await waitBanner(/Correct — c6/);
  await waitBanner(/Black to play/);
  // a wrong move on the second: not applied, named, then the right one
  await clickMove(sq, 'e7e6');
  await waitBanner(/e6 isn't the book move/);
  await shot(page, 'drill-wrong');
  await clickMove(sq, CLASSICAL_BLACK[1]);
  await waitBanner(/Correct — d5/);
  await waitBanner(/Black to play/);
  // reveal, then play it
  await page.click('.drill-controls button:has-text("Answer")');
  await waitBanner(/Play dxe4 to continue/);
  await clickMove(sq, CLASSICAL_BLACK[2]);
  await waitBanner(/The move is dxe4/);
  await waitBanner(/Black to play/);
  assert.match(await page.textContent('.drill-progress'), /Line 1 of 1/);
  await shot(page, 'drill');
  // bookmark this position
  await page.click('button[aria-label="Bookmark this position"]');
  await page.waitForSelector('button[aria-label="Remove bookmark"]');
  await clickMove(sq, CLASSICAL_BLACK[3]);
  await waitBanner(/Correct — Bf5/);
  // End early: the summary counts what was answered
  await page.click('.drill-player .btn.block:has-text("End drill")');
  await page.waitForSelector('.drill-summary-view');
  const summary = await page.textContent('.drill-summary-view');
  assert.match(summary, /Drill ended/);
  assert.match(summary, /1\/4/);
  await shot(page, 'drill-summary');
  await page.click('.drill-summary-view button:has-text("Done")');

  // Practice reflects the answers
  await page.goto(`${BASE}#/practice`);
  await page.waitForSelector('.practice .stat-tiles');
  const tiles = await page.$$eval('.practice .stat-tiles .tile b', (els) => els.map((e) => e.textContent));
  assert.equal(tiles[0], '1');
  assert.equal(tiles[1], '4');
  assert.match(await page.textContent('.practice'), /Bookmarked[\s\S]*The Caro-Kann/);
  assert.ok(await page.$('.acc-chart'), 'accuracy chart shown after 3+ reviews');
  await shot(page, 'practice');

  // Search by moves
  await page.click('.tab:has-text("Search")');
  await page.fill('.search-tab input', 'e4 c6 d4 d5 e5');
  await page.waitForSelector('.search-tab .list-row:has-text("Advance Variation")');
  await shot(page, 'search');

  // Paste a PGN
  await page.goto(`${BASE}#/create`);
  await page.click('.create-opt:has-text("Paste a PGN")');
  await page.fill('.paste textarea', '[Event "London System"]\n\n1. d4 d5 2. Bf4 Nf6 (2... c5 3. e3) (2... Bf5 3. e3) 3. e3 e6 {Solid.} 4. Nf3 c5 5. c3 Nc6 *');
  await page.waitForSelector('.paste .list-row');
  assert.match(await page.textContent('.paste'), /1 chapter/);
  await shot(page, 'paste-pgn');
  await page.click('.paste button:has-text("Import")');
  await page.waitForSelector('.study-detail');
  assert.match(await page.textContent('.study-detail .detail-head'), /London System/);
  assert.match(await page.textContent('.study-detail .detail-head'), /White repertoire/);

  // Edit the chapter: add a move, a note and an arrow
  await page.click('.chapter-row button[aria-label^="Edit"]');
  await page.waitForSelector('.editor .cg-wrap');
  await page.click('button[aria-label="End"]');
  await page.waitForTimeout(200);
  sq = await board(false);
  await clickMove(sq, 'f1d3');
  await page.waitForSelector('.node-card:has-text("Bd3")');
  await page.fill('#why', 'Aim at h7.');
  await page.fill('#idea', 'Bishop to the diagonal');
  await page.click('button:has-text("Draw")');
  const a = sq('d3');
  const b = sq('h7');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  await shot(page, 'editor');
  await page.click('.editor button:has-text("Save")');
  await page.waitForSelector('.viewer');
  await page.waitForTimeout(300);
  assert.match(await page.textContent('.viewer'), /Aim at h7/);
  assert.match(await page.textContent('.viewer'), /Bishop to the diagonal/);
  assert.ok(await page.$('.viewer svg.cg-shapes g g'), 'authored arrow drawn');

  // Board appearance from settings
  await page.goto(BASE);
  await page.click('button[aria-label="Settings"]');
  await page.waitForSelector('.sheet .piece-sets');
  await page.click('.piece-set:has-text("Origami")');
  await page.click('.swatch[aria-label="Marble"]');
  assert.ok(await page.$('.sheet .board-wrap.pieces-origamiMonochrome.board-marble'));
  await shot(page, 'settings-board');
  await page.click('.sheet .btn.primary.block');

  // A study built from Lichess games
  await page.goto(`${BASE}#/create/lichess`);
  await page.fill('#lu', 'MockOpp');
  await page.click('button:has-text("Look up")');
  await page.waitForSelector('.lichess-import .list-row', { timeout: 15000 });
  await shot(page, 'lichess-import');
  await page.click('.lichess-import .list-row button:has-text("Create study")');
  await page.waitForSelector('.study-detail');
  assert.match(await page.textContent('.study-detail'), /From your games/);

  // Everything persists
  await page.goto(`${BASE}#/library`);
  await page.reload();
  await page.waitForSelector('.study-grid');
  assert.equal(await page.locator('.study-grid .study-card').count(), 4);
  await shot(page, 'library');

  // Wide layout: the tab bar becomes a rail
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.goto(BASE);
  await page.waitForSelector('.tabbar');
  await page.waitForTimeout(300);
  await shot(page, 'home-wide');
  await ctx.close();
}
