const { chromium, firefox, webkit } = require('playwright');
const assert = require('node:assert/strict');
const { createServer } = require('../tools/serve.cjs');
(async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    for (const engine of [chromium, firefox, webkit]) {
    browser = await engine.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://camerai1.iticfoundation.org/**', route => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/#analyst`);
    assert.equal(await page.locator('#workspace').isVisible(), true, 'old analysis links show live view');
    assert.equal(await page.locator('#nav-analysis').isVisible(), false, 'analysis is hidden');
    assert.equal(await page.locator('.flood-badge:visible, .rain-badge:visible').count(), 0, 'analysis badges are hidden');
    assert.equal(await page.evaluate(() => typeof globalThis.CctvFloodApi), 'undefined', 'analysis polling is disabled');
    await page.locator('[data-n="9"]').click();
    assert.equal(await page.locator('.tile').count(), 9);
    for (const width of [320, 390, 1024, 1440]) {
      await page.setViewportSize({ width, height: 850 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `no overflow at ${width}`);
    }
    assert.deepEqual(errors, []);
    console.log(`${engine.name()} live interface checks passed`);
    await browser.close();
    browser = null;
    }
  } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
