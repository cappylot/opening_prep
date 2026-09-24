// Generates css/boards.css (the iOS board themes as SVG backgrounds) and
// css/pieces.css (the iOS piece sets), copying the piece PNGs into pieces/.
// Run: node scripts/study-assets.js [path/to/ChessOpeningStudies]
import { mkdirSync, copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ios = process.argv[2] || join(root, '..', 'ChessOpeningStudies');

// Colours from ChessOpeningStudies/Board/BoardTheme.swift.
const rgb = (r, g, b, a = 1) => (a === 1 ? `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})` : `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`);
export const THEMES = [
  { id: 'classicGreen', name: 'Classic Green', light: rgb(0.94, 0.92, 0.82), dark: rgb(0.39, 0.58, 0.41), texture: 'none', ink: 'rgba(0,0,0,0.66)', last: rgb(1, 0.82, 0.2, 0.5) },
  { id: 'warmWalnut', name: 'Warm Walnut', light: rgb(0.91, 0.78, 0.57), dark: rgb(0.55, 0.35, 0.18), texture: 'wood', ink: rgb(0.16, 0.1, 0.06, 0.78), darkInk: '#fff', last: rgb(1, 0.82, 0.2, 0.5) },
  { id: 'blueStudy', name: 'Blue Study', light: rgb(0.84, 0.89, 0.93), dark: rgb(0.36, 0.5, 0.63), texture: 'none', ink: 'rgba(0,0,0,0.66)', darkInk: '#000', last: rgb(1, 0.82, 0.2, 0.5) },
  { id: 'marble', name: 'Marble', light: rgb(0.9, 0.89, 0.86), dark: rgb(0.55, 0.56, 0.57), texture: 'marble', ink: 'rgba(0,0,0,0.66)', last: rgb(1, 0.82, 0.2, 0.5) },
  { id: 'blueprint', name: 'Blueprint', light: rgb(0.79, 0.88, 0.95), dark: rgb(0.25, 0.45, 0.63), texture: 'blueprint', ink: 'rgba(255,255,255,0.82)', lightInk: '#000', last: 'rgba(255,255,255,0.34)' },
  { id: 'artDeco', name: 'Art Deco Monochrome', light: rgb(0.91, 0.91, 0.89), dark: rgb(0.67, 0.67, 0.65), texture: 'artDeco', ink: 'rgba(0,0,0,0.66)', last: rgb(0.98, 0.91, 0.52, 0.48) },
  { id: 'circuit', name: 'Circuit Board', light: rgb(0.67, 0.73, 0.69), dark: rgb(0.2, 0.28, 0.25), texture: 'circuit', ink: 'rgba(255,255,255,0.82)', lightInk: '#000', last: rgb(0.44, 0.95, 0.78, 0.38) },
  { id: 'sportsCourt', name: 'Sports Court', light: rgb(0.88, 0.68, 0.42), dark: rgb(0.55, 0.31, 0.14), texture: 'sportsCourt', ink: rgb(0.16, 0.1, 0.06, 0.78), darkInk: '#fff', last: rgb(1, 0.82, 0.2, 0.5) },
];

function texture(kind, x, y, isLight) {
  const s = 100;
  const ox = x * s;
  const oy = y * s;
  const seed = (x * 7 + y * 13) % 5;
  switch (kind) {
    case 'wood': {
      const op = isLight ? 0.13 : 0.2;
      return [0, 1, 2, 3]
        .map((i) => {
          const yy = oy + 14 + i * 24 + seed * 2;
          return `<path d="M${ox} ${yy} C${ox + 30} ${yy - 5 - seed} ${ox + 70} ${yy + 5 + seed} ${ox + s} ${yy}" stroke="#2a1606" stroke-opacity="${op}" stroke-width="2" fill="none"/>`;
        })
        .join('');
    }
    case 'marble':
      return `<path d="M${ox} ${oy + 20 + seed * 12} Q${ox + 40} ${oy + 50} ${ox + 60} ${oy + 30 + seed * 6} T${ox + s} ${oy + 80 - seed * 8}" stroke="${isLight ? '#7d7a74' : '#e8e8e8'}" stroke-opacity="0.35" stroke-width="1.6" fill="none"/>`;
    case 'blueprint':
      return `<path d="M${ox + 50} ${oy} V${oy + s} M${ox} ${oy + 50} H${ox + s}" stroke="#fff" stroke-opacity="${isLight ? 0.55 : 0.18}" stroke-width="1" fill="none"/><rect x="${ox + 0.5}" y="${oy + 0.5}" width="99" height="99" fill="none" stroke="#fff" stroke-opacity="${isLight ? 0.7 : 0.3}"/>`;
    case 'artDeco':
      return isLight
        ? `<path d="M${ox + 50} ${oy + 18} L${ox + 82} ${oy + 50} L${ox + 50} ${oy + 82} L${ox + 18} ${oy + 50} Z" fill="none" stroke="#000" stroke-opacity="0.09" stroke-width="2"/>`
        : `<path d="M${ox} ${oy + s} L${ox + s} ${oy} M${ox} ${oy + 60} L${ox + 60} ${oy} M${ox + 40} ${oy + s} L${ox + s} ${oy + 40}" stroke="#000" stroke-opacity="0.12" stroke-width="2"/>`;
    case 'circuit':
      return `<path d="M${ox + 10} ${oy + 30 + seed * 8} H${ox + 55} V${oy + 75} H${ox + 90}" stroke="rgb(140,242,184)" stroke-opacity="${isLight ? 0.35 : 0.22}" stroke-width="2.5" fill="none"/><circle cx="${ox + 90}" cy="${oy + 75}" r="4" fill="rgb(140,242,184)" fill-opacity="${isLight ? 0.45 : 0.3}"/>`;
    case 'sportsCourt':
      return `<rect x="${ox + 4}" y="${oy + 4}" width="92" height="92" fill="none" stroke="#fff" stroke-opacity="${isLight ? 0.3 : 0.16}" stroke-width="2"/>`;
    default:
      return '';
  }
}

function boardSvg(t) {
  // One 2x2 tile, repeated across the board: a full 8x8 SVG per theme costs ~20 KB each.
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" shape-rendering="geometricPrecision">`;
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) {
      const isLight = (x + y) % 2 === 0;
      out += `<rect x="${x * 100}" y="${y * 100}" width="100" height="100" fill="${isLight ? t.light : t.dark}"/>`;
      out += texture(t.texture, x, y, isLight);
    }
  }
  return `${out}</svg>`;
}

