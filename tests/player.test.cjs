const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup(playResult = () => Promise.resolve()) {
  let next = 0, now = 0;
  const timers = new Map();
  const video = {
    currentTime: 0, paused: false, muted: true,
    play() { this.paused = false; return playResult(); }, pause() { this.paused = true; },
    removeAttribute() {}, load() {}, addEventListener() {}, removeEventListener() {}
  };
  const message = { textContent: '' }, label = { textContent: '' };
  const tile = { dataset: {}, isConnected: true, querySelector: s => s === 'video' ? video : s === '.msg' ? message : s === '.state-label' ? label : null };
  const context = vm.createContext({
    console, document: { hidden: false }, navigator: { onLine: true },
    Date: { now: () => now }, setTimeout: (fn, ms) => { timers.set(++next, {fn, ms, due: now + ms, repeat: false}); return next; },
    setInterval: (fn, ms) => { timers.set(++next, {fn, ms, due: now + ms, repeat: true}); return next; },
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
  return { tile, video, message, label, timers, stop, resume: () => handle.resume(), advance(ms) {
    const end = now + ms;
    while (true) {
      const nextTimer = [...timers].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
      if (!nextTimer) break;
      const [id, t] = nextTimer;
      now = t.due;
      if (t.repeat) t.due += t.ms; else timers.delete(id);
      t.fn();
    }
    now = end;
  }};
}
test('destroy clears all video handlers and retry/watchdog timers', () => {
  const p = setup(); p.stop();
  assert.equal(p.video.onplaying, null);
  assert.equal(p.video.onended, null);
  assert.equal(p.video.onerror, null);
  assert.equal(p.video.ontimeupdate, null);
  assert.equal(p.timers.size, 0);
});

test('connection and brief buffering use caption status without text over footage', () => {
  const p = setup();
  assert.equal(p.message.textContent, '');
  p.video.onplaying(); p.video.onwaiting();
  assert.equal(p.tile.dataset.state, 'buffering');
  assert.equal(p.label.textContent, 'รอภาพ');
  assert.equal(p.message.textContent, '');
  p.video.onplaying();
  assert.equal(p.tile.dataset.state, 'live');
  p.stop();
});

test('advancing video clears stale buffering and its connection deadline without another playing event', () => {
  const p = setup();
  p.video.onplaying(); p.video.onstalled();
  for (let i = 1; i <= 6; i++) {
    p.video.currentTime = i * 5;
    p.advance(5000);
    assert.equal(p.tile.dataset.state, 'live');
  }
  assert.equal(p.video.paused, false);
  p.stop();
});

test('time updates restore live only when unpaused video actually advances', () => {
  const p = setup();
  p.video.onplaying(); p.video.onwaiting();
  p.video.ontimeupdate?.();
  assert.equal(p.tile.dataset.state, 'buffering');
  p.video.paused = true; p.video.currentTime = 1; p.video.ontimeupdate?.();
  assert.equal(p.tile.dataset.state, 'buffering');
  p.video.paused = false; p.video.ontimeupdate?.();
  assert.equal(p.tile.dataset.state, 'live');
  p.stop();
});

test('prolonged frozen video reports a caption fault and retries automatically', () => {
  const p = setup();
  p.video.onplaying(); p.video.onwaiting();
  p.advance(15000);
  assert.equal(p.tile.dataset.state, 'offline');
  assert.equal(p.label.textContent, 'สัญญาณขัดข้อง');
  assert.equal(p.message.textContent, '');
  p.advance(3000);
  assert.equal(p.tile.dataset.state, 'connecting');
  p.stop();
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
