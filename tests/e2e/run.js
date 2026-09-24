// End-to-end smoke test on a phone-sized viewport with a mocked Lichess API.
// Usage: npm run test:e2e   (screenshots land in tests/e2e/screenshots/)
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { mockGames, mockUser } from './mock.js';

const PORT = 8765;
const BASE = `http://127.0.0.1:${PORT}/`;
const SHOTS = new URL('./screenshots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
  cwd: new URL('../../', import.meta.url).pathname,
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 800));

const games = mockGames(260);
const ndjson = games.map((g) => JSON.stringify(g)).join('\n') + '\n';
const exe = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const errors = [];
let step = 0;

async function newPage(colorScheme) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], colorScheme });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`console: ${m.text()}`));
  await ctx.route('https://lichess.org/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/user/MockOpp' || url.pathname === '/api/user/mockopp') return route.fulfill({ json: mockUser });
    if (url.pathname.startsWith('/api/user/')) return route.fulfill({ status: 404, json: { error: 'Not found' } });
    if (url.pathname === '/api/player/autocomplete')
      return route.fulfill({ json: { result: [{ id: 'mockopp', name: 'MockOpp', title: 'FM', online: true }] } });
    if (url.pathname === '/api/games/user/MockOpp') {
      const since = Number(url.searchParams.get('since') || 0);
      const body = since ? '' : ndjson;
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/x-ndjson' }, body });
    }
    if (url.pathname === '/api/cloud-eval') {
      return route.fulfill({ json: { fen: url.searchParams.get('fen'), depth: 36, knodes: 1000, pvs: [{ cp: 27, moves: 'e2e4 e7e5 g1f3' }] } });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  return { ctx, page };
}

const shot = (page, name) => page.screenshot({ path: `${SHOTS}${String(++step).padStart(2, '0')}-${name}.png` });

