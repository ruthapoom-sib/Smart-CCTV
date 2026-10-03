globalThis.CctvRoiEditor=(()=>{
  const $=id=>document.getElementById(id), NS='http://www.w3.org/2000/svg';
  let client, id, config, points=[], width=640,height=360,token='',url=null,generation=0,controller;
  function valid(p) {
    if(p.length<3||p.length>64||p.some(a=>a.length!==2||a.some(v=>!Number.isFinite(v)||v<0||v>1)))return false;
    if(new Set(p.map(a=>a.join(','))).size!==p.length)return false;
    let area=0;for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];area+=a[0]*b[1]-b[0]*a[1];}if(Math.abs(area)<1e-6)return false;
    const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const on=(a,b,c)=>Math.abs(cross(a,b,c))<1e-9&&c[0]>=Math.min(a[0],b[0])&&c[0]<=Math.max(a[0],b[0])&&c[1]>=Math.min(a[1],b[1])&&c[1]<=Math.max(a[1],b[1]);
    for(let i=0;i<p.length;i++)for(let j=i+1;j<p.length;j++){
      if(j===i+1||(i===0&&j===p.length-1))continue;
      const a=p[i],b=p[(i+1)%p.length],c=p[j],d=p[(j+1)%p.length];
      if((cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))return false;
    }return true;
  }
  function draw(updateText=true) {
    $('roi-polygon').setAttribute('points',points.map(p=>`${p[0]*width},${p[1]*height}`).join(' '));
    if(updateText)$('roi-coordinates').value=points.map(p=>p.map(v=>v.toFixed(4)).join(', ')).join('\n');
    $('roi-validation').textContent=valid(points)?`${points.length} จุด · พื้นที่พร้อมบันทึก`:'วาดอย่างน้อย 3 จุด พื้นที่ต้องไม่ไขว้และอยู่ในภาพ';
    $('roi-save').disabled=!config||!valid(points);$('roi-undo').disabled=!points.length;
  }
  function applyConfig(value) {
    config=value;points=(value.roi||[]).map(p=>[...p]);const t=value.thresholds;
    $('roi-enabled').checked=value.enabled;$('roi-pixel').value=t.pixel_score;$('roi-suspect').value=t.suspect_pct;$('roi-active').value=t.active_pct;$('roi-confirm').value=t.confirmations;draw();
  }
  async function reload() {
    const current=generation;
    try{const result=await client.request(`/api/flood/cameras/${id}/config`,{signal:controller.signal}).then(r=>r.json());if(current===generation){applyConfig(result);$('roi-message').textContent='กำหนดพื้นที่บนถนนที่ต้องการเฝ้าระวัง';}}
    catch(error){if(current===generation)$('roi-message').textContent='อ่านการตั้งค่าไม่ได้';}
  }
  async function open(cameraId) {
    id=cameraId;generation++;controller?.abort();controller=new AbortController();config=null;points=[];token='';$('roi-token').value='';
    $('roi-title').textContent=`พื้นที่เฝ้าระวัง · CCS ${id}`;$('roi-message').textContent='กำลังอ่านการตั้งค่า…';$('roi-stage').hidden=true;draw();$('roi-dialog').showModal();reload();
  }
  function init(api) {
    client=api;$('close-roi').onclick=()=>$('roi-dialog').close();
    $('roi-dialog').addEventListener('close',()=>{generation++;controller?.abort();token='';$('roi-token').value='';if(url)URL.revokeObjectURL(url);url=null;$('roi-image').removeAttribute('href');});
    $('roi-reload').onclick=reload;$('roi-undo').onclick=()=>{points.pop();draw();};$('roi-reset').onclick=()=>{points=[];draw();};
    $('roi-coordinates').oninput=()=>{points=$('roi-coordinates').value.trim().split(/\n/).filter(Boolean).map(line=>line.split(',').map(s=>Number(s.trim())));draw(false);};
    $('roi-svg').addEventListener('pointerdown',event=>{
      if(!url||points.length>=64)return;const matrix=$('roi-svg').getScreenCTM();if(!matrix)return;
      const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());const x=point.x/width,y=point.y/height;
      if(x>=0&&x<=1&&y>=0&&y<=1){points.push([x,y]);draw();}
    });
    $('roi-capture').onclick=async()=>{
      token=$('roi-token').value;const current=generation;$('roi-capture').disabled=true;$('roi-message').textContent='กำลังอ่านภาพกล้อง…';
      try {
        await client.request(`/api/flood/cameras/${id}/snapshot`,{method:'POST',token,signal:controller.signal});
        const response=await client.request(`/api/flood/cameras/${id}/snapshot`,{token,signal:controller.signal});const next=URL.createObjectURL(await response.blob());
        if(current!==generation){URL.revokeObjectURL(next);return;}
        const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=next;});
        if(current!==generation){URL.revokeObjectURL(next);return;}if(url)URL.revokeObjectURL(url);url=next;width=image.naturalWidth;height=image.naturalHeight;
        $('roi-svg').setAttribute('viewBox',`0 0 ${width} ${height}`);$('roi-image').setAttribute('width',width);$('roi-image').setAttribute('height',height);$('roi-image').setAttribute('href',url);
        $('roi-stage').hidden=false;draw();$('roi-message').textContent='คลิกจุดรอบพื้นที่ หรือกรอกพิกัดด้านล่าง';
      }catch(error){if(current===generation)$('roi-message').textContent=error.message.includes('401')?'Admin token ไม่ถูกต้อง':'อ่านภาพกล้องไม่ได้ · ตรวจบริการและต้นทาง';}
      finally{$('roi-capture').disabled=false;}
    };
    $('roi-save').onclick=async()=>{
      if(!config||!valid(points))return;token=$('roi-token').value;const current=generation;$('roi-save').disabled=true;
      const payload={expected_revision:config.revision,enabled:$('roi-enabled').checked,roi:points,
        thresholds:{pixel_score:Number($('roi-pixel').value),suspect_pct:Number($('roi-suspect').value),active_pct:Number($('roi-active').value),confirmations:Number($('roi-confirm').value)}};
      try{const value=await client.request(`/api/flood/cameras/${id}/config`,{method:'PUT',body:payload,token,signal:controller.signal}).then(r=>r.json());if(current===generation){applyConfig(value);$('roi-message').textContent='บันทึกแล้ว · รอรอบวิเคราะห์ใหม่';CctvFloodApi.refresh();}}
      catch(error){if(current===generation)$('roi-message').textContent=error.message.includes('409')?'มีการตั้งค่าใหม่แล้ว · ร่างยังอยู่ กดโหลดค่าที่บันทึกเพื่อแก้จากรุ่นล่าสุด':error.message.includes('401')?'Admin token ไม่ถูกต้อง':'บันทึกไม่ได้ · ตรวจพื้นที่และเกณฑ์';}
      finally{if(current===generation)draw(false);}
    };
  }
  return {init,open};
})();
