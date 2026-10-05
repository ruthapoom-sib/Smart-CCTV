const { chromium } = require('playwright');
const { createServer } = require('../../tools/serve.cjs');
const fs = require('node:fs');
(async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], failed = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', response => { if (response.url().includes('iticfoundation') && response.status() >= 400) failed.push({ url: response.url(), status: response.status() }); });
    page.on('requestfailed', request => { if (request.url().includes('iticfoundation')) failed.push({ url: request.url(), error: request.failure()?.errorText }); });
    await page.addInitScript(() => {
      localStorage.setItem('cctv', JSON.stringify({ size: 4, favorites: ['03','30','40','41'], interval: 15, g: -1 }));
      window.probeEvents = [];
      let library;
      Object.defineProperty(window, 'Hls', { configurable: true, get: () => library, set: Original => {
        library = class extends Original {
          constructor(config) {
            super(config);
            this.on(Original.Events.ERROR, (_, e) => window.probeEvents.push({ event: 'error', url: this.url, type: e.type, details: e.details, fatal: e.fatal, reason: e.reason, error: e.error?.message, code: e.response?.code }));
            this.on(Original.Events.BUFFER_CODECS, (_, data) => window.probeEvents.push({ event: 'codecs', url: this.url, tracks: Object.fromEntries(Object.entries(data).map(([key, track]) => [key, { codec: track.codec, container: track.container }])) }));
          }
        };
      } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('#favorites').click();
    await page.waitForTimeout(12000);
    const first = await page.locator('video').evaluateAll(els => els.map(el => el.currentTime));
    await page.waitForTimeout(2500);
    const tiles = await page.locator('.tile').evaluateAll((els, times) => els.map((el,i) => {
      const v = el.querySelector('video'), rect = el.querySelector('.screen').getBoundingClientRect();
      return { id: el.dataset.id, state: el.dataset.state, readyState: v.readyState, currentTime: v.currentTime, advancing: v.currentTime > times[i], width: v.videoWidth, height: v.videoHeight, error: v.error?.message, screen: { width: rect.width, height: rect.height }, opacity: getComputedStyle(el).opacity };
    }), first);
    const playlist = {};
    for (const id of ['03','30','40','41']) {
      const url = `https://camerai1.iticfoundation.org/hls/ccs${id}.m3u8`;
      const response = await page.request.get(url);
      const body = await response.text();
      const segments = body.split(/\r?\n/).filter(line => line && !line.startsWith('#'));
      const segmentUrl = new URL(segments.at(-1), url).href;
      const segment = await page.request.get(segmentUrl);
      playlist[id] = { status: response.status(), body, segmentUrl, segmentStatus: segment.status(), segmentBytes: (await segment.body()).length };
    }
    await page.screenshot({ path: 'runtime/design-review/cameras-30-40-41.png' });
    const modes = [];
    await page.locator('#favorites').click();
    await page.locator('[data-n="all"]').click();
    for (const id of ['30','40','41']) {
      const tile = page.locator(`.tile[data-id="${id}"]`);
      await page.locator('#grid').evaluate((grid, id) => {
        const tile = grid.querySelector(`.tile[data-id="${id}"]`);
        grid.scrollTop += tile.getBoundingClientRect().bottom - grid.getBoundingClientRect().bottom;
      }, id);
      await page.waitForFunction(id => document.querySelector(`.tile[data-id="${id}"]`).dataset.state === 'live', id, { timeout: 15000 });
      const time = await tile.locator('video').evaluate(v => v.currentTime);
      await page.waitForTimeout(1000);
      modes.push({ mode: 'desktop-all', id, ...(await tile.evaluate((el, time) => ({ state: el.dataset.state, advancing: el.querySelector('video').currentTime > time }), time)) });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-n="1"]').click();
    for (const id of ['30','40','41']) {
      const tile = page.locator(`.tile[data-id="${id}"]`);
      await tile.evaluate(el => el.scrollIntoView({ block: 'nearest', inline: 'start', behavior: 'instant' }));
      await page.waitForFunction(id => document.querySelector(`.tile[data-id="${id}"]`).dataset.state === 'live', id, { timeout: 15000 });
      const time = await tile.locator('video').evaluate(v => v.currentTime);
      await page.waitForTimeout(1000);
      modes.push({ mode: 'mobile-swipe', id, ...(await tile.evaluate((el, time) => ({ state: el.dataset.state, advancing: el.querySelector('video').currentTime > time }), time)) });
    }
    const result = { at: new Date().toISOString(), tiles, playlist, modes, hls: await page.evaluate(() => window.probeEvents), failed, errors };
    fs.writeFileSync('runtime/design-review/cameras-30-40-41.json', JSON.stringify(result,null,2));
    console.log(JSON.stringify({ at: result.at, tiles, modes, errors },null,2));
  } finally { await browser?.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
