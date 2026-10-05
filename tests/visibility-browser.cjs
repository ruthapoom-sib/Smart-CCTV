const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { createServer } = require('../tools/serve.cjs');
(async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await page.route('https://fonts.googleapis.com/**', r => r.abort());
    await page.route('https://camerai1.iticfoundation.org/**', r => r.fulfill({ status: 503, body: 'Offline', headers: { 'access-control-allow-origin': '*' } }));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('[data-n="all"]').click();
    for (const height of [900, 1000, 1080, 1200]) {
      await page.setViewportSize({ width: 1440, height });
      await page.locator('#grid').evaluate(el => { el.scrollTop = 0; });
      await page.waitForTimeout(100);
      for (const id of ['30', '41']) {
        await page.locator('#grid').evaluate((el, id) => {
          const tile = el.querySelector(`.tile[data-id="${id}"]`);
          el.scrollTop += tile.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom;
        }, id);
        await page.waitForTimeout(300);
        const snapshot = await page.locator('#grid').evaluate(grid => {
          const viewport = grid.getBoundingClientRect();
          const cameras = [...grid.querySelectorAll('.tile')].map(tile => {
            const screen = tile.querySelector('.screen').getBoundingClientRect();
            const rect = tile.getBoundingClientRect();
            return { id: tile.dataset.id, state: tile.dataset.state, fullyVisibleScreen: screen.top >= viewport.top && screen.bottom <= viewport.bottom, visibleTileRatio: Math.max(0, Math.min(rect.bottom, viewport.bottom) - Math.max(rect.top, viewport.top)) / rect.height };
          });
          return { cameras: cameras.filter(c => c.visibleTileRatio > 0), active: cameras.filter(c => c.state !== 'paused').length };
        });
        console.log(JSON.stringify({ height, target: id, active: snapshot.active, paused: snapshot.cameras.filter(c => c.state === 'paused').map(c => c.id) }));
        assert(snapshot.active <= 9, 'All mode must retain its nine-player resource limit');
        // Partially clipped tiles must not consume slots ahead of fully visible footage.
        const fullyVisible = snapshot.cameras.filter(c => c.fullyVisibleScreen);
        if (fullyVisible.length <= 9) assert(fullyVisible.every(c => c.state !== 'paused'), `Fully visible camera footage must start at ${height}px: ${JSON.stringify(fullyVisible)}`);
        const target = snapshot.cameras.find(c => c.id === id);
        assert(target && target.state !== 'paused', `The camera just scrolled into view must start: ${id} at ${height}px`);
        if (id === '41') {
          const neighbor = snapshot.cameras.find(c => c.id === '40');
          assert(neighbor && neighbor.state !== 'paused', `Camera 40 must also start beside 41 at ${height}px`);
        }
      }
      await page.locator('#grid').evaluate(el => {
        const tile = el.querySelector('.tile[data-id="30"]');
        el.scrollTop += tile.getBoundingClientRect().top - el.getBoundingClientRect().top;
      });
      await page.waitForTimeout(300);
      assert(await page.locator('.tile[data-id="30"]').getAttribute('data-state') !== 'paused', 'Scrolling upward must prioritize newly visible footage too');
      assert(await page.locator('.tile:not([data-state="paused"])').count() <= 9);
    }
    console.log('PASS fully visible footage starts without exceeding nine streams');
  } finally { await browser?.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
