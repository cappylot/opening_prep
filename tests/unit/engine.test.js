import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { parseInfo, parseBestmove } from '../../js/engine.js';
import { evaluatePosition, better } from '../../js/evaluate.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

test('parseInfo reads cp, mate and pv from White’s side', () => {
  const w = parseInfo('info depth 12 seldepth 19 multipv 1 score cp 37 nodes 24331 nps 1 time 57 pv g1f3 e7e6 d2d4', true);
  assert.deepEqual(w, { depth: 12, pv: ['g1f3', 'e7e6', 'd2d4'], best: 'g1f3', cp: 37 });
  const b = parseInfo('info depth 20 multipv 1 score cp 25 nodes 9 pv e7e5 g1f3', false);
  assert.equal(b.cp, -25);
  const m = parseInfo('info depth 9 score mate -3 pv h7h6', false);
  assert.equal(m.mate, 3);
  assert.equal(m.cp, undefined);
});

test('parseInfo ignores bounds, secondary lines and non-score info', () => {
  assert.equal(parseInfo('info depth 14 score cp 40 lowerbound nodes 1 pv e2e4'), null);
  assert.equal(parseInfo('info depth 14 score cp 40 upperbound nodes 1 pv e2e4'), null);
  assert.equal(parseInfo('info depth 14 multipv 2 score cp 10 pv d2d4'), null);
  assert.equal(parseInfo('info string NNUE evaluation using nn.nnue'), null);
  assert.equal(parseInfo('info depth 1 currmove e2e4 currmovenumber 1'), null);
});

test('parseBestmove', () => {
  assert.equal(parseBestmove('bestmove g1f3 ponder e7e6'), 'g1f3');
  assert.equal(parseBestmove('bestmove (none)'), null);
  assert.equal(parseBestmove('info depth 3'), null);
});

test('better prefers depth, then cloud', () => {
  assert.ok(better({ depth: 20, source: 'device' }, { depth: 18, source: 'cloud' }));
  assert.ok(better({ depth: 18, source: 'cloud' }, { depth: 18, source: 'device' }));
  assert.ok(!better({ depth: 12, source: 'cloud' }, { depth: 18, source: 'device' }));
  assert.ok(better({ depth: 1 }, null));
});

function fakeDeps(over = {}) {
  let t = 1000;
  const calls = { cloud: 0, device: 0, puts: [] };
  const deps = {
    memory: new Map(),
    state: { cloudCooldownUntil: 0 },
    now: () => t,
    advance: (ms) => (t += ms),
    online: () => true,
    cacheGet: async () => null,
    cachePut: (k, r) => calls.puts.push(r),
    cloud: async () => (calls.cloud++, { status: 'miss' }),
    deviceOk: () => true,
    device: async (fen, depth, signal, onInfo) => {
      calls.device++;
      onInfo({ depth: 8, cp: 20, pv: ['e2e4'], best: 'e2e4' });
      return { depth, cp: 30, pv: ['e2e4', 'e7e5'], best: 'e2e4' };
    },
    ...over,
  };
  return { deps, calls };
}

test('cloud hit is used and saved; device is not started', async () => {
  const { deps, calls } = fakeDeps({ cloud: async () => ({ status: 'ok', result: { cp: 25, depth: 40, best: 'e2e4', pv: ['e2e4'] } }) });
  const updates = [];
  const r = await evaluatePosition(START, { deps, depth: 18, onUpdate: (u) => updates.push(u) });
  assert.equal(r.source, 'cloud');
  assert.equal(r.depth, 40);
  assert.equal(calls.device, 0);
  assert.equal(calls.puts.length, 1);
  assert.ok(updates.every((u) => !u.running));
});

test('cloud miss falls back to the device engine, streaming updates', async () => {
  const { deps, calls } = fakeDeps();
  const updates = [];
  const r = await evaluatePosition(AFTER_E4, { deps, depth: 16, onUpdate: (u) => updates.push(u) });
  assert.equal(calls.cloud, 1);
  assert.equal(calls.device, 1);
  assert.equal(r.source, 'device');
  assert.equal(r.depth, 16);
  assert.equal(r.cp, 30);
  assert.ok(updates.some((u) => u.running && u.depth === 8), 'streamed an intermediate depth');
  assert.equal(updates.at(-1).running, false);
  assert.equal(calls.puts.at(-1).depth, 16);
});

test('rate limit sets a cooldown that skips the cloud', async () => {
  const { deps, calls } = fakeDeps({ cloud: async () => (calls.cloud++, { status: 'limited' }) });
  await evaluatePosition(START, { deps, depth: 12 });
  deps.memory.clear();
  await evaluatePosition(AFTER_E4, { deps, depth: 12 });
  assert.equal(calls.cloud, 1, 'second lookup skipped the cloud');
  assert.equal(calls.device, 2);
  deps.advance(61000);
  deps.memory.clear();
  await evaluatePosition(START, { deps, depth: 12 });
  assert.equal(calls.cloud, 2, 'cloud used again after cooldown');
});

test('a deep enough cached result is returned without any lookups', async () => {
  const { deps, calls } = fakeDeps({ cacheGet: async () => ({ cp: 10, depth: 22, best: 'e2e4', pv: [], source: 'device' }) });
  const updates = [];
  const r = await evaluatePosition(START, { deps, depth: 18, onUpdate: (u) => updates.push(u) });
  assert.equal(r.depth, 22);
  assert.equal(calls.cloud + calls.device, 0);
  assert.equal(updates[0].cached, true);
});

test('cloud-only mode and offline behaviour', async () => {
  const off = fakeDeps({ online: () => false });
  const r = await evaluatePosition(START, { deps: off.deps, depth: 10 });
  assert.equal(off.calls.cloud, 0);
  assert.equal(r.source, 'device');
  const cloudOnly = fakeDeps();
  const updates = [];
  assert.equal(await evaluatePosition(START, { deps: cloudOnly.deps, mode: 'cloud', onUpdate: (u) => updates.push(u) }), null);
  assert.equal(cloudOnly.calls.device, 0);
  assert.deepEqual(updates.at(-1), { none: true });
  assert.equal(await evaluatePosition(START, { deps: cloudOnly.deps, mode: 'off' }), null);
});

test('vendored Stockfish answers UCI and finds a best move', async () => {
  const sf = spawn(process.execPath, [new URL('../../vendor/stockfish/stockfish-18-lite-single.js', import.meta.url).pathname]);
  let out = '';
  const done = new Promise((resolve) => {
    sf.stdout.on('data', (d) => {
      out += d;
      if (/bestmove/.test(out)) resolve();
    });
  });
  sf.stdin.write(`uci\nisready\nposition fen ${AFTER_E4}\ngo depth 10\n`);
  await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error(`no bestmove: ${out.slice(-300)}`)), 20000))]);
  sf.kill();
  assert.match(out, /readyok/);
  const info = out.split('\n').map((l) => parseInfo(l, false)).filter(Boolean).at(-1);
  assert.ok(info.depth >= 10);
  assert.match(parseBestmove(out.split('\n').find((l) => l.startsWith('bestmove'))), /^[a-h][1-8][a-h][1-8]/);
});
