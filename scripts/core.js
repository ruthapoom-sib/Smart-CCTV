// Pure data and layout logic; also used by the Node regression tests.
(() => {
  'use strict';
  const { GROUPS, CAMS } = globalThis.CctvData;
  const SIZES = [1, 4, 9, 16, 'all'];
  const INTERVALS = [10, 15, 30, 60];
  const unique = list => [...new Map(list.map(c => [c.id, c])).keys()].map(id => list.find(c => c.id === id));
  const camsFor = g => g < 0 ? unique(CAMS) : CAMS.filter(c => c.g === g);
  const wrap = (i, len) => len > 0 ? ((i % len) + len) % len : 0;
  function chunk(list, size) {
    if (!Number.isInteger(size) || size < 1) return [];
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }
  const normalize = text => String(text || '').normalize('NFC').trim().toLocaleLowerCase('th');
  function filterCameras({ g = -1, query = '', favoritesOnly = false, favorites = [] } = {}) {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    return camsFor(g).filter(cam => {
      if (favoritesOnly && !favorites.includes(cam.id)) return false;
      // A camera can belong to more than one intersection. Search all its names.
      const haystack = normalize(CAMS.filter(c => c.id === cam.id).map(c => `ccs${c.id} ${c.name} ${c.group}`).join(' '));
      return terms.every(term => haystack.includes(term));
    });
  }
  function normalizeSettings(value) {
    const saved = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const validIds = new Set(CAMS.map(c => c.id));
    return {
      size: SIZES.includes(saved.size) ? saved.size : 4,
      interval: INTERVALS.includes(saved.interval) ? saved.interval : 15,
      g: Number.isInteger(saved.g) && saved.g >= -1 && saved.g < GROUPS.length ? saved.g : -1,
      favorites: Array.isArray(saved.favorites) ? [...new Set(saved.favorites.filter(id => validIds.has(id)))] : [],
    };
  }
  function pickPlayer({ ua = '', touch = 0, hls, native, force }) {
    if (force === 'hls' && hls) return 'hls';
    if (force === 'native' && native) return 'native';
    const apple = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && touch > 1);
    if (apple && native) return 'native';
    return hls ? 'hls' : native ? 'native' : 'none';
  }
  const isTV = ua => /Tizen|Web0S|webOS|SMART-TV|SmartTV|HbbTV|NetCast|BRAVIA/i.test(ua);
  function fit(n, w, h, strip = 0, gap = 10) {
    if (n < 1) return [1, 1];
    let best = [1, n], bestW = -Infinity;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const tileW = Math.min((w - (cols - 1) * gap) / cols, ((h - (rows - 1) * gap) / rows - strip) * 16 / 9);
      if (tileW > bestW) { bestW = tileW; best = [cols, rows]; }
    }
    return best;
  }
  globalThis.CctvCore = { SIZES, INTERVALS, camsFor, wrap, chunk, filterCameras, normalizeSettings, pickPlayer, isTV, fit };
})();
