const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {createServer}=require('../tools/serve.cjs');
const fs=require('node:fs');
(async()=>{
  const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://fonts.googleapis.com/**',r=>r.abort());
    await page.route('https://camerai1.iticfoundation.org/**',r=>r.fulfill({status:503,body:'offline'}));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    assert(await page.locator('#nav-analysis').isVisible(),'Analysis navigation is always visible');
    await page.click('[data-n="all"]');await page.waitForTimeout(500);
    assert.equal(await page.locator('.tile').count(),40);
    const all=await page.evaluate(()=>({active:[...document.querySelectorAll('.tile')].filter(t=>t.dataset.state!=='paused').length,
      width:document.querySelector('.tile').getBoundingClientRect().width,scroll:document.querySelector('#grid').scrollHeight>document.querySelector('#grid').clientHeight}));
    assert(all.active<=9 && all.width>=240 && all.scroll,JSON.stringify(all));
    await page.click('#nav-analysis');await page.locator('#analyst').waitFor({state:'visible'});
    assert(await page.locator('#analysis-camera').isVisible(),'Analysis has camera and time filters');
    assert.equal(await page.locator('.tile:not([data-state="paused"])').count(),0,'Analysis releases every player');
    await page.click('#nav-live');assert.equal(await page.locator('.tile').count(),40,'Live state survives');
    assert.deepEqual(errors,[]); console.log('PASS Analysis navigation, All sizing and bounded streams, player cleanup');
    await page.close();
    const app=await browser.newPage({viewport:{width:1440,height:900}}), now=Date.now()/1000;
    const faults=[];app.on('pageerror',e=>faults.push(e.message));let sourceRequests=0,submitted=null,conflict=true;
    await app.route('https://camerai1.iticfoundation.org/**',r=>{sourceRequests++;return r.fulfill({status:503,body:'offline'});});
    await app.route('https://fonts.googleapis.com/**',r=>r.abort());
    const cfg={camera_id:'03',revision:1,enabled:true,roi:null,thresholds:{pixel_score:.5,suspect_pct:5,active_pct:15,confirmations:3}};
    const sample=(id,status,coverage)=>({id,name:'ถนนทดสอบ '+id,groups:[4,5],reading:{camera_id:id,status,captured_at:now,processed_at:now,water_coverage_pct:coverage,model_score:.6,config_revision:1}});
    const rows=[sample('03','active',25),sample('13','unknown',null),sample('14','unconfigured',null)];
    await app.route('http://127.0.0.1:8100/**',async r=>{
      const path=new URL(r.request().url()).pathname, method=r.request().method();let body,status=200;
      if(path.endsWith('/health'))body={worker:{available:true},model:{available:true},target_interval_seconds:60};
      else if(path.endsWith('/cameras'))body={generated_at:now,cameras:rows};
      else if(path.endsWith('/analytics')){const camera=new URL(r.request().url()).searchParams.get('camera_id');body={camera_ids:camera?[camera]:['03','13','14'],buckets:[10,null,0].map((v,i)=>({start:now-180+i*60,end:now-120+i*60,monitored_count:camera?1:3,valid_count:v===null?0:1,unknown_count:v===null?1:0,active_count:i===0?1:0,suspect_count:0,water_mean_pct:camera?v:null,water_max_pct:camera?v:null}))};}
      else if(path.endsWith('/events'))body={items:[{id:'event',camera_id:'03',started_at:now-120,ended_at:null,peak_pct:25,start_evidence_id:'a'.repeat(32)}],next_cursor:null};
      else if(path.includes('/evidence/')){status=410;body={detail:'evidence_expired'};}
      else if(path.endsWith('/config')){if(method==='PUT'){submitted=r.request().postDataJSON();assert.equal(r.request().headers().authorization,'Bearer private-admin');status=conflict?409:200;body=conflict?{detail:'config_revision_conflict'}:{...cfg,...submitted,revision:2};}else body=cfg;}
      else if(path.endsWith('/snapshot')){assert.equal(r.request().headers().authorization,'Bearer private-admin');if(method==='POST')body={captured_at:now};else return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#263c48"/><path d="M0 360L260 0H380L640 360" fill="#64727c"/></svg>'});}
      else {status=404;body={detail:'unknown'};}
      return r.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    });
    await app.goto(`http://127.0.0.1:${server.address().port}/#analyst?camera=03&range=1h`);
    await app.waitForFunction(()=>document.querySelector('#analysis-buckets').children.length===3);
    assert.equal(sourceRequests,0,'initial Analysis deep link never opens streams');
    assert.equal(await app.locator('#analysis-camera').inputValue(),'03');
    assert.equal(await app.locator('#coverage-chart circle.curve-water').count(),2,'null bucket splits the water curve');
    assert.equal(await app.locator('#analysis-buckets tr').first().locator('td').nth(5).textContent(),'10.0%');
    await app.locator('#analysis-events button').click();await app.waitForFunction(()=>document.querySelector('#event-evidence-message').textContent.includes('หมดอายุ'));
    await app.click('#close-event-evidence');
    fs.mkdirSync('runtime/flood/qa',{recursive:true});
    for(const width of [320,390,768,1440]){
      await app.setViewportSize({width,height:900});await app.evaluate(()=>{scrollTo(0,0);document.querySelector('#analyst').scrollTop=0;});await app.screenshot({path:`runtime/flood/qa/analysis-${width}.png`,fullPage:true});
      assert(await app.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Analysis no overflow at ${width}`);
    }
    await app.click('#analysis-config');await app.fill('#roi-token','private-admin');await app.click('#roi-capture');await app.locator('#roi-stage').waitFor({state:'visible'});
    const expected=[[.2,.2],[.8,.2],[.8,.8],[.2,.8]];
    for(let i=0;i<4;i++){
      if(i===2)await app.setViewportSize({width:390,height:900});
      const target=await app.locator('#roi-svg').evaluate((svg,p)=>{const pt=new DOMPoint(p[0]*640,p[1]*360).matrixTransform(svg.getScreenCTM());return {x:pt.x,y:pt.y};},expected[i]);
      await app.mouse.click(target.x,target.y);
    }
    await app.click('#roi-save');await app.waitForFunction(()=>document.querySelector('#roi-message').textContent.includes('ร่างยังอยู่'));
    assert.equal(submitted.roi.length,4);
    submitted.roi.forEach((p,i)=>p.forEach((v,j)=>assert(Math.abs(v-expected[i][j])<.002,'ROI coordinates survive letterboxing and resize')));
    assert.equal((await app.locator('#roi-coordinates').inputValue()).split('\n').length,4,'409 retains draft');
    conflict=false;await app.click('#roi-save');await app.waitForFunction(()=>document.querySelector('#roi-message').textContent.includes('บันทึกแล้ว'));
    await app.fill('#roi-coordinates','0,0\n1,1\n0,1\n1,0');assert(await app.locator('#roi-save').isDisabled(),'crossing polygon cannot save');
    await app.screenshot({path:'runtime/flood/qa/roi-390.png',fullPage:true});await app.click('#close-roi');
    await app.waitForFunction(()=>document.querySelector('#roi-token').value==='');
    assert.equal(await app.locator('#roi-token').inputValue(),'');
    assert(!await app.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('private-admin')),'admin token never stored');
    await app.selectOption('#analysis-camera','');await app.waitForFunction(()=>!document.querySelector('#coverage-select').hidden);
    assert(await app.locator('#coverage-section').isHidden());
    await app.goBack();await app.waitForFunction(()=>document.querySelector('#analysis-camera').value==='03');
    await app.reload();await app.waitForFunction(()=>document.querySelector('#analysis-buckets').children.length===3);
    assert.equal(sourceRequests,0);assert.deepEqual(faults,[]);
    console.log('PASS mocked API charts/tables, gaps, routes, evidence expiry, ROI geometry/conflict, token handling and four viewport screenshots');
    await app.close();
  } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
