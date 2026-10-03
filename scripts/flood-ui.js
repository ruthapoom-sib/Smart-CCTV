globalThis.CctvFloodUI=(()=>{
  let client, latest=new Map(), available=false, detailId=null;
  const $=id=>document.getElementById(id), core=CctvFloodCore;
  function paint() {
    document.querySelectorAll('.tile').forEach(tile=>{
      const reading=core.effective(available?latest.get(tile.dataset.id):null);
      const button=tile.querySelector('.flood-badge');
      if(button) {button.dataset.status=reading.status;button.textContent=`${core.label(reading.status)}${Number.isFinite(reading.water_coverage_pct)?' · '+core.percent(reading.water_coverage_pct):''}`;
        button.setAttribute('aria-label',`ผลน้ำกล้อง ${tile.dataset.id}: ${button.textContent}`); button.onclick=()=>open(tile.dataset.id);}
    });
    if(detailId&&$('flood-detail').open) populate();
  }
  function populate() {
    const reading=core.effective(available?latest.get(detailId):null);
    $('flood-detail-title').textContent=`กล้อง CCS ${detailId} · ${core.label(reading.status)}`;
    $('flood-detail-copy').textContent=`พื้นที่น้ำ ${core.percent(reading.water_coverage_pct)} · ค่าเฉลี่ยความน่าจะเป็นน้ำ ${Number.isFinite(reading.model_score)?reading.model_score.toFixed(2):'—'}\nภาพที่อ่าน ${core.time(reading.captured_at)}\nเวลาจากต้นทาง ${core.time(reading.source_at)}\n${reading.reason||''}`;
    const image=$('flood-detail-image'); image.hidden=true; image.removeAttribute('src');
    if(reading.evidence_id) {image.src=CctvFloodConfig.apiBaseUrl+`/api/flood/evidence/${encodeURIComponent(reading.evidence_id)}?kind=overlay`;image.hidden=false;}
    $('flood-detail-evidence').textContent=reading.evidence_id?'หลักฐานเมื่อเหตุการณ์เปลี่ยนสถานะ':'ยังไม่มีภาพหลักฐานเหตุการณ์';
    $('flood-detail-history').onclick=()=>{$('flood-detail').close();CctvNavigation.navigate({view:'analyst',cameraId:detailId,range:'24h'});};
    $('flood-detail-config').onclick=()=>{$('flood-detail').close();CctvRoiEditor.open(detailId);};
  }
  function open(id) {detailId=id;populate();$('flood-detail').showModal();}
  function update(data) {available=data.available;latest=new Map((data.cameras||[]).map(c=>[c.id,c.reading]));paint();document.dispatchEvent(new CustomEvent('cctv:flood-updated',{detail:data}));}
  function init(api) {
    client=api;document.addEventListener('cctv:tiles-rendered',paint);
    $('close-flood-detail').onclick=()=>$('flood-detail').close();
    $('flood-detail-image').onerror=()=>{$('flood-detail-image').hidden=true;$('flood-detail-evidence').textContent='ภาพหลักฐานหมดอายุหรืออ่านไม่ได้';};
    const visibility=()=>{if(document.hidden)client.stop();else client.start(update);};
    document.addEventListener('visibilitychange',visibility);addEventListener('pagehide',()=>client.stop());
    addEventListener('pageshow',visibility);visibility();paint();
  }
  return {init,open};
})();
