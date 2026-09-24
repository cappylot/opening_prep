// Renders icons/icon.svg to the PNG sizes the manifest and iOS need.
// Usage: node scripts/icons.js  (needs Playwright + Chromium)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const svg = readFileSync(new URL('../icons/icon.svg', import.meta.url), 'utf8');
const exe = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage();
const shots = [
  ['icons/icon-192.png', 192, false],
  ['icons/icon-512.png', 512, false],
  ['icons/apple-touch-icon.png', 180, true],
  ['icons/icon-maskable-512.png', 512, true],
];
for (const [file, size, fullBleed] of shots) {
  // Full-bleed variants drop the rounded corners (iOS and maskable icons are masked by the OS).
  const body = fullBleed ? svg.replace('rx="112"', 'rx="0"') : svg;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${body.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: file, omitBackground: !fullBleed, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
console.log('icons written');
