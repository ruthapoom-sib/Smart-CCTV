const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('index.html', 'utf8');
const context = vm.createContext({});
if (fs.existsSync('scripts/core.js')) {
  vm.runInContext(fs.readFileSync('scripts/data.js', 'utf8') + '\n' + fs.readFileSync('scripts/core.js', 'utf8'), context);
} else {
  vm.runInContext(html.slice(html.indexOf('const SRC ='), html.indexOf('// ── player ──')), context);
  vm.runInContext('globalThis.CctvCore = { chunk, wrap, camsFor, fit, pickPlayer, isTV }; globalThis.CctvData = { GROUPS, CAMS };', context);
}
const c = context.CctvCore;
const plain = value => JSON.parse(JSON.stringify(value));
test('40 unique cameras; shared cameras remain in each intersection', () => {
  assert.equal(c.camsFor(-1).length, 40);
  assert.equal(c.camsFor(5).length, 4);
});
test('pagination wraps safely including empty search results', () => {
  assert.deepEqual(plain(c.chunk([1, 2, 3], 2)), [[1, 2], [3]]);
  assert.equal(c.wrap(-1, 5), 4);
  assert.equal(c.wrap(0, 0), 0);
});
test('native HLS is preferred on iPhone and iPad', () => {
  assert.equal(c.pickPlayer({ ua: 'iPhone', touch: 5, hls: true, native: true }), 'native');
  assert.equal(c.pickPlayer({ ua: 'Macintosh', touch: 5, hls: true, native: true }), 'native');
  assert.equal(c.pickPlayer({ ua: 'Windows', hls: true, native: true }), 'hls');
});
test('unavailable forced HLS never crashes the page', () => {
  assert.equal(c.pickPlayer({ ua: 'Windows', hls: false, native: false, force: 'hls' }), 'none');
});
test('search supports Thai, IDs, whitespace and all aliases of a camera', () => {
  assert.deepEqual(plain(c.filterCameras({ query: ' CCS03 ' }).map(x => x.id)), ['03']);
  assert.ok(c.filterCameras({ query: 'วัดโสธร' }).length > 0);
  assert.ok(c.filterCameras({ query: 'พระยาศรีสุนทร' }).some(x => x.id === '13'));
  assert.equal(c.filterCameras({ query: 'no matching camera' }).length, 0);
  assert.deepEqual(plain(c.filterCameras({ favoritesOnly: true, favorites: ['03', '03', 'invalid'] }).map(x => x.id)), ['03']);
});
test('stored settings tolerate corrupt input and remove invalid favorites', () => {
  for (const value of [null, [], 'bad', 8]) assert.equal(c.normalizeSettings(value).size, 4);
  const settings = c.normalizeSettings({ size: 0, interval: -1, g: 999, favorites: ['03', '03', 'invalid'], auto: true });
  assert.equal(settings.interval, 15);
  assert.equal(settings.g, -1);
  assert.deepEqual(plain(settings.favorites), ['03']);
  assert.equal(settings.auto, undefined);
});
test('single and empty grids always have valid dimensions', () => {
  assert.deepEqual(plain(c.fit(0, 1400, 800)), [1, 1]);
  assert.deepEqual(plain(c.fit(1, 1400, 800)), [1, 1]);
});
