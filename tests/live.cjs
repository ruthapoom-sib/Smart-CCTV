const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createServer } = require('../tools/serve.cjs');
const fs = require('node:fs');
(async () => {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    fs.mkdirSync('docs/reviews/evidence', { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForTimeout(12000);
    const before = await page.locator('video').evaluateAll(videos => videos.map(v => v.currentTime));
    await page.waitForTimeout(2500);
    const advancing = await page.locator('video').evaluateAll((videos, times) => videos.filter((v, i) => v.currentTime > times[i]).length, before);
    const states = await page.locator('.tile').evaluateAll(tiles => tiles.map(t => ({ id: t.dataset.id, state: t.dataset.state })));
    await page.screenshot({ path: 'docs/reviews/evidence/desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(7000);
    const mobileBefore = await page.locator('video').evaluateAll(videos => videos.map(v => v.currentTime));
    await page.waitForTimeout(2500);
    const mobileAdvancing = await page.locator('video').evaluateAll((videos, times) => videos.filter((v, i) => v.currentTime > times[i]).length, mobileBefore);
    await page.screenshot({ path: 'docs/reviews/evidence/mobile.png', fullPage: true });
    await page.click('[data-n="all"]'); await page.waitForTimeout(6000);
    await page.screenshot({ path: 'docs/reviews/evidence/mobile-all.png', fullPage: true });
    const report = { at: new Date().toISOString(), advancing, mobileAdvancing, visibleDesktopCameras: states, errors };
    fs.writeFileSync('docs/reviews/evidence/live-results.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    if (!advancing || !mobileAdvancing || errors.length) process.exitCode = 1;
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
