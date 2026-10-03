globalThis.CctvAnalyst=(()=>{
  const $=id=>document.getElementById(id), core=CctvFloodCore, SVG='http://www.w3.org/2000/svg';
  const ranges={'1h':[3600,60],'24h':[86400,300],'7d':[604800,1800],'30d':[2592000,3600]};
  let client, route, controller, generation=0, latest=[], eventCursor=null, eventRange;
  function node(name,attrs={},text) {const el=document.createElementNS(SVG,name);Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v));if(text!==undefined)el.textContent=text;return el;}
  function cell(row,value,tag='td') {const el=document.createElement(tag);el.textContent=value;row.append(el);return el;}
  function chart(root,buckets,series,max,yLabel) {
    root.replaceChildren(); const W=960,H=240,L=55,R=18,T=18,B=38, plotW=W-L-R,plotH=H-T-B;
    const svg=node('svg',{viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':yLabel});
    const x=i=>L+i/Math.max(1,buckets.length-1)*plotW,y=v=>H-B-v/Math.max(1,max)*plotH;
    const ticks=max<=4?Array.from({length:max+1},(_,i)=>i):[0,.25,.5,.75,1].map(part=>Math.round(max*part));
    [...new Set(ticks)].forEach(value=>{const at=y(value);svg.append(node('line',{x1:L,x2:W-R,y1:at,y2:at,class:'chart-grid'}),node('text',{x:L-8,y:at+4,'text-anchor':'end',class:'chart-label'},value));});
    [...new Set([0,.25,.5,.75,1].map(part=>Math.round(part*(buckets.length-1))))].forEach(index=>{const b=buckets[index];if(!b)return;
      const time=new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(b.end*1000);
      svg.append(node('text',{x:x(index),y:H-9,'text-anchor':index===0?'start':index===buckets.length-1?'end':'middle',class:'chart-label'},time));});
    series.forEach(({key,className})=>core.chartSegments(buckets,key).forEach(segment=>{
      if(segment.length===1) svg.append(node('circle',{cx:x(segment[0].index),cy:y(segment[0].value),r:3,class:className}));
      else svg.append(node('path',{d:segment.map((p,i)=>`${i?'L':'M'} ${x(p.index).toFixed(2)} ${y(p.value).toFixed(2)}`).join(' '),class:className,'data-series':key}));
    }));root.append(svg);
  }
  function selected() {return latest.filter(c=>(!route.cameraId||c.id===route.cameraId)&&(route.cameraId||route.groupId===null||c.groups.includes(route.groupId)));}
  function summary() {
    const cameras=selected(), counts=core.countStatuses(cameras);
    ['active','suspect','clear','unknown','unconfigured'].forEach(status=>{$('summary-'+status).textContent=counts[status];});
    $('analysis-monitored').textContent=`${cameras.length} กล้อง · เวลาไทย (UTC+7)`;
    const status=$('analysis-status').value, body=$('analysis-latest');body.replaceChildren();
    cameras.forEach(c=>{const r=core.effective(c.reading);if(status&&r.status!==status)return;
      const row=document.createElement('tr');const title=cell(row,`CCS ${c.id} · ${c.name}`);
      const button=document.createElement('button');button.textContent='รายละเอียด';button.onclick=()=>CctvFloodUI.open(c.id);title.append(button);
      cell(row,core.label(r.status));cell(row,core.percent(r.water_coverage_pct));cell(row,core.time(r.captured_at));body.append(row);});
  }
  function renderBuckets(buckets) {
    $('analysis-buckets').replaceChildren();
    buckets.forEach(b=>{const row=document.createElement('tr');[core.time(b.end),b.active_count,b.suspect_count,b.valid_count,b.unknown_count,core.percent(b.water_mean_pct),core.percent(b.water_max_pct)].forEach(v=>cell(row,v));$('analysis-buckets').append(row);});
    chart($('count-chart'),buckets,[{key:'active_count',className:'curve-active'},{key:'suspect_count',className:'curve-suspect'},{key:'unknown_count',className:'curve-unknown'}],buckets[0]?.monitored_count||1,'จำนวนกล้อง ณ ปลายช่วงเวลา');
    $('coverage-section').hidden=!route.cameraId;$('coverage-select').hidden=!!route.cameraId;
    if(route.cameraId)chart($('coverage-chart'),buckets,[{key:'water_mean_pct',className:'curve-water'},{key:'water_max_pct',className:'curve-max'}],100,'สัดส่วนพื้นที่น้ำ (%)');
    const count=buckets.filter(b=>b.water_mean_pct!==null).length;
    $('analysis-empty').hidden=buckets.some(b=>b.valid_count>0)||count>0;
  }
  async function evidence(ident) {
    const dialog=$('event-evidence');$('event-evidence-message').textContent='กำลังอ่านหลักฐาน…';$('event-evidence-image').hidden=true;dialog.showModal();
    try {const response=await client.request(`/api/flood/evidence/${encodeURIComponent(ident)}?kind=overlay`);const url=URL.createObjectURL(await response.blob());
      if(!dialog.open){URL.revokeObjectURL(url);return;}const image=$('event-evidence-image');if(image.dataset.objectUrl)URL.revokeObjectURL(image.dataset.objectUrl);image.dataset.objectUrl=url;image.src=url;image.hidden=false;$('event-evidence-message').textContent='หลักฐานตอนเปลี่ยนสถานะ';
    }catch(error){$('event-evidence-message').textContent=error.message.includes('410')?'ภาพหลักฐานหมดอายุแล้ว':'อ่านภาพหลักฐานไม่ได้';}
  }
  function renderEvents(data,append=false) {
    if(!append)$('analysis-events').replaceChildren();
    data.items.forEach(e=>{const row=document.createElement('tr');cell(row,`CCS ${e.camera_id}`);cell(row,core.time(e.started_at));cell(row,e.ended_at?core.time(e.ended_at):'ยังไม่ปิดเหตุการณ์');cell(row,core.percent(e.peak_pct));
      const last=cell(row,e.end_reason||'');if(e.start_evidence_id){const b=document.createElement('button');b.textContent='ดูหลักฐาน';b.onclick=()=>evidence(e.start_evidence_id);last.append(b);}$('analysis-events').append(row);});
    eventCursor=data.next_cursor;$('events-more').hidden=!eventCursor;$('events-empty').hidden=$('analysis-events').children.length>0;
  }
  async function load() {
    controller?.abort();controller=new AbortController();const current=++generation;
    $('analysis-message').textContent='กำลังอ่านข้อมูล…';$('analysis-error').hidden=true;
    $('analysis-buckets').replaceChildren();$('analysis-events').replaceChildren();$('count-chart').replaceChildren();$('coverage-chart').replaceChildren();$('analysis-empty').hidden=true;
    const [duration,bucket]=ranges[route.range],end=Date.now()/1000,start=end-duration;
    const params=new URLSearchParams({start,end,bucket_seconds:bucket});if(route.cameraId)params.set('camera_id',route.cameraId);else if(route.groupId!==null)params.set('group',route.groupId);
    eventRange=new URLSearchParams(params);eventRange.delete('bucket_seconds');eventCursor=null;$('events-more').hidden=true;
    try {
      const responses=await Promise.all(['/api/flood/cameras','/api/flood/health','/api/flood/analytics?'+params,'/api/flood/events?'+eventRange].map(path=>client.request(path,{signal:controller.signal}).then(r=>r.json())));
      if(current!==generation)return;
      const [cameras,health,analytics,events]=responses;latest=cameras.cameras;summary();renderBuckets(analytics.buckets);renderEvents(events);
      $('analysis-message').textContent=!health.worker.available?'Worker ไม่พร้อม · ผลปัจจุบันอาจขาดช่วง':!health.model.available?'โมเดลไม่พร้อม · ยังไม่มีผลวิเคราะห์ใหม่':`อัปเดต ${core.time(cameras.generated_at)} · เป้าหมายทุก ${health.target_interval_seconds} วินาที`;
      $('analysis-span').textContent=`${core.time(start)} — ${core.time(end)}`;
    } catch(error) {if(current!==generation)return;latest=fallback();summary();$('analysis-message').textContent='ไม่มีข้อมูลที่ยืนยันได้';$('analysis-error').hidden=false;
      $('analysis-error').textContent=CctvFloodConfig.apiBaseUrl?'เชื่อมต่อบริการวิเคราะห์ไม่ได้ · กดอ่านใหม่เมื่อบริการพร้อม':'ยังไม่ได้เชื่อมต่อบริการวิเคราะห์ · ต้องตั้งค่า API ก่อนใช้งาน';}
  }
  function init(api) {
    client=api;
    CctvData.GROUPS.forEach((g,i)=>{const option=document.createElement('option');option.value=i;option.textContent=g[0];$('analysis-group').append(option);});
    CctvCore.camsFor(-1).forEach(c=>{const option=document.createElement('option');option.value=c.id;option.textContent=`CCS ${c.id} · ${c.name}`;$('analysis-camera').append(option);});
    ['camera','group','range'].forEach(key=>$('analysis-'+key).onchange=()=>CctvNavigation.navigate({view:'analyst',cameraId:key==='group'?null:$('analysis-camera').value,
      groupId:$('analysis-group').value===''?null:Number($('analysis-group').value),range:$('analysis-range').value}));
    $('analysis-status').onchange=summary;$('analysis-refresh').onclick=load;
    $('events-more').onclick=async()=>{const current=generation;const query=new URLSearchParams(eventRange);query.set('cursor',eventCursor);$('events-more').disabled=true;
      try{const result=await client.request('/api/flood/events?'+query,{signal:controller.signal}).then(r=>r.json());if(current===generation)renderEvents(result,true);}catch(error){if(current===generation){$('analysis-error').hidden=false;$('analysis-error').textContent='อ่านเหตุการณ์เพิ่มเติมไม่ได้';}}finally{$('events-more').disabled=false;}};
    $('analysis-config').onclick=()=>{if(route.cameraId)CctvRoiEditor.open(route.cameraId);};
    $('close-event-evidence').onclick=()=>$('event-evidence').close();$('event-evidence').addEventListener('close',()=>{const image=$('event-evidence-image');if(image.dataset.objectUrl)URL.revokeObjectURL(image.dataset.objectUrl);delete image.dataset.objectUrl;image.removeAttribute('src');});
    document.addEventListener('cctv:view-changed',event=>{controller?.abort();generation++;route=event.detail;if(route.view!=='analyst')return;
      $('analysis-camera').value=route.cameraId||'';$('analysis-group').value=route.groupId??'';$('analysis-range').value=route.range;
      $('analysis-config').disabled=!route.cameraId;load();});
    document.addEventListener('cctv:flood-updated',event=>{if(route?.view!=='analyst')return;latest=event.detail.available?event.detail.cameras:fallback();summary();});
  }
  function fallback(){return CctvCore.camsFor(-1).map(c=>({...c,groups:CctvData.GROUPS.map((_,i)=>i).filter(i=>CctvCore.camsFor(i).some(item=>item.id===c.id)),reading:null}));}
  return {init};
})();
