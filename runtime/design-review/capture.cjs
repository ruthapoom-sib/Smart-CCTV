const { chromium } = require('playwright');
const { createServer } = require('../../tools/serve.cjs');
(async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForTimeout(8000);
    await page.screenshot({ path: 'runtime/design-review/before-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: 'runtime/design-review/before-mobile.png' });
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