const dataUri = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}")`;

let boards = `/* Generated by scripts/study-assets.js: the iOS app's board themes. */\n`;
for (const t of THEMES) {
  boards += `.board-${t.id} cg-board { background-color: ${t.dark}; background-image: ${dataUri(boardSvg(t))}; background-size: 25% 25%; }\n`;
  boards += `.board-${t.id} cg-board square.last-move { background-color: ${t.last}; }\n`;
  boards += `.board-${t.id} coords coord { color: ${t.ink}; }\n`;
  if (t.lightInk) boards += `.board-${t.id} .cg-wrap coords coord:nth-child(odd) { color: ${t.lightInk}; }\n`;
  if (t.darkInk) boards += `.board-${t.id} .cg-wrap coords coord:nth-child(even) { color: ${t.darkInk}; }\n`;
  boards += `.swatch.board-${t.id} { --sq-l: ${t.light}; --sq-d: ${t.dark}; }\n`;
}
writeFileSync(join(root, 'css/boards.css'), boards);

// Piece sets from ChessOpeningStudies/Board/Pieces.xcassets.
export const PIECE_SETS = [
  { id: 'sashiteMerida', name: 'Sashité Merida' },
  { id: 'artDecoMonochrome', name: 'Art Deco' },
  { id: 'brutalistMonochrome', name: 'Brutalist' },
  { id: 'origamiMonochrome', name: 'Origami' },
  { id: 'circuitBoardMonochrome', name: 'Circuit Board' },
  { id: 'blueprintMonochrome', name: 'Blueprint' },
  { id: 'sportsMonochrome', name: 'Sports' },
];
const ROLES = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };
let pieces = `/* Generated by scripts/study-assets.js: the iOS app's piece sets. */\n`;
const xcassets = join(ios, 'ChessOpeningStudies/Board/Pieces.xcassets');
for (const set of PIECE_SETS) {
  mkdirSync(join(root, 'pieces', set.id), { recursive: true });
  for (const color of ['w', 'b']) {
    for (const [code, role] of Object.entries(ROLES)) {
      const name = `${set.id}_${color}${code}`;
      const src = join(xcassets, `${name}.imageset`, `${name}.png`);
      if (existsSync(src)) copyFileSync(src, join(root, 'pieces', set.id, `${color}${code}.png`));
      pieces += `.pieces-${set.id} .cg-wrap piece.${role}.${color === 'w' ? 'white' : 'black'} { background-image: url('../pieces/${set.id}/${color}${code}.png'); }\n`;
    }
  }
}
writeFileSync(join(root, 'css/pieces.css'), pieces);
console.log('wrote css/boards.css, css/pieces.css and pieces/');
