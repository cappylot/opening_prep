// On-device Stockfish (lite, single-threaded WASM build) behind a small UCI
// wrapper. One search at a time; a new request stops the previous one.

const ENGINE_URL = new URL('../vendor/stockfish/stockfish-18-lite-single.js', import.meta.url);
const INIT_TIMEOUT = 45000; // first load downloads ~7 MB
const STALL_TIMEOUT = 15000; // no output for this long → restart the engine

/**
 * Parses a UCI "info" line into { depth, cp | mate, pv } from White's point
 * of view. Returns null for lines without a usable score (bounds, multipv>1…).
 */
export function parseInfo(line, whiteToMove = true) {
  if (!line.startsWith('info ') || !line.includes(' score ') || !line.includes(' pv ')) return null;
  if (/ (lowerbound|upperbound)( |$)/.test(line)) return null;
  const multipv = line.match(/ multipv (\d+)/);
  if (multipv && multipv[1] !== '1') return null;
  const depth = Number(line.match(/ depth (\d+)/)?.[1]);
  const score = line.match(/ score (cp|mate) (-?\d+)/);
  if (!depth || !score) return null;
  const sign = whiteToMove ? 1 : -1;
  const pv = line.split(' pv ')[1].trim().split(/\s+/);
  const out = { depth, pv, best: pv[0] || null };
  if (score[1] === 'cp') out.cp = sign * Number(score[2]);
  else out.mate = sign * Number(score[2]);
  return out;
}

/** "bestmove e2e4 ponder e7e5" → "e2e4"; null for "(none)". */
export function parseBestmove(line) {
  if (!line.startsWith('bestmove')) return null;
  const m = line.split(/\s+/)[1];
  return m && m !== '(none)' ? m : null;
}

export const engineSupported = () => typeof WebAssembly === 'object' && typeof Worker === 'function';

class Engine {
  constructor() {
    this.worker = null;
    this.ready = null;
    this.current = null; // running job
    this.pending = null; // latest queued job
    this.stall = null;
  }

  get loaded() {
    return !!this.worker && this.isReady;
  }

  init() {
    if (this.ready) return this.ready;
    this.isReady = false;
    this.ready = new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new Worker(ENGINE_URL);
      } catch (e) {
        reject(e);
        return;
      }
      this.worker = worker;
      const timer = setTimeout(() => {
        this.reset(new Error('Engine took too long to load'));
        reject(new Error('Engine took too long to load'));
      }, INIT_TIMEOUT);
      this.onReady = () => {
        clearTimeout(timer);
        this.isReady = true;
        resolve();
      };
      worker.onmessage = (e) => this.onLine(String(e.data));
      worker.onerror = (e) => {
        clearTimeout(timer);
        const err = new Error(e.message || 'Engine failed to load');
        this.reset(err);
        reject(err);
      };
      worker.postMessage('uci');
      worker.postMessage('setoption name Hash value 32');
      worker.postMessage('isready');
    });
    this.ready.catch(() => {});
    return this.ready;
  }

  /** Tears the worker down; the next analyse() starts a fresh one. */
  reset(err) {
    clearTimeout(this.stall);
    try {
      this.worker?.terminate();
    } catch {
      /* ignore */
    }
    this.worker = null;
    this.ready = null;
    this.isReady = false;
    for (const job of [this.current, this.pending]) job?.reject(err || new Error('Engine stopped'));
    this.current = this.pending = null;
  }

  onLine(line) {
    if (line === 'readyok') {
      this.onReady?.();
      this.onReady = null;
      return;
    }
    const job = this.current;
    if (!job) return;
    this.armStall();
    if (line.startsWith('info ')) {
      const info = parseInfo(line, job.whiteToMove);
      if (info && !job.cancelled) {
        job.last = info;
        job.onInfo?.(info);
      }
    } else if (line.startsWith('bestmove')) {
      clearTimeout(this.stall);
      this.current = null;
      if (job.cancelled) job.resolve(null);
      else job.resolve(job.last ? { ...job.last, best: parseBestmove(line) || job.last.best } : null);
      this.startNext();
    }
  }

  armStall() {
    clearTimeout(this.stall);
    this.stall = setTimeout(() => this.reset(new Error('Engine stalled')), STALL_TIMEOUT);
  }

  startNext() {
    const job = this.pending;
    this.pending = null;
    if (!job) return;
    this.current = job;
    this.worker.postMessage(`position fen ${job.fen}`);
    this.worker.postMessage(`go depth ${job.depth}`);
    this.armStall();
  }

  /**
   * Analyses a position to `depth`, calling onInfo as it deepens. Resolves with
   * the final result, or null if cancelled (via signal or a newer request).
   */
  async analyse(fen, { depth = 18, onInfo, signal } = {}) {
    await this.init();
    if (signal?.aborted) return null;
    return new Promise((resolve, reject) => {
      const job = { fen, depth, onInfo, resolve, reject, whiteToMove: fen.split(' ')[1] !== 'b', cancelled: false, last: null };
      signal?.addEventListener('abort', () => this.cancel(job));
      if (this.pending) {
        this.pending.resolve(null);
      }
      this.pending = job;
      if (this.current) {
        this.current.cancelled = true;
        this.worker.postMessage('stop');
      } else this.startNext();
    });
  }

  cancel(job) {
    if (this.pending === job) {
      this.pending = null;
      job.resolve(null);
    } else if (this.current === job && !job.cancelled) {
      job.cancelled = true;
      this.worker?.postMessage('stop');
    }
  }

  /** Stops any running search (e.g. when the page is hidden). */
  stop() {
    if (this.pending) {
      this.pending.resolve(null);
      this.pending = null;
    }
    if (this.current && !this.current.cancelled) {
      this.current.cancelled = true;
      this.worker?.postMessage('stop');
    }
  }
}

let engine = null;
export function getEngine() {
  if (!engine) {
    engine = new Engine();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => document.hidden && engine.stop());
    }
  }
  return engine;
}
