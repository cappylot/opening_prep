// Hash routes: #/ (search) and #/u/{name}?c=w&m=e2e4,c7c5&t=explore
export function parseHash(hash = location.hash) {
  const m = hash.match(/^#\/u\/([^?/]+)(?:\?(.*))?$/);
  if (!m) return { view: 'search' };
  const q = new URLSearchParams(m[2] || '');
  const moves = (q.get('m') || '').split(',').filter((x) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(x));
  const c = q.get('c');
  return {
    view: 'prep',
    name: decodeURIComponent(m[1]),
    color: c === 'b' ? 'black' : c === 'w' ? 'white' : null,
    moves,
    tab: ['explore', 'insights', 'lines'].includes(q.get('t')) ? q.get('t') : 'explore',
  };
}

export function prepHash(name, { color, moves = [], tab } = {}) {
  const q = new URLSearchParams();
  if (color) q.set('c', color[0]);
  if (moves.length) q.set('m', moves.join(','));
  if (tab && tab !== 'explore') q.set('t', tab);
  const qs = q.toString().replace(/%2C/g, ',');
  return `#/u/${encodeURIComponent(name)}${qs ? `?${qs}` : ''}`;
}

export const go = (hash) => {
  location.hash = hash;
};
