const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup(playResult = () => Promise.resolve()) {
  let next = 0, now = 0;
  const timers = new Map();
  const video = {
    currentTime: 0, paused: false, muted: true,
    play: playResult, pause() { this.paused = true; },
    removeAttribute() {}, load() {}, addEventListener() {}, removeEventListener() {}
  };
  const tile = { dataset: {}, isConnected: true, querySelector: s => s === 'video' ? video : s === '.msg' ? { textContent: '' } : null };
  const context = vm.createContext({
    console, document: { hidden: false }, navigator: { onLine: true },
    Date: { now: () => now }, setTimeout: (fn, ms) => { timers.set(++next, {fn, ms, repeat: false}); return next; },
    setInterval: (fn, ms) => { timers.set(++next, {fn, ms, repeat: true}); return next; },
    clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id),
    PLAYER: 'native', DEBUG: false, SRC: id => id, window: {},
  });
  if (fs.existsSync('scripts/player.js')) vm.runInContext(fs.readFileSync('scripts/player.js', 'utf8'), context);
  else {
    const html = fs.readFileSync('index.html', 'utf8');
    vm.runInContext("const MSG = { connecting: 'connecting', live: '', offline: 'offline', blocked: 'blocked' };\n" + html.slice(html.indexOf('function play(tile, cam)'), html.indexOf('// ── ui ──')) + '\nglobalThis.CctvPlayer = { create: play };', context);
  }
  const handle = context.CctvPlayer.create(tile, { id: '03' }, { mode: 'native', src: id => id });
  const stop = typeof handle === 'function' ? handle : () => handle.destroy();
  return { tile, video, timers, stop, resume: () => handle.resume(), advance(ms) {
    now += ms;
    for (const [id, t] of [...timers]) if (t.ms <= ms) { if (!t.repeat) timers.delete(id); t.fn(); }
  }};
}
test('destroy clears all video handlers and retry/watchdog timers', () => {
  const p = setup(); p.stop();
  assert.equal(p.video.onplaying, null);
  assert.equal(p.video.onended, null);
  assert.equal(p.video.onerror, null);
  assert.equal(p.timers.size, 0);
});
test('late autoplay rejection cannot mutate a destroyed player', async () => {
  let reject;
  const p = setup(() => new Promise((_, r) => { reject = r; }));
  p.stop();
  const before = p.tile.dataset.state;
  reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(p.tile.dataset.state, before);
});
test('initial connection timeout recovers even when playing never fires', () => {
  const p = setup();
  p.advance(26000);
  assert.equal(p.tile.dataset.state, 'offline');
  p.stop();
});
test('a user gesture after blocked autoplay gets a fresh connection deadline', async () => {
  let attempts = 0;
  const p = setup(() => ++attempts === 1
    ? Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }))
    : new Promise(() => {}));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(p.tile.dataset.state, 'blocked');
  p.resume(); p.advance(26000);
  assert.equal(p.tile.dataset.state, 'offline');
  p.stop();
});
