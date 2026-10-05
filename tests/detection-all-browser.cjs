// Read-only acceptance check against actual configured APIs and camera streams.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const site = process.env.CCTV_PAGE_URL || 'http://127.0.0.1:8000';
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const report = { site, detectors: {} };
  try {
    fs.mkdirSync('runtime/detection/qa', { recursive: true });
    for (const kind of ['flood', 'rain']) {
      await page.goto(`${site}/#analyst?kind=${kind}&range=1h`);
      await page.waitForFunction(() => document.querySelector('#analysis-message')?.textContent.startsWith('อัปเดต'));
      const base = await page.evaluate(kind => (kind === 'rain' ? CctvRainConfig : CctvFloodConfig).apiBaseUrl, kind);
      assert.ok(base);
      const prefix = `${base}/api/${kind}`;
      async function request(path) {
        const response = await fetch(prefix + path);
        assert.equal(response.status, 200, path);
        return response.json();
      }
      const health = await request('/health');
      assert.equal(health.worker.available, true);
      const { cameras } = await request('/cameras');
      assert.equal(cameras.length, 40);
      for (let offset = 0; offset < cameras.length; offset += 4) {
        const configs = await Promise.all(cameras.slice(offset, offset+4).map(c => request(`/cameras/${c.id}/config`)));
        for (const config of configs) {
          assert.equal(config.enabled, true, config.camera_id);
          assert.deepEqual(config.roi, [[0,0],[1,0],[1,1],[0,1]], config.camera_id);
        }
      }
      assert.equal(await page.locator('#analysis-error').isVisible(), false);
      assert.equal(await page.locator('#summary-unconfigured').textContent(), '0');
      assert.equal(await page.locator('#analysis-latest tr').count(), 40);
      assert.ok(await page.locator('#analysis-buckets tr').count() > 0);
      const valid = cameras.filter(c => ['clear','suspect','active','dry','rainy'].includes(c.reading.status));
      assert.ok(valid.length > 0, 'Must include actual fresh detector results');
      const counts = cameras.reduce((counts,c) => {
        counts[c.reading.status] = (counts[c.reading.status] || 0) + 1;
        return counts;
      }, {});
      report.detectors[kind] = { enabled:40, fullFrame:40, counts,
        unavailable:cameras.filter(c => c.reading.status === 'unknown').map(c => ({id:c.id,reason:c.reading.reason})) };
      await page.screenshot({ path: `runtime/detection/qa/${kind}-all.png`, fullPage: true });
    }
    assert.deepEqual(errors, []);
    report.passed = true;
    report.errors = errors;
    fs.writeFileSync('runtime/detection/qa/all-result.json', JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
