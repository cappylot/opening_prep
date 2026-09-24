// Copies the runtime libraries from node_modules into vendor/ so the site
// runs with no build step and no CDN. Run after `npm install`: npm run vendor
import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = (p) => join(root, 'node_modules', p);
const out = (p) => join(root, 'vendor', p);

const copies = [
  ['chessground/dist/chessground.min.js', 'chessground/chessground.min.js'],
  ['chessground/assets/chessground.base.css', 'chessground/chessground.base.css'],
  ['chessground/assets/chessground.brown.css', 'chessground/chessground.brown.css'],
  ['chessground/assets/chessground.cburnett.css', 'chessground/chessground.cburnett.css'],
  ['chessground/LICENSE', 'chessground/LICENSE'],
  ['chess.js/dist/esm/chess.js', 'chess.js/chess.js'],
  ['chess.js/LICENSE', 'chess.js/LICENSE'],
  ['preact/dist/preact.module.js', 'preact/preact.module.js'],
  ['preact/LICENSE', 'preact/LICENSE'],
  ['htm/dist/htm.module.js', 'htm/htm.module.js'],
  ['htm/LICENSE', 'htm/LICENSE'],
  // Lite single-threaded Stockfish: ~7 MB, needs no cross-origin isolation headers.
  ['stockfish/bin/stockfish-18-lite-single.js', 'stockfish/stockfish-18-lite-single.js'],
  ['stockfish/bin/stockfish-18-lite-single.wasm', 'stockfish/stockfish-18-lite-single.wasm'],
  ['stockfish/Copying.txt', 'stockfish/Copying.txt'],
];

for (const [from, to] of copies) {
  mkdirSync(dirname(out(to)), { recursive: true });
  copyFileSync(nm(from), out(to));
}

// preact/hooks imports the bare specifier "preact"; rewrite it to a relative
// path so browsers can load it without an import map.
const hooks = readFileSync(nm('preact/hooks/dist/hooks.module.js'), 'utf8')
  .replace(/from\s*"preact"/g, 'from"./preact.module.js"')
  .replace(/\n\/\/# sourceMappingURL=.*$/, '');
writeFileSync(out('preact/hooks.module.js'), hooks);

// The Stockfish build is CommonJS; let Node run it despite our "type": "module".
writeFileSync(out('stockfish/package.json'), '{ "type": "commonjs" }\n');

// Drop source map comments (maps are not shipped).
for (const f of ['preact/preact.module.js', 'chessground/chessground.min.js', 'chess.js/chess.js', 'htm/htm.module.js']) {
  const s = readFileSync(out(f), 'utf8').replace(/\n?\/\/# sourceMappingURL=.*$/, '');
  writeFileSync(out(f), s);
}
console.log('vendor/ updated');
