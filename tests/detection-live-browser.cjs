const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const site = process.env.CCTV_PAGE_URL || 'http://127.0.0.1:8000';
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(site+'/#analyst?kind=flood&camera=07&range=1h');
    const base = await page.evaluate(() => CctvFloodConfig.apiBaseUrl);
    assert(base, 'Hosted site must have a real API URL');
    const flood = await fetch(base+'/api/flood/health').then(r=>r.json());
    const rain = await fetch(base+'/api/rain/health').then(r=>r.json());
    assert.equal(flood.worker.available,true);
    assert.equal(flood.model.available,true);
    assert.equal(rain.worker.available,true);
    await page.waitForFunction(() => document.querySelector('#summary-clear').textContent === '1');
    assert.equal(await page.locator('#summary-unknown').textContent(),'0');
    fs.mkdirSync('runtime/detection/qa',{recursive:true});
    await page.screenshot({path:'runtime/detection/qa/water-live.png'});
    const rainResponse = page.waitForResponse(response => response.url().includes('/api/rain/cameras') && response.ok());
    await page.click('#kind-rain');
    await rainResponse;
    await page.waitForFunction(() => document.querySelector('#kind-rain').getAttribute('aria-selected') === 'true');
    await page.screenshot({path:'runtime/detection/qa/rain-live.png'});
    await page.click('#nav-live');
    await page.fill('#search','07');
    const readings = await fetch(base+'/api/rain/cameras').then(r=>r.json());
    const expectedRain = readings.cameras.find(c=>c.id==='07').reading.status;
    await page.waitForFunction(status => document.querySelector('.tile[data-id="07"] .rain-badge')?.dataset.status === status,expectedRain);
    assert.equal(await page.locator('.tile[data-id="07"] .flood-badge').getAttribute('data-status'),'clear');
    await page.screenshot({path:'runtime/detection/qa/viewer-live.png'});
    assert.deepEqual(errors,[]);
    const report = {passed:true,site,api:base,flood_worker:true,model:true,rain_worker:true,camera:'07',water:'clear',rain:expectedRain,errors};
    fs.writeFileSync('runtime/detection/qa/result.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally {
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