try {
  const { ctx, page } = await newPage('dark');
  await page.goto(BASE);
  await page.waitForSelector('.search-view');
  await shot(page, 'search-empty');

  // Autocomplete + analyze
  await page.fill('input[type=search]', 'Mock');
  await page.waitForSelector('.suggest button');
  await shot(page, 'search-autocomplete');
  await page.click('.suggest button');
  await page.waitForSelector('.move-table', { timeout: 15000 });
  await page.waitForTimeout(600);
  await shot(page, 'explore-white-start');

  // I play White by default: at the start it's my move, the table lists moves played vs them
  assert.match(await page.textContent('.mt-head'), /you/i);
  // Their data: 260 games, around half as Black
  const note = await page.textContent('.data-note');
  assert.match(note, /as black/);

  // Play 1.e4 via the table and check their replies
  await page.click('.mt-row:has(.san:text-is("e4"))');
  await page.waitForSelector('.turn-pill.opp');
  await page.waitForTimeout(100);
  const pcts = await page.$$eval('.mt-row .freq b', (els) => els.map((e) => parseFloat(e.textContent)));
  const sum = pcts.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 100) <= pcts.length, `percentages sum to ${sum}`);
  assert.equal(await page.textContent('.mt-row .san'), 'c5');
  const arrows = await page.$$eval('cg-container svg.cg-shapes g > g, cg-container svg g', (els) => els.length);
  assert.ok(arrows > 0, 'arrows drawn');
  await page.waitForTimeout(500);
  await shot(page, 'explore-after-e4');

  // Follow the main line with the forward button
  for (let i = 0; i < 3; i++) await page.click('button[aria-label="Play the most common move"]');
  await page.waitForTimeout(300);
  const trail = await page.textContent('.trail');
  assert.match(trail, /e4.*c5.*Nf3.*d6/);
  await shot(page, 'explore-mainline');

  // Save the line
  await page.click('button[aria-label="Save this line"]');
  await page.waitForSelector('.sheet');
  await page.fill('#line-note', 'Go for 3.Bb5+: they score badly');
  await shot(page, 'save-line');
  await page.click('.sheet button[type=submit]');
  await page.waitForSelector('.sheet', { state: 'detached' });

  // Insights tab
  await page.click('.tabs button:has-text("Insights")');
  await page.waitForSelector('.insights');
  await page.waitForTimeout(200);
  await shot(page, 'insights');
  const insights = await page.textContent('.insights');
  assert.match(insights, /Sicilian Defense/);
  assert.match(insights, /Suggested prep lines/);
  await page.evaluate(() => document.querySelector('.panel-body').scrollTo(0, 99999));
  await shot(page, 'insights-bottom');

  // Tap a suggested line → back on explore with that line
  await page.click('.insights .line-card');
  await page.waitForSelector('.move-table, .empty');
  await shot(page, 'explore-suggested-line');

  // Save a second line that differs on the opponent's reply: 1.e4 e5 2.Nf3
  await page.click('.tabs button:has-text("Explore")');
  await page.click('button[aria-label="Start position"]');
  for (const san of ['e4', 'e5', 'Nf3']) {
    await page.click(`.mt-row:has(.san:text-is("${san}"))`);
    await page.waitForTimeout(150);
  }
  await page.click('button[aria-label="Save this line"]');
  await page.waitForSelector('.sheet');
  await page.fill('#line-name', 'Open game');
  await page.click('.sheet button[type=submit]');
  await page.waitForSelector('.sheet', { state: 'detached' });

  // Lines tab persists after reload
  await page.click('.tabs button:has-text("My lines")');
  await page.waitForSelector('.saved-line');
  await page.reload();
  await page.waitForSelector('.tabs');
  await page.click('.tabs button:has-text("My lines")');
  await page.waitForSelector('.saved-line');
  assert.equal(await page.locator('.saved-line').count(), 2);
  assert.match(await page.textContent('.line-list'), /they score badly/);
  await shot(page, 'lines');

  // Drill: both lines start 1.e4 and continue 2.Nf3 after the opponent's reply
  await page.click('.lines-actions .btn.primary');
  await page.waitForSelector('.drill');
  const box = await page.locator('.drill .cg-wrap').boundingBox();
  const sq = (s) => {
    const f = s.charCodeAt(0) - 97;
    const r = Number(s[1]) - 1;
    return { x: box.x + (f + 0.5) * (box.width / 8), y: box.y + (7 - r + 0.5) * (box.height / 8) };
  };
  const move = async (from, to) => {
    const a = sq(from);
    const b = sq(to);
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
  };
  const drilled = [];
  const drillLine = async (withMistake) => {
    await page.waitForTimeout(300); // let the board pick up the new line
    drilled.push((await page.textContent('.drill .opp-card small')).split(' · ').pop());
    if (withMistake) {
      await move('d2', 'd4');
      await page.waitForSelector('.drill-status.wrong');
      await shot(page, 'drill-wrong');
      await page.waitForSelector('.drill-status.play', { timeout: 3000 });
    }
    await move('e2', 'e4');
    await page.waitForTimeout(900); // opponent replies from this line
    await move('g1', 'f3');
    await page.waitForSelector('.drill-status.lineDone', { timeout: 3000 });
  };
  await drillLine(true);
  await page.click('.drill-card button:has-text("Next line")');
  await drillLine(false);
  await page.click('.drill-card button:has-text("Next line")');
  // the missed line comes back once
  await page.waitForSelector('.drill .opp-card small:has-text("retry")');
  await drillLine(false);
  await page.waitForSelector('.drill-status.finished', { timeout: 4000 });
  await shot(page, 'drill-done');
  assert.notEqual(drilled[0], drilled[1], `both lines drilled: ${drilled}`);
  assert.equal(drilled[2], drilled[0]);
  assert.equal(await page.locator('.drill-summary li').count(), 2);
  assert.match(await page.textContent('.drill-summary'), /1 ✗/);
  await page.click('button[aria-label="Exit drill"]');
  await page.click('.tabs button:has-text("Explore")');

  // Switch to Black and filters
  await page.click('.portrait-only .color-toggle button:has-text("Black")');
  await page.waitForTimeout(300);
  assert.equal(await page.textContent('.mt-row .san'), 'e4');
  await page.click('.portrait-only .filter-chip');
  await page.waitForSelector('.sheet');
  await shot(page, 'filters');
  await page.click('.sheet .chip:has-text("Blitz")');
  await page.click('.sheet .btn.primary');
  await shot(page, 'explore-black-blitz');

  // Settings
  await page.click('button[aria-label="Settings"]');
  await page.waitForSelector('.sheet');
  await shot(page, 'settings');
  await page.click('.sheet .chip:has-text("Light")');
  await page.click('.sheet .btn.primary.block');
  await page.waitForTimeout(300);
  await shot(page, 'explore-light');

  // Unknown player
  await page.goto(`${BASE}#/u/nobodyatall`);
  await page.waitForSelector('.empty');
  assert.match(await page.textContent('.empty'), /No Lichess player/);
  await shot(page, 'not-found');

  // Landscape layout
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(`${BASE}#/u/MockOpp?c=w&m=e2e4,c7c5`);
  await page.waitForSelector('.move-table');
  await page.waitForTimeout(400);
  await shot(page, 'landscape');
  await ctx.close();

  assert.deepEqual(errors, []);
  console.log(`e2e passed, screenshots in ${SHOTS}`);
} catch (e) {
  console.error(e);
  for (const p of browser.contexts().flatMap((c) => c.pages())) await p.screenshot({ path: `${SHOTS}failure.png` }).catch(() => {});
  console.error(errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
